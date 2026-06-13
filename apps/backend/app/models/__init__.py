"""SQLAlchemy models for Atom Support Vision.

Mirrors the original Prisma schema and adds dynamic-platform tables:
  - KbArticle    : runtime-editable knowledge base (replaces hardcoded KB)
  - AppConfig    : runtime config + feature flags (replaces static constants)
  - Transcript   : live Whisper STT segments per session
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    DateTime,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    MessageType,
    ParticipantRole,
    ParticipantStatus,
    RecordingStatus,
    Sentiment,
    SessionStatus,
    UserRole,
)
from app.db.base import Base, created_col, updated_col, uuid_pk


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = uuid_pk()
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[str] = mapped_column(String, default=UserRole.AGENT.value, index=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()

    permissions: Mapped[list["UserPermission"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Permission(Base):
    __tablename__ = "permissions"
    id: Mapped[str] = uuid_pk()
    key: Mapped[str] = mapped_column(String, unique=True)
    description: Mapped[str] = mapped_column(String)


class UserPermission(Base):
    __tablename__ = "user_permissions"
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )
    granted_at: Mapped[datetime] = created_col()
    user: Mapped[User] = relationship(back_populates="permissions")
    permission: Mapped[Permission] = relationship()


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = uuid_pk()
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_col()


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = uuid_pk()
    code: Mapped[str] = mapped_column(String, unique=True, index=True)
    title: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default=SessionStatus.WAITING.value, index=True)
    agent_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id"), index=True)
    customer_name: Mapped[str | None] = mapped_column(String, nullable=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()

    agent: Mapped[User] = relationship()
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    recordings: Mapped[list["Recording"]] = relationship(cascade="all, delete-orphan")
    ai_insight: Mapped["AiInsight | None"] = relationship(
        back_populates="session", uselist=False, cascade="all, delete-orphan"
    )


class Invite(Base):
    __tablename__ = "invites"
    id: Mapped[str] = uuid_pk()
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    customer_name: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_col()
    session: Mapped[Session] = relationship()


class Participant(Base):
    __tablename__ = "participants"
    id: Mapped[str] = uuid_pk()
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True, index=True
    )
    display_name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default=ParticipantStatus.INVITED.value, index=True)
    socket_id: Mapped[str | None] = mapped_column(String, nullable=True)
    audio_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    video_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    screen_sharing: Mapped[bool] = mapped_column(Boolean, default=False)
    connection_quality: Mapped[str | None] = mapped_column(String, nullable=True)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()
    session: Mapped[Session] = relationship(back_populates="participants")


class SharedFile(Base):
    __tablename__ = "shared_files"
    id: Mapped[str] = uuid_pk()
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    uploader_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    uploader_name: Mapped[str] = mapped_column(String)
    file_name: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String)
    checksum: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_col()


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = uuid_pk()
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    sender_name: Mapped[str] = mapped_column(String)
    sender_role: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String, default=MessageType.TEXT.value)
    body: Mapped[str] = mapped_column(Text)
    file_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("shared_files.id"), nullable=True
    )
    created_at: Mapped[datetime] = created_col()


class Recording(Base):
    __tablename__ = "recordings"
    id: Mapped[str] = uuid_pk()
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String, default=RecordingStatus.RECORDING.value, index=True)
    storage_key: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class SessionEvent(Base):
    __tablename__ = "session_events"
    id: Mapped[str] = uuid_pk()
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String, index=True)
    actor_name: Mapped[str | None] = mapped_column(String, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = created_col()


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = uuid_pk()
    actor_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String, index=True)
    target_type: Mapped[str | None] = mapped_column(String, nullable=True)
    target_id: Mapped[str | None] = mapped_column(String, nullable=True)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    meta: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = created_col()
    actor: Mapped[User | None] = relationship()


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = uuid_pk()
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String, default="info")
    read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    link: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_col()


class Metric(Base):
    __tablename__ = "metrics"
    id: Mapped[str] = uuid_pk()
    name: Mapped[str] = mapped_column(String, index=True)
    value: Mapped[float] = mapped_column(Float)
    labels: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = created_col()


class AiInsight(Base):
    __tablename__ = "ai_insights"
    id: Mapped[str] = uuid_pk()
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), unique=True
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    sentiment: Mapped[str] = mapped_column(String, default=Sentiment.NEUTRAL.value)
    issue_category: Mapped[str | None] = mapped_column(String, nullable=True)
    action_items: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    support_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    kb_suggestions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()
    session: Mapped[Session] = relationship(back_populates="ai_insight")


# ---------------------------------------------------------------- dynamic tables
class Transcript(Base):
    """Live speech-to-text segments produced by the media server's Whisper worker."""

    __tablename__ = "transcripts"
    id: Mapped[str] = uuid_pk()
    session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    speaker: Mapped[str | None] = mapped_column(String, nullable=True)
    text: Mapped[str] = mapped_column(Text)
    start_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_final: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created_col()


class KbArticle(Base):
    """Runtime-editable knowledge base (replaces the hardcoded KB array)."""

    __tablename__ = "kb_articles"
    id: Mapped[str] = uuid_pk()
    title: Mapped[str] = mapped_column(String)
    url: Mapped[str] = mapped_column(String)
    snippet: Mapped[str] = mapped_column(Text)
    keywords: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class AppConfig(Base):
    """Runtime configuration + feature flags (replaces static constants)."""

    __tablename__ = "app_config"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime] = updated_col()
