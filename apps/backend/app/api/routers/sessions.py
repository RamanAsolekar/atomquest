from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, get_optional_user, require_permissions, require_roles
from app.core.enums import AuditAction, UserRole
from app.db.session import get_db
from app.models import Session, SessionEvent
from app.schemas import CreateInviteRequest, CreateSessionRequest, JoinSessionRequest
from app.services import audit_service, session_service

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("")
async def create_session(
    body: CreateSessionRequest, request: Request,
    user: CurrentUser = Depends(require_permissions("session:create")),
    db: AsyncSession = Depends(get_db),
):
    dto = await session_service.create(db, user.id, user.name, body.title, body.customer_name, body.tags, body.scheduled_at)
    await audit_service.write(db, AuditAction.CREATE_SESSION.value, user.id, "session", dto["id"], request.client.host if request.client else None)
    return dto


@router.get("")
async def list_sessions(
    status_: str | None = Query(default=None, alias="status"),
    search: str | None = None, take: int = 25, skip: int = 0,
    user: CurrentUser = Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    take = min(take, 100)
    stmt = select(Session).options(
        selectinload(Session.agent), selectinload(Session.participants), selectinload(Session.recordings),
        selectinload(Session.ai_insight),
    ).order_by(Session.created_at.desc())
    count_stmt = select(func.count()).select_from(Session)
    if user.role == UserRole.AGENT.value:
        stmt = stmt.where(Session.agent_id == user.id)
        count_stmt = count_stmt.where(Session.agent_id == user.id)
    if status_:
        stmt = stmt.where(Session.status == status_)
        count_stmt = count_stmt.where(Session.status == status_)
    if search:
        like = f"%{search}%"
        cond = or_(Session.title.ilike(like), Session.customer_name.ilike(like), Session.code.ilike(like))
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    rows = (await db.execute(stmt.offset(skip).limit(take))).scalars().all()
    total = (await db.execute(count_stmt)).scalar() or 0
    return {"items": [session_service.session_dto(s) for s in rows], "total": total, "take": take, "skip": skip}


@router.get("/{session_id}")
async def get_session(session_id: str, user: CurrentUser = Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException, status as st
    s = await session_service._load(db, session_id)
    if user.role == UserRole.AGENT.value and s.agent_id != user.id:
        raise HTTPException(st.HTTP_403_FORBIDDEN, "Not your session")
    return session_service.session_dto(s)


@router.get("/{session_id}/events")
async def session_events(session_id: str, _: CurrentUser = Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SessionEvent).where(SessionEvent.session_id == session_id).order_by(SessionEvent.created_at.asc()))).scalars().all()
    return [{"id": e.id, "type": e.type, "actorName": e.actor_name, "payload": e.payload, "createdAt": e.created_at} for e in rows]


@router.get("/{session_id}/participants")
async def session_participants(session_id: str, _: CurrentUser = Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    return await session_service.get_participants(db, session_id)


@router.post("/{session_id}/end")
async def end_session(session_id: str, request: Request, user: CurrentUser = Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    await session_service.assert_can_end(db, session_id, user)
    result = await session_service.end(db, session_id, user.name, "agent")
    await audit_service.write(db, AuditAction.END_SESSION.value, user.id, "session", session_id, request.client.host if request.client else None)
    return result


@router.post("/{session_id}/invites")
async def create_invite(session_id: str, body: CreateInviteRequest, request: Request, user: CurrentUser = Depends(require_permissions("invite:create")), db: AsyncSession = Depends(get_db)):
    await session_service.assert_can_end(db, session_id, user)
    invite = await session_service.create_invite(db, session_id, body.customer_name, body.expires_in_seconds)
    await audit_service.write(db, AuditAction.GENERATE_INVITE.value, user.id, "session", session_id, request.client.host if request.client else None)
    return invite


@router.get("/invite/{token}/validate")
async def validate_invite(token: str, db: AsyncSession = Depends(get_db)):
    inv = await session_service.validate_invite(db, token)
    return {
        "valid": True, "sessionId": inv.session_id, "sessionTitle": inv.session.title,
        "sessionCode": inv.session.code, "customerName": inv.customer_name, "expiresAt": inv.expires_at,
    }


@router.post("/{session_id}/join")
async def join_session(session_id: str, body: JoinSessionRequest, user: CurrentUser | None = Depends(get_optional_user), db: AsyncSession = Depends(get_db)):
    return await session_service.join(db, session_id, body.display_name, body.invite_token, user)
