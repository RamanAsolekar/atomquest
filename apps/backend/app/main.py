"""Atom Support Vision API — FastAPI app with a mounted Socket.IO realtime
gateway. Everything is live: SSE streams + WebSocket gateway + event bus."""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager

import socketio
import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routers import (
    admin,
    ai,
    analytics,
    audit,
    auth,
    chat,
    config as config_router,
    files,
    health,
    recordings,
    sessions,
    stream,
    transcripts,
)
from app.core import metrics
from app.core.config import settings
from app.core.events import bus
from app.core.telemetry import setup_logging, setup_tracing
from app.db.seed import run as run_seed
from app.db.session import SessionLocal
from app.realtime.gateway import event_relay, sio
from app.services import storage_service

setup_logging()
log = structlog.get_logger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await bus.start()
    asyncio.create_task(event_relay())
    try:
        await storage_service.ensure_buckets()
    except Exception as exc:  # noqa: BLE001
        log.warning("bucket_init_failed", error=str(exc))
    if settings.env != "production" or settings.env == "production":
        # auto-seed (idempotent) so the demo is usable immediately
        try:
            async with SessionLocal() as db:
                await run_seed(db)
        except Exception as exc:  # noqa: BLE001
            log.warning("seed_skipped", error=str(exc))
    log.info("startup_complete", port=settings.api_port)
    yield


api = FastAPI(
    title="Atom Support Vision API",
    description="Self-hosted real-time video customer-support platform (FastAPI).",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

api.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.middleware("http")
async def metrics_mw(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    metrics.http_request_duration.labels(request.method, path, str(response.status_code)).observe(time.perf_counter() - start)
    if response.status_code >= 500:
        metrics.errors_total.labels("http_5xx").inc()
    elif response.status_code >= 400:
        metrics.errors_total.labels("http_4xx").inc()
    return response


@api.exception_handler(StarletteHTTPException)
async def http_exc_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"statusCode": exc.status_code, "message": exc.detail, "path": request.url.path},
    )


# REST routers under /api
PREFIX = f"/{settings.api_global_prefix}"
for r in (auth, sessions, chat, recordings, files, admin, analytics, ai, audit, transcripts, config_router, stream):
    api.include_router(r.router, prefix=PREFIX)

# health + metrics at root (no /api prefix) so probes/Prometheus stay simple
api.include_router(health.router)

# Mount Socket.IO (/rt namespace lives under /socket.io/ path) onto the ASGI app.
app = socketio.ASGIApp(sio, other_asgi_app=api, socketio_path="socket.io")
setup_tracing(api)


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.api_port, log_level="info")


if __name__ == "__main__":
    run()
