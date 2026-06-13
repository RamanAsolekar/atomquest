"""In-process + cross-replica event bus.

Every meaningful state change (session created/ended, participant joined/left,
recording status, new message, transcript segment, config/KB change, metric tick)
is published here. Subscribers include:
  - SSE endpoints that stream live updates to dashboards (no polling, nothing static)
  - the Socket.IO realtime gateway (room broadcasts)

Cross-replica fan-out uses Redis pub/sub so any backend instance can serve any
SSE/WebSocket client.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Any

from app.core.redis_client import redis, redis_pubsub

REDIS_CHANNEL = "atom:events"


class EventBus:
    def __init__(self) -> None:
        # topic -> set of asyncio.Queue
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._started = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        """Start the Redis pub/sub listener. Never blocks/raises on startup —
        if Redis is briefly unavailable the listener retries in the background."""
        async with self._lock:
            if self._started:
                return
            self._started = True
        asyncio.create_task(self._redis_listener())

    async def _redis_listener(self) -> None:
        import structlog

        log = structlog.get_logger("events")
        while True:
            try:
                pubsub = redis_pubsub.pubsub()
                await pubsub.subscribe(REDIS_CHANNEL)
                self._pubsub = pubsub
                log.info("event_bus_connected")
                async for msg in pubsub.listen():
                    if msg.get("type") != "message":
                        continue
                    try:
                        evt = json.loads(msg["data"])
                    except Exception:  # noqa: BLE001
                        continue
                    self._fanout_local(evt["topic"], evt)
            except Exception as exc:  # noqa: BLE001  (Redis down / connection lost)
                log.warning("event_bus_disconnected_retrying", error=str(exc))
                await asyncio.sleep(2)

    def _fanout_local(self, topic: str, evt: dict[str, Any]) -> None:
        for t in (topic, "*"):
            for q in list(self._subscribers.get(t, ())):
                try:
                    q.put_nowait(evt)
                except asyncio.QueueFull:
                    pass

    async def publish(self, topic: str, event_type: str, data: Any) -> None:
        """Publish an event. Goes to Redis (cross-replica) which loops back to
        all local subscribers via the listener. Redis being down must never break
        the request — we fan out locally as a fallback so single-node dev still
        gets live updates."""
        evt = {"topic": topic, "type": event_type, "data": data}
        try:
            await redis.publish(REDIS_CHANNEL, json.dumps(evt, default=str))
        except Exception:  # noqa: BLE001  Redis unavailable → degrade to local fan-out
            self._fanout_local(topic, evt)

    async def subscribe(self, topic: str) -> AsyncIterator[dict[str, Any]]:
        """Async generator yielding events for a topic (e.g. 'session:<id>',
        'admin', 'analytics', 'dashboard', or '*')."""
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers[topic].add(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._subscribers[topic].discard(q)


bus = EventBus()
