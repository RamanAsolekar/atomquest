from __future__ import annotations

from fastapi import APIRouter, Body, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.core.enums import UserRole
from app.db.session import get_db
from app.services import transcript_service

router = APIRouter(tags=["transcripts"])


@router.post("/transcripts/ingest")
async def ingest(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Internal: media-server Whisper worker posts live STT segments here."""
    return await transcript_service.ingest(
        db, body["sessionId"], body.get("text", ""), body.get("speaker"),
        body.get("startMs"), body.get("endMs"), body.get("isFinal", True),
    )


@router.get("/sessions/{session_id}/transcript")
async def get_transcript(session_id: str, _=Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    return await transcript_service.get_for_session(db, session_id)
