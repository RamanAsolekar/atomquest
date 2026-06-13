"""Server-Sent Events live streams — dashboards subscribe and update in real
time with zero polling. Topics: dashboard, admin, analytics, config, session:<id>.

Auth: short-lived access token passed as a query param (EventSource can't set
headers). Topic access is checked against the caller's role.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

import jwt
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.core import metrics
from app.core.enums import UserRole
from app.core.events import bus
from app.core.security import decode_access_token

router = APIRouter(tags=["stream"])

_ADMIN_TOPICS = {"admin"}


def _authorise(token: str, topic: str) -> dict:
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    role = payload.get("role")
    if topic in _ADMIN_TOPICS and role != UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin topic")
    return payload


async def _event_source(request: Request, topic: str) -> AsyncIterator[bytes]:
    metrics.sse_subscribers.inc()
    await bus.start()
    try:
        # initial comment so the connection opens immediately
        yield b": connected\n\n"
        agen = bus.subscribe(topic)
        while True:
            if await request.is_disconnected():
                break
            try:
                evt = await asyncio.wait_for(agen.__anext__(), timeout=20)
                data = json.dumps(evt["data"], default=str)
                yield f"event: {evt['type']}\ndata: {data}\n\n".encode()
            except asyncio.TimeoutError:
                yield b": keep-alive\n\n"  # heartbeat
    finally:
        metrics.sse_subscribers.dec()


@router.get("/stream/{topic}")
async def stream(topic: str, request: Request, token: str = Query(...)):
    _authorise(token, topic)
    return StreamingResponse(
        _event_source(request, topic),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
