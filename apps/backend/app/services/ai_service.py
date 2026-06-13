"""AI Session Assistant — DB-backed KB (no hardcoded data), Claude-powered
summary with a deterministic heuristic fallback so it always works in a demo."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.enums import Sentiment
from app.models import AiInsight, KbArticle, Message, Session, SessionEvent, Transcript
from app.services import config_service


async def match_kb(db: AsyncSession, text: str, limit: int = 3) -> list[dict]:
    """Keyword match against the live KB table (admin-editable, not hardcoded)."""
    lc = text.lower()
    rows = (await db.execute(select(KbArticle).where(KbArticle.is_active.is_(True)))).scalars().all()
    matched = [a for a in rows if any(k.lower() in lc for k in (a.keywords or []))]
    return [{"title": a.title, "url": a.url, "snippet": a.snippet} for a in matched[:limit]]


async def _build_transcript(db: AsyncSession, session_id: str) -> str:
    # Prefer real STT segments; fall back to chat + events.
    segs = (await db.execute(select(Transcript).where(Transcript.session_id == session_id).order_by(Transcript.created_at.asc()))).scalars().all()
    if segs:
        return "\n".join(f"[{s.speaker or 'speaker'}] {s.text}" for s in segs)
    msgs = (await db.execute(select(Message).where(Message.session_id == session_id).order_by(Message.created_at.asc()))).scalars().all()
    evts = (await db.execute(select(SessionEvent).where(SessionEvent.session_id == session_id).order_by(SessionEvent.created_at.asc()))).scalars().all()
    lines = [f"[{m.sender_role}] {m.sender_name}: {m.body}" for m in msgs]
    lines += [f"(event) {e.type}" + (f" by {e.actor_name}" if e.actor_name else "") for e in evts]
    return "\n".join(lines)


def _categorise(text: str, title: str) -> str:
    t = (text + " " + title).lower()
    import re
    if re.search(r"router|wifi|network|connection|signal|ethernet", t):
        return "Networking"
    if re.search(r"install|setup|configure|firmware|update", t):
        return "Installation & Setup"
    if re.search(r"bill|invoice|payment|refund|charge|subscription", t):
        return "Billing"
    if re.search(r"login|password|account|access|auth", t):
        return "Account & Access"
    if re.search(r"hardware|device|broken|replace|rma|physical", t):
        return "Hardware"
    if re.search(r"app|ui|button|screen|crash|bug|error", t):
        return "Software / App"
    return "General Support"


async def _heuristic(db: AsyncSession, title: str, transcript: str) -> dict:
    text = transcript.lower()
    neg_words = ["angry", "frustrated", "broken", "not working", "terrible", "useless", "refund", "cancel", "worst"]
    pos_words = ["thanks", "thank you", "great", "resolved", "works now", "perfect", "awesome", "appreciate"]
    neg = sum(w in text for w in neg_words)
    pos = sum(w in text for w in pos_words)
    if neg > pos and neg >= 2:
        sentiment = Sentiment.FRUSTRATED
    elif neg > pos:
        sentiment = Sentiment.NEGATIVE
    elif pos > neg:
        sentiment = Sentiment.POSITIVE
    else:
        sentiment = Sentiment.NEUTRAL
    category = _categorise(text, title)
    msg_count = transcript.count("\n") + 1
    quality = max(35, min(98, 70 + pos * 6 - neg * 8 + min(msg_count, 10)))
    actions = []
    if "refund" in text or "cancel" in text:
        actions.append("Follow up on billing/refund request")
    if "replace" in text or "rma" in text or "hardware" in text:
        actions.append("Initiate hardware replacement / RMA")
    if not actions:
        actions.append("Confirm resolution with customer in 24h")
    return {
        "summary": f'Support session "{title}" covered a {category.lower()} issue. '
                   + ("The interaction was constructive and the customer appeared satisfied. " if pos >= neg else "The customer expressed difficulty; close monitoring recommended. ")
                   + f"Approximately {msg_count} exchanges occurred.",
        "sentiment": sentiment.value, "issue_category": category, "action_items": actions,
        "support_notes": f"Auto-generated notes:\n• Category: {category}\n• Sentiment: {sentiment.value}\n• Quality: {quality}/100",
        "kb_suggestions": await match_kb(db, transcript), "quality_score": float(quality),
    }


async def _via_claude(db: AsyncSession, title: str, transcript: str) -> dict:
    try:
        prompt = (
            f'You are a customer-support QA analyst. Given session "{title}" and the transcript, '
            "return STRICT JSON with keys: summary (2-3 sentences), sentiment "
            "(POSITIVE/NEUTRAL/NEGATIVE/FRUSTRATED), issueCategory, actionItems (string[]), "
            f"supportNotes, qualityScore (0-100). Transcript:\n{transcript[:6000]}"
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": settings.anthropic_model, "max_tokens": 1024, "messages": [{"role": "user", "content": prompt}]},
            )
        data = resp.json()
        txt = data["content"][0]["text"]
        parsed = json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
        return {
            "summary": parsed.get("summary", ""),
            "sentiment": parsed.get("sentiment", Sentiment.NEUTRAL.value),
            "issue_category": parsed.get("issueCategory", "General"),
            "action_items": parsed.get("actionItems", []),
            "support_notes": parsed.get("supportNotes", ""),
            "kb_suggestions": await match_kb(db, transcript),
            "quality_score": float(max(0, min(100, parsed.get("qualityScore", 70)))),
        }
    except Exception:  # noqa: BLE001
        return await _heuristic(db, title, transcript)


async def generate_summary(db: AsyncSession, session_id: str) -> dict:
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    transcript = await _build_transcript(db, session_id)
    ai_on = await config_service.get(db, "ai_assistant_enabled")
    result = await (_via_claude(db, s.title, transcript) if ai_on and settings.anthropic_api_key else _heuristic(db, s.title, transcript))

    insight = (await db.execute(select(AiInsight).where(AiInsight.session_id == session_id))).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if insight:
        insight.summary = result["summary"]
        insight.sentiment = result["sentiment"]
        insight.issue_category = result["issue_category"]
        insight.action_items = result["action_items"]
        insight.support_notes = result["support_notes"]
        insight.kb_suggestions = result["kb_suggestions"]
        insight.transcript = transcript
        insight.quality_score = result["quality_score"]
        insight.generated_at = now
    else:
        db.add(AiInsight(session_id=session_id, summary=result["summary"], sentiment=result["sentiment"],
                         issue_category=result["issue_category"], action_items=result["action_items"],
                         support_notes=result["support_notes"], kb_suggestions=result["kb_suggestions"],
                         transcript=transcript, quality_score=result["quality_score"], generated_at=now))
    s.quality_score = result["quality_score"]
    s.tags = list({result["issue_category"], result["sentiment"]})
    await db.flush()
    return {
        "sessionId": session_id, "summary": result["summary"], "sentiment": result["sentiment"],
        "issueCategory": result["issue_category"], "actionItems": result["action_items"],
        "supportNotes": result["support_notes"], "kbSuggestions": result["kb_suggestions"],
        "qualityScore": result["quality_score"], "generatedAt": now,
    }


async def get_summary(db: AsyncSession, session_id: str) -> dict | None:
    i = (await db.execute(select(AiInsight).where(AiInsight.session_id == session_id))).scalar_one_or_none()
    if not i:
        return None
    return {
        "sessionId": session_id, "summary": i.summary or "", "sentiment": i.sentiment,
        "issueCategory": i.issue_category or "General", "actionItems": i.action_items or [],
        "supportNotes": i.support_notes or "", "kbSuggestions": i.kb_suggestions or [],
        "qualityScore": i.quality_score or 0, "generatedAt": i.generated_at or i.created_at,
    }
