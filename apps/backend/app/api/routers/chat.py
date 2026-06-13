from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.core.enums import UserRole
from app.db.session import get_db
from app.services import chat_service

router = APIRouter(prefix="/sessions", tags=["chat"])


@router.get("/{session_id}/messages")
async def history(session_id: str, _=Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    return await chat_service.history(db, session_id)
