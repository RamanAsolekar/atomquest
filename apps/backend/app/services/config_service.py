"""Runtime configuration & feature flags, backed by the app_config table.

Nothing is hardcoded: reconnect grace window, file limits, AI toggle, allowed
mime types, codec hints — all live here and are editable by admins at runtime
(changes broadcast over the event bus so clients pick them up immediately).
"""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import enums
from app.core.events import bus
from app.models import AppConfig

DEFAULTS: dict[str, Any] = {
    "reconnect_grace_ms": enums.RECONNECT_GRACE_MS,
    "max_file_size_bytes": enums.MAX_FILE_SIZE_BYTES,
    "max_message_length": enums.MAX_MESSAGE_LENGTH,
    "allowed_file_mime": enums.ALLOWED_FILE_MIME,
    "ai_assistant_enabled": True,
    "live_transcription_enabled": True,
    "recording_enabled": True,
    "max_participants": 8,
    "invite_default_ttl_seconds": 86400,
}

_DESCRIPTIONS = {
    "reconnect_grace_ms": "How long a dropped participant's slot is held (ms).",
    "max_file_size_bytes": "Maximum in-chat upload size (bytes).",
    "ai_assistant_enabled": "Master switch for the AI session assistant.",
    "live_transcription_enabled": "Stream Whisper transcripts into the call.",
    "recording_enabled": "Allow agents to record sessions.",
}

# tiny in-process cache so we don't hit the DB on every check
_cache: dict[str, Any] = {}
_cache_at: float = 0.0
_TTL = 5.0


async def ensure_seeded(db: AsyncSession) -> None:
    existing = {row[0] for row in (await db.execute(select(AppConfig.key))).all()}
    for key, value in DEFAULTS.items():
        if key not in existing:
            db.add(AppConfig(key=key, value={"v": value}, description=_DESCRIPTIONS.get(key)))
    await db.flush()


async def get_all(db: AsyncSession) -> dict[str, Any]:
    rows = (await db.execute(select(AppConfig))).scalars().all()
    out = {**{k: {"v": v} for k, v in DEFAULTS.items()}, **{r.key: r.value for r in rows}}
    return {k: (v.get("v") if isinstance(v, dict) and "v" in v else v) for k, v in out.items()}


async def get(db: AsyncSession, key: str) -> Any:
    global _cache, _cache_at
    if time.time() - _cache_at > _TTL or not _cache:
        _cache = await get_all(db)
        _cache_at = time.time()
    return _cache.get(key, DEFAULTS.get(key))


async def set_value(db: AsyncSession, key: str, value: Any) -> None:
    row = await db.get(AppConfig, key)
    if row:
        row.value = {"v": value}
    else:
        db.add(AppConfig(key=key, value={"v": value}, description=_DESCRIPTIONS.get(key)))
    await db.flush()
    global _cache_at
    _cache_at = 0.0  # invalidate cache
    await bus.publish("config", "config_updated", {"key": key, "value": value})
