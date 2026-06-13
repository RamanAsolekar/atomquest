"""Recording lifecycle. The media server captures/uploads; the backend owns
the state machine and broadcasts status changes live."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import metrics
from app.core.config import settings
from app.core.enums import EventType, RecordingStatus, UserRole
from app.core.events import bus
from app.models import Recording, Session
from app.services import session_service


def _dto(r: Recording) -> dict:
    return {
        "id": r.id, "sessionId": r.session_id, "status": r.status,
        "durationSeconds": r.duration_seconds, "sizeBytes": r.size_bytes,
        "storageKey": r.storage_key,
        "downloadUrl": f"/api/recordings/{r.id}/download" if r.status == RecordingStatus.READY.value else None,
        "startedAt": r.started_at, "endedAt": r.ended_at, "createdAt": r.created_at,
    }


async def _assert_owner(db: AsyncSession, session_id: str, user) -> Session:
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if user.role != UserRole.ADMIN.value and s.agent_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owning agent may control recording")
    return s


async def _notify_media(path: str, body: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{settings.media_internal_url}{path}", json=body)
    except Exception:  # noqa: BLE001
        pass


async def _broadcast(session_id: str, rstatus: str, recording_id: str | None) -> None:
    await bus.publish(f"session:{session_id}", "recording_status", {"status": rstatus, "recordingId": recording_id})
    await bus.publish("admin", "recording_status", {"sessionId": session_id, "status": rstatus})


async def start(db: AsyncSession, session_id: str, user) -> dict:
    await _assert_owner(db, session_id, user)
    active = (await db.execute(select(Recording).where(Recording.session_id == session_id, Recording.status == RecordingStatus.RECORDING.value))).scalar_one_or_none()
    if active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A recording is already in progress")
    rec = Recording(session_id=session_id, status=RecordingStatus.RECORDING.value, started_at=datetime.now(timezone.utc))
    db.add(rec)
    await db.flush()
    await _notify_media("/recording/start", {"sessionId": session_id, "recordingId": rec.id})
    await session_service.record_event(db, session_id, EventType.RECORDING_STARTED.value, user.name)
    await _broadcast(session_id, RecordingStatus.RECORDING.value, rec.id)
    return _dto(rec)


async def stop(db: AsyncSession, session_id: str, user) -> dict:
    await _assert_owner(db, session_id, user)
    rec = (await db.execute(select(Recording).where(Recording.session_id == session_id, Recording.status == RecordingStatus.RECORDING.value).order_by(Recording.created_at.desc()))).scalar_one_or_none()
    if not rec:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No active recording to stop")
    now = datetime.now(timezone.utc)
    rec.status = RecordingStatus.PROCESSING.value
    rec.ended_at = now
    rec.duration_seconds = int((now - rec.started_at).total_seconds()) if rec.started_at else 0
    await db.flush()
    await _notify_media("/recording/stop", {"sessionId": session_id, "recordingId": rec.id})
    await session_service.record_event(db, session_id, EventType.RECORDING_STOPPED.value, user.name)
    await _broadcast(session_id, RecordingStatus.PROCESSING.value, rec.id)
    return _dto(rec)


async def on_processed(db: AsyncSession, recording_id: str, storage_key: str, size_bytes: int, duration_seconds: int | None, error: str | None) -> None:
    rec = await db.get(Recording, recording_id)
    if not rec:
        return
    if error:
        rec.status = RecordingStatus.FAILED.value
        rec.error = error
        metrics.recordings_total.labels(status="failed").inc()
        await db.flush()
        await _broadcast(rec.session_id, RecordingStatus.FAILED.value, rec.id)
        return
    rec.status = RecordingStatus.READY.value
    rec.storage_key = storage_key
    rec.size_bytes = size_bytes
    rec.duration_seconds = duration_seconds or rec.duration_seconds
    await db.flush()
    metrics.recordings_total.labels(status="ready").inc()
    await session_service.record_event(db, rec.session_id, EventType.RECORDING_READY.value)
    await _broadcast(rec.session_id, RecordingStatus.READY.value, rec.id)


async def status_list(db: AsyncSession, session_id: str) -> list[dict]:
    rows = (await db.execute(select(Recording).where(Recording.session_id == session_id).order_by(Recording.created_at.desc()))).scalars().all()
    return [_dto(r) for r in rows]


async def download_url(db: AsyncSession, recording_id: str, user) -> str:
    from app.services import storage_service
    rec = await db.get(Recording, recording_id)
    if not rec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recording not found")
    s = await db.get(Session, rec.session_id)
    if user.role == UserRole.AGENT.value and s.agent_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your recording")
    if rec.status != RecordingStatus.READY.value or not rec.storage_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Recording not ready (status: {rec.status})")
    return await storage_service.signed_download_url(settings.s3_bucket_recordings, rec.storage_key, 3600)
