"""Redis client + presence / reconnect-grace helpers.

All helpers are best-effort: if Redis is briefly unavailable they log and no-op
rather than throwing, so a join/disconnect is never blocked by Redis. (The
gateway keeps an in-process grace timer too, so single-node dev works without
cross-replica state.)
"""
from __future__ import annotations

import structlog
import redis.asyncio as aioredis

from app.core.config import settings

log = structlog.get_logger("redis")

# Regular command client — short timeouts are appropriate for HSET/GET/PUBLISH etc.
redis: aioredis.Redis = aioredis.from_url(
    settings.redis_url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2
)

# Dedicated pub/sub client — SUBSCRIBE blocks indefinitely waiting for messages;
# a socket_timeout would raise TimeoutError every N seconds and cause a reconnect
# storm. No socket_timeout here is intentional and correct for pub/sub.
redis_pubsub: aioredis.Redis = aioredis.from_url(
    settings.redis_url, decode_responses=True, socket_connect_timeout=5
)


def presence_key(session_id: str) -> str:
    return f"presence:{session_id}"


async def add_presence(session_id: str, participant_id: str, socket_id: str) -> None:
    try:
        await redis.hset(presence_key(session_id), participant_id, socket_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("redis_unavailable", op="add_presence", error=str(exc))


async def remove_presence(session_id: str, participant_id: str) -> None:
    try:
        await redis.hdel(presence_key(session_id), participant_id)
    except Exception:  # noqa: BLE001
        pass


async def clear_presence(session_id: str) -> None:
    try:
        await redis.delete(presence_key(session_id))
    except Exception:  # noqa: BLE001
        pass


async def set_grace(session_id: str, participant_id: str, ttl_ms: int) -> None:
    try:
        await redis.set(f"grace:{session_id}:{participant_id}", "1", px=ttl_ms)
    except Exception:  # noqa: BLE001
        pass


async def clear_grace(session_id: str, participant_id: str) -> None:
    try:
        await redis.delete(f"grace:{session_id}:{participant_id}")
    except Exception:  # noqa: BLE001
        pass


async def in_grace(session_id: str, participant_id: str) -> bool:
    try:
        return await redis.exists(f"grace:{session_id}:{participant_id}") == 1
    except Exception:  # noqa: BLE001
        return False
