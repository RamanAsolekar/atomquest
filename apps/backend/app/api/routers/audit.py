from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_permissions
from app.db.session import get_db
from app.services import audit_service

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/logs")
async def logs(take: int = 50, skip: int = 0, action: str | None = None, actorId: str | None = None,
               _=Depends(require_permissions("audit:view")), db: AsyncSession = Depends(get_db)):
    return await audit_service.list_logs(db, take, skip, action, actorId)
