"""Domain enums — mirror packages/shared/src/enums.ts so the wire protocol
stays identical across the FastAPI backend, media server and web client."""
from __future__ import annotations

from enum import Enum


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    AGENT = "AGENT"
    CUSTOMER = "CUSTOMER"


class SessionStatus(str, Enum):
    SCHEDULED = "SCHEDULED"
    WAITING = "WAITING"
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"
    CANCELLED = "CANCELLED"


class ParticipantRole(str, Enum):
    AGENT = "AGENT"
    CUSTOMER = "CUSTOMER"
    OBSERVER = "OBSERVER"


class ParticipantStatus(str, Enum):
    INVITED = "INVITED"
    CONNECTED = "CONNECTED"
    RECONNECTING = "RECONNECTING"
    DISCONNECTED = "DISCONNECTED"
    LEFT = "LEFT"


class RecordingStatus(str, Enum):
    IDLE = "IDLE"
    RECORDING = "RECORDING"
    PROCESSING = "PROCESSING"
    READY = "READY"
    FAILED = "FAILED"


class MessageType(str, Enum):
    TEXT = "TEXT"
    FILE = "FILE"
    SYSTEM = "SYSTEM"


class Sentiment(str, Enum):
    POSITIVE = "POSITIVE"
    NEUTRAL = "NEUTRAL"
    NEGATIVE = "NEGATIVE"
    FRUSTRATED = "FRUSTRATED"


class EventType(str, Enum):
    SESSION_CREATED = "SESSION_CREATED"
    SESSION_ENDED = "SESSION_ENDED"
    PARTICIPANT_JOINED = "PARTICIPANT_JOINED"
    PARTICIPANT_LEFT = "PARTICIPANT_LEFT"
    PARTICIPANT_RECONNECTED = "PARTICIPANT_RECONNECTED"
    PARTICIPANT_DROPPED = "PARTICIPANT_DROPPED"
    RECORDING_STARTED = "RECORDING_STARTED"
    RECORDING_STOPPED = "RECORDING_STOPPED"
    RECORDING_READY = "RECORDING_READY"
    MEDIA_TOGGLED = "MEDIA_TOGGLED"
    SCREEN_SHARE_STARTED = "SCREEN_SHARE_STARTED"
    SCREEN_SHARE_STOPPED = "SCREEN_SHARE_STOPPED"
    FILE_SHARED = "FILE_SHARED"
    CHAT_MESSAGE = "CHAT_MESSAGE"
    TRANSCRIPT = "TRANSCRIPT"
    ERROR = "ERROR"


class AuditAction(str, Enum):
    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"
    LOGIN_FAILED = "LOGIN_FAILED"
    CREATE_SESSION = "CREATE_SESSION"
    END_SESSION = "END_SESSION"
    FORCE_END_SESSION = "FORCE_END_SESSION"
    GENERATE_INVITE = "GENERATE_INVITE"
    REVOKE_INVITE = "REVOKE_INVITE"
    START_RECORDING = "START_RECORDING"
    STOP_RECORDING = "STOP_RECORDING"
    DOWNLOAD_RECORDING = "DOWNLOAD_RECORDING"
    UPLOAD_FILE = "UPLOAD_FILE"
    VIEW_ANALYTICS = "VIEW_ANALYTICS"
    UPDATE_CONFIG = "UPDATE_CONFIG"
    UPDATE_KB = "UPDATE_KB"


# Runtime constants (mirror packages/shared/src/constants.ts) — note these are
# DEFAULTS; the live values are read from the app_config table at runtime.
RECONNECT_GRACE_MS = 15_000
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
MAX_MESSAGE_LENGTH = 4000
SESSION_CODE_LENGTH = 10
ALLOWED_FILE_MIME = [
    "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
    "text/plain", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
]
