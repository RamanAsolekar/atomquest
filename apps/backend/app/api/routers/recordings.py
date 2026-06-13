from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, require_permissions, require_roles
from app.core.enums import AuditAction, UserRole
from app.db.session import get_db
from app.services import audit_service, recording_service

router = APIRouter(tags=["recordings"])


@router.post("/sessions/{session_id}/recording/start")
async def start(session_id: str, request: Request, user: CurrentUser = Depends(require_permissions("recording:start")), db: AsyncSession = Depends(get_db)):
    rec = await recording_service.start(db, session_id, user)
    await audit_service.write(db, AuditAction.START_RECORDING.value, user.id, "session", session_id, request.client.host if request.client else None)
    return rec


@router.post("/sessions/{session_id}/recording/stop")
async def stop(session_id: str, request: Request, user: CurrentUser = Depends(require_permissions("recording:stop")), db: AsyncSession = Depends(get_db)):
    rec = await recording_service.stop(db, session_id, user)
    await audit_service.write(db, AuditAction.STOP_RECORDING.value, user.id, "session", session_id, request.client.host if request.client else None)
    return rec


@router.get("/sessions/{session_id}/recordings")
async def status_list(session_id: str, _=Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    return await recording_service.status_list(db, session_id)


@router.get("/recordings/{recording_id}/download")
async def download(recording_id: str, request: Request, user: CurrentUser = Depends(require_permissions("recording:download")), db: AsyncSession = Depends(get_db)):
    url = await recording_service.download_url(db, recording_id, user)
    await audit_service.write(db, AuditAction.DOWNLOAD_RECORDING.value, user.id, "recording", recording_id, request.client.host if request.client else None)
    return RedirectResponse(url)


@router.post("/recordings/callback")
async def callback(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Internal: media server → API when a recording finishes processing."""
    await recording_service.on_processed(
        db, body["recordingId"], body.get("storageKey", ""), body.get("sizeBytes", 0),
        body.get("durationSeconds"), body.get("error"),
    )
    return {"ok": True}
