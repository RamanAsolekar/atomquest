"""Audit logging — never raises into the request path."""
from __future__ import annotations

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User

log = structlog.get_logger("audit")


async def write(
    db: AsyncSession,
    action: str,
    actor_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    meta: dict | None = None,
) -> None:
    try:
        db.add(
            AuditLog(
                action=action, actor_id=actor_id, target_type=target_type,
                target_id=target_id, ip=ip, user_agent=user_agent, meta=meta,
            )
        )
        await db.flush()
    except Exception as exc:  # noqa: BLE001
        log.warning("audit_write_failed", error=str(exc))


async def list_logs(
    db: AsyncSession, take: int = 50, skip: int = 0, action: str | None = None, actor_id: str | None = None
) -> dict:
    take = min(take, 200)
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc())
    count_stmt = select(func.count()).select_from(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
        count_stmt = count_stmt.where(AuditLog.action == action)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
        count_stmt = count_stmt.where(AuditLog.actor_id == actor_id)
    rows = (await db.execute(stmt.offset(skip).limit(take))).scalars().all()
    total = (await db.execute(count_stmt)).scalar() or 0
    actor_ids = [r.actor_id for r in rows if r.actor_id]
    actors = {}
    if actor_ids:
        for u in (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars().all():
            actors[u.id] = {"name": u.name, "email": u.email}
    items = [
        {
            "id": r.id, "action": r.action, "actorId": r.actor_id,
            "actor": actors.get(r.actor_id), "targetType": r.target_type,
            "targetId": r.target_id, "ip": r.ip, "createdAt": r.created_at,
        }
        for r in rows
    ]
    return {"items": items, "total": total, "take": take, "skip": skip}
