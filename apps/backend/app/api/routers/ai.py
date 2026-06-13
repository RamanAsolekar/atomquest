from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.core.enums import UserRole
from app.db.session import get_db
from app.services import ai_service

router = APIRouter(prefix="/sessions/{session_id}/ai", tags=["ai"])


@router.post("/summary")
async def generate(session_id: str, _=Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    return await ai_service.generate_summary(db, session_id)


@router.get("/summary")
async def get(session_id: str, _=Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    return await ai_service.get_summary(db, session_id)
