from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas import AuthUser, LoginRequest, LoginResponse, RegisterRequest
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
REFRESH_COOKIE = "atom_rt"


def _set_refresh(resp: Response, token: str) -> None:
    resp.set_cookie(
        REFRESH_COOKIE, token, httponly=True, samesite="lax",
        secure=settings.env == "production", path="/api/auth",
        max_age=settings.jwt_refresh_ttl,
    )


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    ua = request.headers.get("user-agent")
    user, token, ttl, refresh = await auth_service.login(db, body.email, body.password, request.client.host if request.client else None, ua)
    _set_refresh(response, refresh)
    return LoginResponse(user=user, access_token=token, expires_in=ttl)


@router.post("/register", response_model=AuthUser)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    return await auth_service.register(db, body.email, body.name, body.password)


@router.post("/refresh", response_model=LoginResponse)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    ua = request.headers.get("user-agent")
    user, token, ttl, new_refresh = await auth_service.refresh(db, raw, request.client.host if request.client else None, ua)
    _set_refresh(response, new_refresh)
    return LoginResponse(user=user, access_token=token, expires_in=ttl)


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    await auth_service.logout(db, request.cookies.get(REFRESH_COOKIE), user.id)
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
    return {"ok": True}


@router.get("/me", response_model=AuthUser)
async def me(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
    return AuthUser(id=row.id, email=row.email, name=row.name, role=row.role, avatar_url=row.avatar_url)
