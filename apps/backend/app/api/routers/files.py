from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.core.enums import UserRole
from app.db.session import get_db
from app.services import file_service

router = APIRouter(prefix="/files", tags=["files"])


@router.post("/upload")
async def upload(media_token: str = Form(..., alias="mediaToken"), file: UploadFile | None = None, db: AsyncSession = Depends(get_db)):
    if not file:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No file provided")
    ctx = file_service.resolve_participant(media_token)
    content = await file.read()
    return await file_service.upload(db, ctx["sessionId"], ctx["displayName"], file.filename, file.content_type or "application/octet-stream", content)


@router.get("/{file_id}/download")
async def download(file_id: str, db: AsyncSession = Depends(get_db)):
    return RedirectResponse(await file_service.download_url(db, file_id))


@router.get("/session/{session_id}")
async def list_files(session_id: str, _=Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    return await file_service.list_for_session(db, session_id)
