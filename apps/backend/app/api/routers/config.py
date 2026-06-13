"""Runtime configuration, feature flags, and the editable knowledge base.
Replaces every hardcoded constant/KB entry — admins change these live."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, require_permissions, require_roles
from app.core.enums import AuditAction, UserRole
from app.db.session import get_db
from app.models import KbArticle
from app.schemas import ConfigUpdate, KbArticleIn, KbArticleOut
from app.services import audit_service, config_service

router = APIRouter(tags=["config"])


@router.get("/config")
async def get_config(_=Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    return await config_service.get_all(db)


@router.put("/config/{key}")
async def set_config(key: str, body: ConfigUpdate, request: Request, user: CurrentUser = Depends(require_permissions("admin:dashboard")), db: AsyncSession = Depends(get_db)):
    await config_service.set_value(db, key, body.value)
    await audit_service.write(db, AuditAction.UPDATE_CONFIG.value, user.id, "config", key, request.client.host if request.client else None, meta={"value": body.value})
    return {"key": key, "value": body.value}


# ---- Knowledge base (editable, drives live AI hints + post-call suggestions) ----
@router.get("/kb", response_model=list[KbArticleOut])
async def list_kb(_=Depends(require_roles(UserRole.AGENT, UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(KbArticle).order_by(KbArticle.created_at.desc()))).scalars().all()
    return rows


@router.post("/kb", response_model=KbArticleOut)
async def create_kb(body: KbArticleIn, request: Request, user: CurrentUser = Depends(require_permissions("admin:dashboard")), db: AsyncSession = Depends(get_db)):
    art = KbArticle(title=body.title, url=body.url, snippet=body.snippet, keywords=body.keywords, category=body.category, is_active=body.is_active)
    db.add(art)
    await db.flush()
    await audit_service.write(db, AuditAction.UPDATE_KB.value, user.id, "kb", art.id, request.client.host if request.client else None)
    return art


@router.put("/kb/{kb_id}", response_model=KbArticleOut)
async def update_kb(kb_id: str, body: KbArticleIn, user: CurrentUser = Depends(require_permissions("admin:dashboard")), db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException, status as st
    art = await db.get(KbArticle, kb_id)
    if not art:
        raise HTTPException(st.HTTP_404_NOT_FOUND, "Article not found")
    art.title, art.url, art.snippet = body.title, body.url, body.snippet
    art.keywords, art.category, art.is_active = body.keywords, body.category, body.is_active
    await db.flush()
    return art


@router.delete("/kb/{kb_id}")
async def delete_kb(kb_id: str, _=Depends(require_permissions("admin:dashboard")), db: AsyncSession = Depends(get_db)):
    art = await db.get(KbArticle, kb_id)
    if art:
        await db.delete(art)
    return {"ok": True}
