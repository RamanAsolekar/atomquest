"""Unit tests for token security (JWT + HMAC single-use invites)."""
import time

import pytest

from app.core import security


def test_password_hash_roundtrip():
    h = security.hash_password("Agent@123")
    assert security.verify_password("Agent@123", h)
    assert not security.verify_password("wrong", h)
    assert not security.verify_password("x", None)


def test_access_token_roundtrip():
    token, ttl = security.create_access_token("u1", "a@b.dev", "Agent", "AGENT", ["session:create"])
    assert ttl > 0
    payload = security.decode_access_token(token)
    assert payload["sub"] == "u1"
    assert payload["role"] == "AGENT"
    assert "session:create" in payload["permissions"]


def test_media_token_type_enforced():
    access, _ = security.create_access_token("u1", "a@b.dev", "Agent", "AGENT", [])
    with pytest.raises(Exception):
        security.decode_media_token(access)  # access token is not a media token


def test_invite_sign_and_verify():
    expires = int(time.time() * 1000) + 60_000
    token = security.sign_invite("sess-1", expires)
    session_id, exp = security.verify_invite(token)
    assert session_id == "sess-1"
    assert exp == expires


def test_invite_rejects_tampered_signature():
    token = security.sign_invite("sess-1", int(time.time() * 1000) + 60_000)
    body, _sig = token.split(".", 1)
    tampered = f"{body}.AAAAAAAAAAAAAAAAAAAAAAAA"
    with pytest.raises(ValueError):
        security.verify_invite(tampered)


def test_invite_rejects_expired():
    token = security.sign_invite("sess-1", int(time.time() * 1000) - 1000)
    with pytest.raises(ValueError):
        security.verify_invite(token)


def test_refresh_token_is_hashed():
    raw, hashed = security.new_refresh_token()
    assert raw != hashed
    assert hashed == security.sha256(raw)
    assert len(hashed) == 64
