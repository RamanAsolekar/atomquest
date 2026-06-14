"""Session lifecycle, participants, invites, media-token issuance.

Every state transition publishes to the event bus → live dashboards update with
no polling. This is the engine of the platform.
"""
from __future__ import annotations

import secrets
import string
import time
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import metrics
from app.core.enums import (
    EventType,
    ParticipantRole,
    ParticipantStatus,
    RecordingStatus,
    SessionStatus,
    UserRole,
)
from app.core.events import bus
from app.core.security import create_media_token, sha256, sign_invite, verify_invite
from app.models import Invite, Participant, Session, SessionEvent, User
from app.services import config_service

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(10))


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- serialisation
def participant_dto(p: Participant) -> dict:
    return {
        "id": p.id, "sessionId": p.session_id, "userId": p.user_id,
        "displayName": p.display_name, "role": p.role, "status": p.status,
        "joinedAt": p.joined_at, "leftAt": p.left_at, "durationSeconds": p.duration_seconds,
        "audioEnabled": p.audio_enabled, "videoEnabled": p.video_enabled,
        "screenSharing": p.screen_sharing, "connectionQuality": p.connection_quality,
    }


def session_dto(s: Session) -> dict:
    recs = sorted(s.recordings, key=lambda r: r.created_at, reverse=True) if s.recordings else []
    latest = recs[0] if recs else None
    return {
        "id": s.id, "code": s.code, "title": s.title, "status": s.status,
        "agentId": s.agent_id, "agentName": s.agent.name if s.agent else "Agent",
        "customerName": s.customer_name,
        "recordingStatus": latest.status if latest else RecordingStatus.IDLE.value,
        "recordingId": latest.id if latest else None,
        "createdAt": s.created_at, "startedAt": s.started_at, "endedAt": s.ended_at,
        "durationSeconds": s.duration_seconds,
        "participantCount": len(s.participants) if s.participants is not None else 0,
        "participants": [participant_dto(p) for p in s.participants] if s.participants else [],
        "tags": s.tags or [],
        "qualityScore": s.quality_score,
        "summary": s.ai_insight.summary if s.ai_insight else None,
        "sentiment": s.ai_insight.sentiment if s.ai_insight else None,
    }


async def _load(db: AsyncSession, session_id: str) -> Session:
    stmt = (
        select(Session)
        .where(Session.id == session_id)
        .options(
            selectinload(Session.agent),
            selectinload(Session.participants),
            selectinload(Session.recordings),
            selectinload(Session.ai_insight),
        )
    )
    s = (await db.execute(stmt)).scalar_one_or_none()
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return s


# ---------------------------------------------------------------- events/metrics
async def record_event(db: AsyncSession, session_id: str, etype: str, actor: str | None = None, payload: dict | None = None) -> None:
    db.add(SessionEvent(session_id=session_id, type=etype, actor_name=actor, payload=payload))
    await db.flush()
    await bus.publish(f"session:{session_id}", "event", {"type": etype, "actorName": actor, "payload": payload})
    await bus.publish("admin", "session_event", {"sessionId": session_id, "type": etype, "actorName": actor})


async def refresh_live_metrics(db: AsyncSession) -> None:
    active = (await db.execute(select(func.count()).select_from(Session).where(Session.status == SessionStatus.ACTIVE.value))).scalar() or 0
    connected = (await db.execute(select(func.count()).select_from(Participant).where(Participant.status == ParticipantStatus.CONNECTED.value))).scalar() or 0
    metrics.active_sessions.set(active)
    metrics.connected_participants.set(connected)
    await bus.publish("dashboard", "metrics", {"activeSessions": active, "connectedParticipants": connected})


# ---------------------------------------------------------------- lifecycle
async def create(db: AsyncSession, agent_id: str, agent_name: str, title: str, customer_name: str | None, tags: list[str] | None, scheduled_at: str | None) -> dict:
    s = Session(
        code=_code(), title=title, agent_id=agent_id, customer_name=customer_name,
        tags=tags or [], status=SessionStatus.SCHEDULED.value if scheduled_at else SessionStatus.WAITING.value,
        scheduled_at=datetime.fromisoformat(scheduled_at) if scheduled_at else None,
    )
    db.add(s)
    await db.flush()
    db.add(Participant(session_id=s.id, user_id=agent_id, display_name=agent_name,
                       role=ParticipantRole.AGENT.value, status=ParticipantStatus.INVITED.value))
    await db.flush()
    metrics.sessions_created.inc()
    await record_event(db, s.id, EventType.SESSION_CREATED.value, agent_name, {"title": title})
    s = await _load(db, s.id)
    dto = session_dto(s)
    await bus.publish("dashboard", "session_created", dto)
    await bus.publish("admin", "session_created", dto)
    return dto


