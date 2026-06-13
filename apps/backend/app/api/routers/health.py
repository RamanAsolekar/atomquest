from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import Response
from sqlalchemy import text

from app.core import metrics
from app.core.redis_client import redis
from app.db.session import engine

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    return {"status": "ok", "service": "atom-backend", "time": datetime.now(timezone.utc).isoformat()}


@router.get("/health/ready")
async def ready():
    checks = {}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "up"
    except Exception:  # noqa: BLE001
        checks["database"] = "down"
    try:
        await redis.ping()
        checks["redis"] = "up"
    except Exception:  # noqa: BLE001
        checks["redis"] = "down"
    ok = all(v == "up" for v in checks.values())
    return {"status": "ok" if ok else "degraded", "checks": checks}


@router.get("/metrics")
async def prometheus_metrics():
    return Response(content=metrics.render(), media_type="text/plain; version=0.0.4; charset=utf-8")
