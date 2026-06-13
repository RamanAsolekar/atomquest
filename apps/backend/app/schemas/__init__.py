"""Pydantic request/response models. Field names use camelCase aliases so the
JSON wire format is identical to the previous NestJS API (the web client is
unchanged)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


def _camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True, from_attributes=True)


# ---- auth ----
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class RegisterRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=8, max_length=128)


class AuthUser(CamelModel):
    id: str
    email: str
    name: str
    role: str
    avatar_url: str | None = None


class LoginResponse(CamelModel):
    user: AuthUser
    access_token: str
    expires_in: int


# ---- sessions ----
class CreateSessionRequest(CamelModel):
    title: str = Field(min_length=2, max_length=120)
    customer_name: str | None = Field(default=None, max_length=80)
    scheduled_at: str | None = None
    tags: list[str] | None = None


class CreateInviteRequest(CamelModel):
    customer_name: str | None = Field(default=None, max_length=80)
    expires_in_seconds: int | None = Field(default=None, ge=60)


class JoinSessionRequest(CamelModel):
    invite_token: str | None = None
    display_name: str = Field(min_length=1, max_length=80)


class ParticipantOut(CamelModel):
    id: str
    session_id: str
    user_id: str | None = None
    display_name: str
    role: str
    status: str
    joined_at: datetime | None = None
    left_at: datetime | None = None
    duration_seconds: int | None = None
    audio_enabled: bool = True
    video_enabled: bool = True
    screen_sharing: bool = False
    connection_quality: str | None = None


class SessionOut(CamelModel):
    id: str
    code: str
    title: str
    status: str
    agent_id: str
    agent_name: str
    customer_name: str | None = None
    recording_status: str = "IDLE"
    recording_id: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_seconds: int | None = None
    participant_count: int = 0
    participants: list[ParticipantOut] | None = None
    tags: list[str] = []
    quality_score: float | None = None
    summary: str | None = None
    sentiment: str | None = None


class JoinResponse(CamelModel):
    session: SessionOut
    participant: ParticipantOut
    media_token: str


# ---- runtime config + KB ----
class ConfigUpdate(BaseModel):
    value: dict | list | str | int | float | bool


class KbArticleIn(CamelModel):
    title: str
    url: str
    snippet: str
    keywords: list[str] = []
    category: str | None = None
    is_active: bool = True


class KbArticleOut(KbArticleIn):
    id: str
