from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, require_permissions
from app.core.enums import AuditAction
from app.db.session import get_db
from app.services import analytics_service, audit_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
async def overview(request: Request, user: CurrentUser = Depends(require_permissions("analytics:view")), db: AsyncSession = Depends(get_db)):
    await audit_service.write(db, AuditAction.VIEW_ANALYTICS.value, user.id, ip=request.client.host if request.client else None)
    return await analytics_service.overview(db, user)
