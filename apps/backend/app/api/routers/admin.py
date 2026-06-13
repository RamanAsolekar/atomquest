from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, require_permissions
from app.core.enums import AuditAction, ParticipantStatus, SessionStatus
from app.core.events import bus
from app.db.session import get_db
from app.models import Session, SessionEvent, User
from app.services import audit_service, session_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/sessions/live")
async def live(_: CurrentUser = Depends(require_permissions("admin:dashboard")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Session).where(Session.status.in_([SessionStatus.ACTIVE.value, SessionStatus.WAITING.value]))
        .options(selectinload(Session.agent), selectinload(Session.participants), selectinload(Session.recordings))
        .order_by(Session.started_at.desc().nullslast())
    )).scalars().all()
    now = datetime.now(timezone.utc)
    out = []
    for s in rows:
        recs = sorted(s.recordings, key=lambda r: r.created_at, reverse=True)
        out.append({
            "id": s.id, "code": s.code, "title": s.title, "status": s.status,
            "agentName": s.agent.name if s.agent else "Agent", "customerName": s.customer_name,
            "startedAt": s.started_at, "runningSeconds": int((now - s.started_at).total_seconds()) if s.started_at else 0,
            "recordingStatus": recs[0].status if recs else "IDLE",
            "connectedCount": sum(1 for p in s.participants if p.status == ParticipantStatus.CONNECTED.value),
            "participants": [{
                "id": p.id, "displayName": p.display_name, "role": p.role, "status": p.status,
                "audioEnabled": p.audio_enabled, "videoEnabled": p.video_enabled,
                "screenSharing": p.screen_sharing, "connectionQuality": p.connection_quality,
                "joinedAt": p.joined_at,
            } for p in s.participants if p.status != ParticipantStatus.LEFT.value],
        })
    return out


@router.post("/sessions/{session_id}/force-end")
async def force_end(session_id: str, request: Request, user: CurrentUser = Depends(require_permissions("admin:force_end")), db: AsyncSession = Depends(get_db)):
    await session_service.end(db, session_id, user.name, "admin")
    await bus.publish(f"session:{session_id}", "session_ended", {"sessionId": session_id, "reason": "admin"})
    await audit_service.write(db, AuditAction.FORCE_END_SESSION.value, user.id, "session", session_id, request.client.host if request.client else None)
    return {"ok": True, "sessionId": session_id}


@router.get("/events")
async def events(sessionId: str | None = None, take: int = 100, _: CurrentUser = Depends(require_permissions("admin:dashboard")), db: AsyncSession = Depends(get_db)):
    stmt = select(SessionEvent).order_by(SessionEvent.created_at.desc()).limit(min(take, 500))
    if sessionId:
        stmt = stmt.where(SessionEvent.session_id == sessionId)
    rows = (await db.execute(stmt)).scalars().all()
    return [{"id": e.id, "sessionId": e.session_id, "type": e.type, "actorName": e.actor_name, "createdAt": e.created_at} for e in rows]


@router.get("/users")
async def users(_: CurrentUser = Depends(require_permissions("admin:dashboard")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role, "isActive": u.is_active, "lastLoginAt": u.last_login_at, "createdAt": u.created_at} for u in rows]
