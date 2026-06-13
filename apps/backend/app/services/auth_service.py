"""Authentication: login, registration, refresh-token rotation."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.enums import AuditAction, UserRole
from app.core.security import (
    create_access_token,
    hash_password,
    new_refresh_token,
    sha256,
    verify_password,
)
from app.models import Permission, RefreshToken, User, UserPermission
from app.schemas import AuthUser
from app.services import audit_service

AGENT_PERMS = [
    "session:create", "session:end_own", "recording:start", "recording:stop",
    "recording:download", "invite:create", "analytics:view",
]


async def _permissions_for(db: AsyncSession, user_id: str) -> list[str]:
    rows = (
        await db.execute(
            select(Permission.key)
            .join(UserPermission, UserPermission.permission_id == Permission.id)
            .where(UserPermission.user_id == user_id)
        )
    ).all()
    return [r[0] for r in rows]


def _to_auth_user(u: User) -> AuthUser:
    return AuthUser(id=u.id, email=u.email, name=u.name, role=u.role, avatar_url=u.avatar_url)


async def login(db: AsyncSession, email: str, password: str, ip: str | None, ua: str | None):
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        await audit_service.write(db, AuditAction.LOGIN_FAILED.value, actor_id=user.id if user else None,
                                  ip=ip, user_agent=ua, meta={"email": email})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    user.last_login_at = datetime.now(timezone.utc)
    perms = await _permissions_for(db, user.id)
    token, ttl = create_access_token(user.id, user.email, user.name, user.role, perms)
    raw_refresh, refresh_hash = new_refresh_token()
    db.add(RefreshToken(
        user_id=user.id, token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.jwt_refresh_ttl),
        ip=ip, user_agent=ua,
    ))
    await audit_service.write(db, AuditAction.LOGIN.value, actor_id=user.id, ip=ip, user_agent=ua)
    return _to_auth_user(user), token, ttl, raw_refresh


async def register(db: AsyncSession, email: str, name: str, password: str) -> AuthUser:
    exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=email, name=name, role=UserRole.AGENT.value, password_hash=hash_password(password),
        avatar_url=f"https://api.dicebear.com/9.x/initials/svg?seed={name}",
    )
    db.add(user)
    await db.flush()
    perms = (await db.execute(select(Permission).where(Permission.key.in_(AGENT_PERMS)))).scalars().all()
    for p in perms:
        db.add(UserPermission(user_id=user.id, permission_id=p.id))
    return _to_auth_user(user)


async def refresh(db: AsyncSession, raw_token: str | None, ip: str | None, ua: str | None):
    if not raw_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing refresh token")
    stored = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == sha256(raw_token)))
    ).scalar_one_or_none()
    if not stored or stored.revoked_at or stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")
    stored.revoked_at = datetime.now(timezone.utc)  # rotate
    user = await db.get(User, stored.user_id)
    perms = await _permissions_for(db, user.id)
    token, ttl = create_access_token(user.id, user.email, user.name, user.role, perms)
    raw_refresh, refresh_hash = new_refresh_token()
    db.add(RefreshToken(
        user_id=user.id, token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.jwt_refresh_ttl),
        ip=ip, user_agent=ua,
    ))
    return _to_auth_user(user), token, ttl, raw_refresh


async def logout(db: AsyncSession, raw_token: str | None, user_id: str | None):
    if raw_token:
        stored = (
            await db.execute(select(RefreshToken).where(RefreshToken.token_hash == sha256(raw_token)))
        ).scalar_one_or_none()
        if stored and not stored.revoked_at:
            stored.revoked_at = datetime.now(timezone.utc)
    if user_id:
        await audit_service.write(db, AuditAction.LOGOUT.value, actor_id=user_id)
