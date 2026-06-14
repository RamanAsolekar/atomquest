"""Chat persistence + history retrieval."""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import metrics
from app.core.enums import MessageType
from app.models import Message, SharedFile
from app.services import config_service


def _dto(m: Message, f: SharedFile | None = None) -> dict:
    return {
        "id": m.id, "sessionId": m.session_id, "senderId": m.sender_id,
        "senderName": m.sender_name, "senderRole": m.sender_role, "type": m.type, "body": m.body,
        "fileId": m.file_id, "fileName": f.file_name if f else None,
        "fileMime": f.mime_type if f else None, "fileSize": f.size_bytes if f else None,
        "fileUrl": f"/api/files/{f.id}/download" if f else None,
        # ISO string: this DTO is emitted over socket.io (rt:message), whose JSON
        # encoder cannot serialize raw datetimes — a raw value crashes the send.
        "createdAt": m.created_at.isoformat() if m.created_at else None,
    }


async def persist(db: AsyncSession, session_id: str, sender_name: str, sender_role: str, body: str,
                  mtype: str = MessageType.TEXT.value, file_id: str | None = None, sender_id: str | None = None) -> dict:
    if mtype != MessageType.FILE.value:
        max_len = await config_service.get(db, "max_message_length")
        if not body or len(body) > max_len:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message empty or too long")
    m = Message(session_id=session_id, sender_id=sender_id, sender_name=sender_name,
                sender_role=sender_role, type=mtype, body=body, file_id=file_id)
    db.add(m)
    await db.flush()
    metrics.messages_total.inc()
    f = await db.get(SharedFile, file_id) if file_id else None
    return _dto(m, f)


async def history(db: AsyncSession, session_id: str) -> list[dict]:
    rows = (await db.execute(select(Message).where(Message.session_id == session_id).order_by(Message.created_at.asc()))).scalars().all()
    file_ids = [r.file_id for r in rows if r.file_id]
    files = {}
    if file_ids:
        for f in (await db.execute(select(SharedFile).where(SharedFile.id.in_(file_ids)))).scalars().all():
            files[f.id] = f
    return [_dto(r, files.get(r.file_id)) for r in rows]
