"""Socket.IO /rt namespace: chat, presence, reconnect grace, media-state,
annotations/pointer, session-end. Authenticated by the media token.

A background task subscribes to the event bus and relays room-scoped events
(messages, recording status, transcripts, AI insights) to connected sockets —
so the in-call experience is fully live and consistent across replicas.
"""
from __future__ import annotations

import asyncio

import jwt
import socketio
import structlog

from app.core.config import settings
from app.core.enums import MessageType, ParticipantRole
from app.core.events import bus
from app.core.redis_client import (
    add_presence,
    clear_grace,
    clear_presence,
    in_grace,
    remove_presence,
    set_grace,
)
from app.db.session import SessionLocal
from app.services import chat_service, config_service, session_service

log = structlog.get_logger("realtime")

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    # cross-replica fan-out for socket.io itself
    client_manager=socketio.AsyncRedisManager(settings.redis_url) if settings.redis_url else None,
)

RT = "/rt"
# sid -> context
_ctx: dict[str, dict] = {}
_grace_tasks: dict[str, asyncio.Task] = {}


def _room(session_id: str) -> str:
    return f"session:{session_id}"


@sio.event(namespace=RT)
async def connect(sid, environ, auth):
    token = (auth or {}).get("mediaToken") or environ.get("HTTP_X_MEDIA_TOKEN")
    if not token:
        await sio.emit("rt:error", {"message": "Missing media token"}, to=sid, namespace=RT)
        return False
    try:
        payload = jwt.decode(token, settings.jwt_access_secret, algorithms=["HS256"])
        if payload.get("type") != "media":
            raise jwt.InvalidTokenError()
    except jwt.PyJWTError:
        await sio.emit("rt:error", {"message": "Invalid media token"}, to=sid, namespace=RT)
        return False

    ctx = {
        "sessionId": payload["sessionId"], "participantId": payload["sub"],
        "role": payload["role"], "displayName": payload["displayName"],
    }
    _ctx[sid] = ctx
    await sio.enter_room(sid, _room(ctx["sessionId"]), namespace=RT)
    await add_presence(ctx["sessionId"], ctx["participantId"], sid)

    async with SessionLocal() as db:
        was_grace = await in_grace(ctx["sessionId"], ctx["participantId"])
        if was_grace:
            t = _grace_tasks.pop(ctx["participantId"], None)
            if t:
                t.cancel()
            await clear_grace(ctx["sessionId"], ctx["participantId"])
            await session_service.mark_reconnected(db, ctx["participantId"], sid)
        else:
            await session_service.mark_connected(db, ctx["participantId"], sid)
            await sio.emit("rt:participantJoined", {"participantId": ctx["participantId"], "displayName": ctx["displayName"], "role": ctx["role"]}, room=_room(ctx["sessionId"]), namespace=RT)
        await db.commit()
        await _broadcast_room_state(db, ctx["sessionId"])
    log.info("rt_connect", **ctx)
    return True


@sio.event(namespace=RT)
async def disconnect(sid):
    ctx = _ctx.pop(sid, None)
    if not ctx:
        return
    await remove_presence(ctx["sessionId"], ctx["participantId"])
    async with SessionLocal() as db:
        await session_service.mark_reconnecting(db, ctx["participantId"])
        await db.commit()
    grace_ms = await _grace_window()
    await set_grace(ctx["sessionId"], ctx["participantId"], grace_ms)
    await sio.emit("rt:participantReconnecting", {"participantId": ctx["participantId"], "displayName": ctx["displayName"], "graceMs": grace_ms}, room=_room(ctx["sessionId"]), namespace=RT)
    _grace_tasks[ctx["participantId"]] = asyncio.create_task(_expire_grace(ctx, grace_ms))


async def _grace_window() -> int:
    async with SessionLocal() as db:
        return await config_service.get(db, "reconnect_grace_ms")


async def _expire_grace(ctx: dict, grace_ms: int):
    try:
        await asyncio.sleep(grace_ms / 1000)
    except asyncio.CancelledError:
        return
    _grace_tasks.pop(ctx["participantId"], None)
    await clear_grace(ctx["sessionId"], ctx["participantId"])
    async with SessionLocal() as db:
        await session_service.mark_left(db, ctx["participantId"], "dropped")
        await db.commit()
        await sio.emit("rt:participantLeft", {"participantId": ctx["participantId"], "displayName": ctx["displayName"]}, room=_room(ctx["sessionId"]), namespace=RT)
        await _broadcast_room_state(db, ctx["sessionId"])


