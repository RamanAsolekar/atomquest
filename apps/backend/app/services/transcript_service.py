"""Live transcript ingestion. The media server's Whisper worker posts segments
here; we persist them, broadcast to the room (live AI panel), and surface a KB
hint when the customer's speech matches a knowledge-base article."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import metrics
from app.core.enums import EventType
from app.core.events import bus
from app.models import Transcript
from app.services import ai_service, config_service, session_service


async def ingest(db: AsyncSession, session_id: str, text: str, speaker: str | None,
                 start_ms: int | None, end_ms: int | None, is_final: bool) -> dict:
    enabled = await config_service.get(db, "live_transcription_enabled")
    if not enabled or not text.strip():
        return {"ignored": True}

    seg = Transcript(session_id=session_id, text=text.strip(), speaker=speaker,
                     start_ms=start_ms, end_ms=end_ms, is_final=is_final)
    db.add(seg)
    await db.flush()
    metrics.transcripts_total.inc()

    # ISO string — this payload is relayed over socket.io (rt:transcript), whose
    # JSON encoder cannot serialize raw datetimes.
    payload = {"id": seg.id, "sessionId": session_id, "speaker": speaker, "text": seg.text,
               "isFinal": is_final, "createdAt": seg.created_at.isoformat() if seg.created_at else None}
    await bus.publish(f"session:{session_id}", "transcript", payload)

    if is_final:
        await session_service.record_event(db, session_id, EventType.TRANSCRIPT.value, speaker, {"text": seg.text[:200]})
        # live KB hint based on what was just said
        kb = await ai_service.match_kb(db, text)
        if kb:
            await bus.publish(f"session:{session_id}", "ai_insight", {"type": "kb_suggestion", "items": kb})
    return payload


async def get_for_session(db: AsyncSession, session_id: str) -> list[dict]:
    rows = (await db.execute(select(Transcript).where(Transcript.session_id == session_id).order_by(Transcript.created_at.asc()))).scalars().all()
    return [{"id": r.id, "speaker": r.speaker, "text": r.text, "isFinal": r.is_final, "createdAt": r.created_at} for r in rows]
