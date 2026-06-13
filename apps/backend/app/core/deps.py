"""FastAPI dependencies: current user, RBAC role/permission gates.

This replaces the NestJS guards. ADMIN implicitly satisfies any role/permission
check, exactly as before — a CUSTOMER can never reach an agent-gated route.
"""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status

from app.core.enums import UserRole
from app.core.security import decode_access_token


@dataclass
class CurrentUser:
    id: str
    email: str
    name: str
    role: str
    permissions: list[str]


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


async def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc
    return CurrentUser(
        id=payload["sub"],
        email=payload["email"],
        name=payload["name"],
        role=payload["role"],
        permissions=payload.get("permissions", []),
    )


async def get_optional_user(authorization: str | None = Header(default=None)) -> CurrentUser | None:
    """Used by /join: agents are recognised by JWT; customers join by invite."""
    token = _extract_bearer(authorization)
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        return None
    return CurrentUser(
        id=payload["sub"], email=payload["email"], name=payload["name"],
        role=payload["role"], permissions=payload.get("permissions", []),
    )


def require_roles(*roles: UserRole):
    allowed = {r.value for r in roles}

    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role == UserRole.ADMIN.value:
            return user
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role: {' or '.join(allowed)}")
        return user

    return _dep


def require_permissions(*perms: str):
    needed = set(perms)

    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role == UserRole.ADMIN.value:
            return user
        missing = needed - set(user.permissions)
        if missing:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {', '.join(missing)}")
        return user

    return _dep