async def _broadcast_room_state(db, session_id: str):
    participants = await session_service.get_participants(db, session_id)
    await sio.emit("rt:roomState", {"participants": participants}, room=_room(session_id), namespace=RT)


@sio.on("rt:sendMessage", namespace=RT)
async def on_message(sid, data):
    ctx = _ctx.get(sid)
    if not ctx or not (data or {}).get("text", "").strip():
        return
    async with SessionLocal() as db:
        msg = await chat_service.persist(db, ctx["sessionId"], ctx["displayName"], ctx["role"], data["text"].strip(), MessageType.TEXT.value)
        await db.commit()
    await sio.emit("rt:message", msg, room=_room(ctx["sessionId"]), namespace=RT)


@sio.on("rt:typing", namespace=RT)
async def on_typing(sid, data):
    ctx = _ctx.get(sid)
    if ctx:
        await sio.emit("rt:typing", {"displayName": ctx["displayName"], "typing": (data or {}).get("typing")}, room=_room(ctx["sessionId"]), skip_sid=sid, namespace=RT)


@sio.on("rt:toggleMedia", namespace=RT)
async def on_toggle(sid, data):
    ctx = _ctx.get(sid)
    if not ctx:
        return
    async with SessionLocal() as db:
        await session_service.update_media_state(db, ctx["participantId"], data or {})
        await db.commit()
    await sio.emit("rt:mediaToggled", {"participantId": ctx["participantId"], **(data or {})}, room=_room(ctx["sessionId"]), namespace=RT)


@sio.on("rt:heartbeat", namespace=RT)
async def on_heartbeat(sid, data):
    ctx = _ctx.get(sid)
    if ctx and (data or {}).get("quality"):
        async with SessionLocal() as db:
            await session_service.update_quality(db, ctx["participantId"], data["quality"])
            await db.commit()


@sio.on("rt:annotate", namespace=RT)
async def on_annotate(sid, stroke):
    ctx = _ctx.get(sid)
    if ctx:
        await sio.emit("rt:annotation", stroke, room=_room(ctx["sessionId"]), skip_sid=sid, namespace=RT)


@sio.on("rt:clearAnnotations", namespace=RT)
async def on_clear(sid, _data=None):
    ctx = _ctx.get(sid)
    if ctx:
        await sio.emit("rt:annotationsCleared", {}, room=_room(ctx["sessionId"]), namespace=RT)


@sio.on("rt:pointer", namespace=RT)
async def on_pointer(sid, data):
    ctx = _ctx.get(sid)
    if ctx:
        await sio.emit("rt:pointer", {"peerId": ctx["participantId"], "displayName": ctx["displayName"], **(data or {})}, room=_room(ctx["sessionId"]), skip_sid=sid, namespace=RT)


@sio.on("rt:endSession", namespace=RT)
async def on_end(sid, _data=None):
    ctx = _ctx.get(sid)
    if not ctx:
        return
    if ctx["role"] != ParticipantRole.AGENT.value:
        await sio.emit("rt:error", {"message": "Only the agent can end the session"}, to=sid, namespace=RT)
        return
    async with SessionLocal() as db:
        await session_service.end(db, ctx["sessionId"], ctx["displayName"], "agent")
        await db.commit()
    await clear_presence(ctx["sessionId"])


# ---- event-bus relay: turn domain events into room broadcasts ----
_RELAY = {
    "message": "rt:message",
    "recording_status": "rt:recordingStatus",
    "transcript": "rt:transcript",
    "ai_insight": "rt:aiInsight",
    "session_ended": "rt:sessionEnded",
}


async def event_relay() -> None:
    await bus.start()
    async for evt in bus.subscribe("*"):
        topic = evt.get("topic", "")
        etype = evt.get("type")
        if topic.startswith("session:") and etype in _RELAY:
            session_id = topic.split(":", 1)[1]
            await sio.emit(_RELAY[etype], evt["data"], room=_room(session_id), namespace=RT)
