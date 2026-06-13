"""Aggregated analytics, computed live from the database (nothing precomputed/static)."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.enums import Sentiment, SessionStatus, UserRole
from app.models import AiInsight, Recording, Session


async def overview(db: AsyncSession, user) -> dict:
    scope_agent = user.role == UserRole.AGENT.value
    stmt = select(Session).options(selectinload(Session.participants), selectinload(Session.agent))
    if scope_agent:
        stmt = stmt.where(Session.agent_id == user.id)
    sessions = (await db.execute(stmt)).scalars().all()

    active_count = sum(1 for s in sessions if s.status == SessionStatus.ACTIVE.value)
    rec_stmt = select(func.count()).select_from(Recording)
    if scope_agent:
        rec_stmt = rec_stmt.join(Session, Session.id == Recording.session_id).where(Session.agent_id == user.id)
    recordings_count = (await db.execute(rec_stmt)).scalar() or 0

    ins_stmt = select(AiInsight).join(Session, Session.id == AiInsight.session_id)
    if scope_agent:
        ins_stmt = ins_stmt.where(Session.agent_id == user.id)
    insights = (await db.execute(ins_stmt)).scalars().all()

    ended = [s for s in sessions if s.status == SessionStatus.ENDED.value]
    total_participants = sum(len(s.participants) for s in sessions)
    durations = [s.duration_seconds for s in ended if s.duration_seconds]
    avg_duration = round(sum(durations) / len(durations)) if durations else 0
    qualities = [s.quality_score for s in sessions if s.quality_score is not None]
    avg_quality = round(sum(qualities) / len(qualities), 1) if qualities else 0

    sentiment_breakdown = {s.value: 0 for s in Sentiment}
    for i in insights:
        sentiment_breakdown[i.sentiment] = sentiment_breakdown.get(i.sentiment, 0) + 1
    resolved = sum(1 for i in insights if i.sentiment in (Sentiment.POSITIVE.value, Sentiment.NEUTRAL.value))
    resolution_rate = round(resolved / len(insights) * 100) if insights else 0

    by_day = {}
    today = datetime.now(timezone.utc).date()
    for i in range(13, -1, -1):
        by_day[(today - timedelta(days=i)).isoformat()] = 0
    for s in sessions:
        key = s.created_at.date().isoformat()
        if key in by_day:
            by_day[key] += 1

    cat = defaultdict(int)
    for i in insights:
        if i.issue_category:
            cat[i.issue_category] += 1
    top_cats = sorted(({"category": k, "count": v} for k, v in cat.items()), key=lambda x: -x["count"])[:6]

    agent_map: dict[str, dict] = {}
    for s in sessions:
        e = agent_map.setdefault(s.agent_id, {"agentName": s.agent.name if s.agent else "Agent", "sessions": 0, "q": [], "d": []})
        e["sessions"] += 1
        if s.quality_score is not None:
            e["q"].append(s.quality_score)
        if s.duration_seconds:
            e["d"].append(s.duration_seconds)
    leaderboard = sorted(
        [{"agentId": aid, "agentName": e["agentName"], "sessions": e["sessions"],
          "avgQuality": round(sum(e["q"]) / len(e["q"]), 1) if e["q"] else 0,
          "avgDuration": round(sum(e["d"]) / len(e["d"])) if e["d"] else 0}
         for aid, e in agent_map.items()],
        key=lambda x: -x["sessions"])[:10]

    heat = defaultdict(int)
    for s in sessions:
        heat[(s.created_at.weekday(), s.created_at.hour)] += 1
    heatmap = [{"day": d, "hour": h, "count": heat.get((d, h), 0)} for d in range(7) for h in range(24)]

    return {
        "totalSessions": len(sessions), "activeSessions": active_count,
        "totalParticipants": total_participants, "avgDurationSeconds": avg_duration,
        "avgQualityScore": avg_quality, "resolutionRate": resolution_rate,
        "recordingsCount": recordings_count, "sentimentBreakdown": sentiment_breakdown,
        "sessionsByDay": [{"date": k, "count": v} for k, v in by_day.items()],
        "topIssueCategories": top_cats, "agentLeaderboard": leaderboard, "heatmap": heatmap,
    }
