"""Prometheus metrics (exposed at /metrics)."""
from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest

registry = CollectorRegistry()

active_sessions = Gauge("atom_active_sessions", "Sessions currently ACTIVE", registry=registry)
connected_participants = Gauge(
    "atom_connected_participants", "Participants currently connected", registry=registry
)
sessions_created = Counter("atom_sessions_created_total", "Total sessions created", registry=registry)
sessions_ended = Counter(
    "atom_sessions_ended_total", "Total sessions ended", ["reason"], registry=registry
)
messages_total = Counter("atom_messages_total", "Total chat messages sent", registry=registry)
recordings_total = Counter(
    "atom_recordings_total", "Recordings by terminal status", ["status"], registry=registry
)
errors_total = Counter("atom_errors_total", "Handled errors", ["type"], registry=registry)
http_request_duration = Histogram(
    "atom_http_request_duration_seconds",
    "HTTP request duration",
    ["method", "route", "status"],
    buckets=(0.01, 0.05, 0.1, 0.3, 0.5, 1, 3, 5),
    registry=registry,
)
reconnects_total = Counter(
    "atom_reconnects_total", "Successful reconnections within grace window", registry=registry
)
transcripts_total = Counter(
    "atom_transcripts_total", "Total live transcript segments ingested", registry=registry
)
sse_subscribers = Gauge(
    "atom_sse_subscribers", "Active SSE/live-stream subscribers", registry=registry
)


def render() -> bytes:
    return generate_latest(registry)
