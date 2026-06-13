"""In-call file sharing — magic-byte validation, S3 storage, surfaced into chat."""
from __future__ import annotations

import hashlib
import re
import secrets
import time

import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.enums import MessageType, ParticipantRole
from app.core.events import bus
from app.core.security import decode_media_token
from app.models import SharedFile
from app.services import chat_service, config_service, storage_service


def resolve_participant(media_token: str) -> dict:
    try:
        return decode_media_token(media_token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid media token") from exc


def _sniff(buf: bytes) -> str | None:
    if len(buf) < 4:
        return None
    head = buf[:4].hex()
    if head.startswith("89504e47"):
        return "image/png"
    if head.startswith("ffd8ff"):
        return "image/jpeg"
    if head.startswith("47494638"):
        return "image/gif"
    if head.startswith("25504446"):
        return "application/pdf"
    if buf[:4] == b"RIFF":
        return "image/webp"
    if head.startswith("504b0304"):
        return None  # zip/docx/xlsx — trust declared
    return None


async def upload(db: AsyncSession, session_id: str, uploader_name: str, filename: str, declared_mime: str, content: bytes) -> dict:
    max_size = await config_service.get(db, "max_file_size_bytes")
    allowed = await config_service.get(db, "allowed_file_mime")
    if len(content) > max_size:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"File exceeds {max_size // 1024 // 1024}MB limit")
    detected = _sniff(content) or declared_mime
    if detected not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported file type: {detected}")

    safe = re.sub(r"[^\w.\-]+", "_", filename)[:200]
    key = f"{session_id}/{int(time.time())}-{secrets.token_hex(6)}-{safe}"
    await storage_service.put_object(settings.s3_bucket_files, key, content, detected)

    rec = SharedFile(session_id=session_id, uploader_name=uploader_name, file_name=safe,
                     mime_type=detected, size_bytes=len(content), storage_key=key,
                     checksum=hashlib.sha256(content).hexdigest())
    db.add(rec)
    await db.flush()

    msg = await chat_service.persist(db, session_id, uploader_name, ParticipantRole.CUSTOMER.value,
                                     safe, MessageType.FILE.value, file_id=rec.id)
    await bus.publish(f"session:{session_id}", "message", msg)
    return {
        "id": rec.id, "sessionId": session_id, "uploaderName": uploader_name, "fileName": safe,
        "mimeType": detected, "sizeBytes": len(content), "storageKey": key,
        "downloadUrl": f"/api/files/{rec.id}/download", "createdAt": rec.created_at,
    }


async def download_url(db: AsyncSession, file_id: str) -> str:
    f = await db.get(SharedFile, file_id)
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return await storage_service.signed_download_url(settings.s3_bucket_files, f.storage_key)


async def list_for_session(db: AsyncSession, session_id: str) -> list[dict]:
    rows = (await db.execute(select(SharedFile).where(SharedFile.session_id == session_id).order_by(SharedFile.created_at.asc()))).scalars().all()
    return [{
        "id": f.id, "sessionId": f.session_id, "uploaderName": f.uploader_name, "fileName": f.file_name,
        "mimeType": f.mime_type, "sizeBytes": f.size_bytes, "storageKey": f.storage_key,
        "downloadUrl": f"/api/files/{f.id}/download", "createdAt": f.created_at,
    } for f in rows]
