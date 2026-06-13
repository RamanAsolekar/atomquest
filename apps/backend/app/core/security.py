"""JWT, password hashing and HMAC invite tokens."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=settings.bcrypt_rounds)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    return pwd_context.verify(password, hashed)


def create_access_token(sub: str, email: str, name: str, role: str, permissions: list[str]) -> tuple[str, int]:
    ttl = settings.jwt_access_ttl
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub, "email": email, "name": name, "role": role,
        "permissions": permissions, "type": "access",
        "iat": now, "exp": now + timedelta(seconds=ttl),
    }
    return jwt.encode(payload, settings.jwt_access_secret, algorithm="HS256"), ttl


def decode_access_token(token: str) -> dict:
    payload = jwt.decode(token, settings.jwt_access_secret, algorithms=["HS256"])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return payload


def create_media_token(participant_id: str, session_id: str, role: str, display_name: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": participant_id, "sessionId": session_id, "role": role,
        "displayName": display_name, "type": "media",
        "iat": now, "exp": now + timedelta(hours=2),
    }
    return jwt.encode(payload, settings.jwt_access_secret, algorithm="HS256")


def decode_media_token(token: str) -> dict:
    payload = jwt.decode(token, settings.jwt_access_secret, algorithms=["HS256"])
    if payload.get("type") != "media":
        raise jwt.InvalidTokenError("not a media token")
    return payload


# ---- refresh tokens (random; only the hash is stored) ----
def new_refresh_token() -> tuple[str, str]:
    raw = secrets.token_hex(48)
    return raw, sha256(raw)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# ---- HMAC-signed, single-use invite tokens ----
def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def sign_invite(session_id: str, expires_at_ms: int) -> str:
    rnd = _b64url(secrets.token_bytes(16))
    payload = f"{session_id}.{expires_at_ms}.{rnd}"
    sig = hmac.new(settings.invite_token_secret.encode(), payload.encode(), hashlib.sha256).digest()
    return f"{_b64url(payload.encode())}.{_b64url(sig)}"


def verify_invite(token: str) -> tuple[str, int]:
    """Returns (session_id, expires_at_ms). Raises ValueError if invalid."""
    if "." not in token:
        raise ValueError("malformed invite")
    encoded, sig = token.split(".", 1)
    try:
        payload = _b64url_decode(encoded).decode()
    except Exception as exc:  # noqa: BLE001
        raise ValueError("malformed invite") from exc
    expected = hmac.new(settings.invite_token_secret.encode(), payload.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64url(expected), sig):
        raise ValueError("invalid signature")
    session_id, expiry_str, _ = payload.split(".", 2)
    expiry = int(expiry_str)
    if expiry < int(time.time() * 1000):
        raise ValueError("expired")
    return session_id, expiry