async def end(db: AsyncSession, session_id: str, actor_name: str, reason: str = "agent") -> dict:
    s = await _load(db, session_id)
    if s.status == SessionStatus.ENDED.value:
        return session_dto(s)
    now = _now()
    started = s.started_at or s.created_at
    s.status = SessionStatus.ENDED.value
    s.ended_at = now
    s.duration_seconds = max(0, int((now - started).total_seconds()))
    for p in s.participants:
        if p.status in (ParticipantStatus.CONNECTED.value, ParticipantStatus.RECONNECTING.value):
            p.status = ParticipantStatus.LEFT.value
            p.left_at = now
    for r in s.recordings:
        if r.status == RecordingStatus.RECORDING.value:
            r.status = RecordingStatus.PROCESSING.value
            r.ended_at = now
    await db.flush()
    metrics.sessions_ended.labels(reason=reason).inc()
    await record_event(db, session_id, EventType.SESSION_ENDED.value, actor_name, {"reason": reason})
    await refresh_live_metrics(db)
    s = await _load(db, session_id)
    dto = session_dto(s)
    await bus.publish(f"session:{session_id}", "session_ended", {"sessionId": session_id, "reason": reason})
    await bus.publish("dashboard", "session_updated", dto)
    await bus.publish("admin", "session_updated", dto)
    return dto


async def assert_can_end(db: AsyncSession, session_id: str, user) -> Session:
    s = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if user.role == UserRole.ADMIN.value or (user.role == UserRole.AGENT.value and s.agent_id == user.id):
        return s
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owning agent or an admin can end this session")


# ---------------------------------------------------------------- invites
def _public_base_url(request) -> str:
    """The origin to build shareable links from.

    Prefer the origin the agent actually reached us through (honouring the
    X-Forwarded-* headers nginx sets) so the invite link always points at the
    same host the agent is using — the Google-Meet behaviour where the link
    "just works" regardless of how the deployment is addressed. Falls back to the
    configured WEB_URL when no request context is available.
    """
    from app.core.config import settings

    if request is not None:
        fwd_proto = request.headers.get("x-forwarded-proto")
        fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if fwd_host:
            scheme = fwd_proto or request.url.scheme
            return f"{scheme}://{fwd_host}".rstrip("/")
    return settings.web_url.rstrip("/")


async def create_invite(db: AsyncSession, session_id: str, customer_name: str | None, ttl: int | None, request=None) -> dict:
    s = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if s.status in (SessionStatus.ENDED.value, SessionStatus.CANCELLED.value):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot invite to a closed session")
    ttl = ttl or await config_service.get(db, "invite_default_ttl_seconds")
    expires_ms = int(time.time() * 1000) + ttl * 1000
    token = sign_invite(session_id, expires_ms)
    db.add(Invite(session_id=session_id, token_hash=sha256(token), customer_name=customer_name,
                  expires_at=datetime.fromtimestamp(expires_ms / 1000, tz=timezone.utc)))
    await db.flush()
    return {
        "token": token, "url": f"{_public_base_url(request)}/join/{token}",
        "sessionId": session_id, "sessionCode": s.code,
        "expiresAt": datetime.fromtimestamp(expires_ms / 1000, tz=timezone.utc),
    }


async def validate_invite(db: AsyncSession, token: str) -> Invite:
    try:
        sid, _ = verify_invite(token)
    except ValueError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Invalid invite: {exc}") from exc
    inv = (
        await db.execute(select(Invite).where(Invite.token_hash == sha256(token)).options(selectinload(Invite.session)))
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    if inv.revoked_at:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invite has been revoked")
    if inv.expires_at < _now():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invite has expired")
    if inv.session.status in (SessionStatus.ENDED.value, SessionStatus.CANCELLED.value):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This support session has already ended")
    if sid != inv.session_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invite mismatch")
    return inv


# ---------------------------------------------------------------- join
async def join(db: AsyncSession, session_id: str, display_name: str, invite_token: str | None, user) -> dict:
    s = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if s.status in (SessionStatus.ENDED.value, SessionStatus.CANCELLED.value):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This session has ended")

    if user and user.role in (UserRole.AGENT.value, UserRole.ADMIN.value):
        if user.role == UserRole.AGENT.value and s.agent_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not own this session")
        role = (
            ParticipantRole.OBSERVER.value
            if user.role == UserRole.ADMIN.value and s.agent_id != user.id
            else ParticipantRole.AGENT.value
        )
        participant = (
            await db.execute(select(Participant).where(Participant.session_id == session_id, Participant.user_id == user.id))
        ).scalar_one_or_none()
        if not participant:
            participant = Participant(session_id=session_id, user_id=user.id, display_name=user.name,
                                      role=role, status=ParticipantStatus.INVITED.value)
            db.add(participant)
            await db.flush()
    else:
        if not invite_token:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "A valid invite is required to join")
        inv = await validate_invite(db, invite_token)
        if inv.session_id != session_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Invite does not match session")
        inv.used_at = _now()
        role = ParticipantRole.CUSTOMER.value
        participant = Participant(session_id=session_id,
                                  display_name=display_name or inv.customer_name or "Customer",
                                  role=role, status=ParticipantStatus.INVITED.value)
        db.add(participant)
        await db.flush()

    media_token = create_media_token(participant.id, session_id, role, participant.display_name)
    s = await _load(db, session_id)
    return {"session": session_dto(s), "participant": participant_dto(participant), "mediaToken": media_token}


# ---------------------------------------------------------------- presence (called by gateway)
async def mark_connected(db: AsyncSession, participant_id: str, socket_id: str) -> Participant | None:
    p = await db.get(Participant, participant_id)
    if not p:
        return None
    p.status = ParticipantStatus.CONNECTED.value
    p.socket_id = socket_id
    p.joined_at = p.joined_at or _now()
    s = await db.get(Session, p.session_id)
    if s and s.status not in (SessionStatus.ACTIVE.value, SessionStatus.ENDED.value):
        s.status = SessionStatus.ACTIVE.value
        s.started_at = s.started_at or _now()
    await db.flush()
    await record_event(db, p.session_id, EventType.PARTICIPANT_JOINED.value, p.display_name)
    await refresh_live_metrics(db)
    return p


async def mark_reconnecting(db: AsyncSession, participant_id: str) -> None:
    p = await db.get(Participant, participant_id)
    if p:
        p.status = ParticipantStatus.RECONNECTING.value
        await db.flush()


async def mark_reconnected(db: AsyncSession, participant_id: str, socket_id: str) -> None:
    p = await db.get(Participant, participant_id)
    if p:
        metrics.reconnects_total.inc()
        p.status = ParticipantStatus.CONNECTED.value
        p.socket_id = socket_id
        await db.flush()
        await record_event(db, p.session_id, EventType.PARTICIPANT_RECONNECTED.value, p.display_name)


async def mark_left(db: AsyncSession, participant_id: str, reason: str = "left") -> Participant | None:
    p = await db.get(Participant, participant_id)
    if not p or p.status == ParticipantStatus.LEFT.value:
        return p
    now = _now()
    p.status = ParticipantStatus.LEFT.value
    p.left_at = now
    p.duration_seconds = int((now - p.joined_at).total_seconds()) if p.joined_at else 0
    p.socket_id = None
    await db.flush()
    await record_event(db, p.session_id,
                       (EventType.PARTICIPANT_DROPPED if reason == "dropped" else EventType.PARTICIPANT_LEFT).value,
                       p.display_name)
    await refresh_live_metrics(db)
    return p


async def update_media_state(db: AsyncSession, participant_id: str, patch: dict) -> Participant | None:
    p = await db.get(Participant, participant_id)
    if not p:
        return None
    for k in ("audio_enabled", "video_enabled", "screen_sharing"):
        camel = {"audio_enabled": "audioEnabled", "video_enabled": "videoEnabled", "screen_sharing": "screenSharing"}[k]
        if camel in patch:
            setattr(p, k, patch[camel])
    await db.flush()
    await record_event(db, p.session_id, EventType.MEDIA_TOGGLED.value, p.display_name, patch)
    return p


async def update_quality(db: AsyncSession, participant_id: str, quality: str) -> None:
    p = await db.get(Participant, participant_id)
    if p:
        p.connection_quality = quality
        await db.flush()


async def get_participants(db: AsyncSession, session_id: str) -> list[dict]:
    rows = (await db.execute(select(Participant).where(Participant.session_id == session_id))).scalars().all()
    return [participant_dto(p) for p in rows]
