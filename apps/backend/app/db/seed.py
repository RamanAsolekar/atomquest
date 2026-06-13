"""Idempotent seed: permissions, demo users, default config, starter KB."""
from __future__ import annotations

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.enums import UserRole
from app.core.security import hash_password
from app.models import KbArticle, Permission, User, UserPermission
from app.services import config_service

log = structlog.get_logger("seed")

PERMISSIONS = [
    ("session:create", "Create support sessions"),
    ("session:end", "End any session"),
    ("session:end_own", "End own sessions"),
    ("recording:start", "Start a recording"),
    ("recording:stop", "Stop a recording"),
    ("recording:download", "Download recordings"),
    ("invite:create", "Generate customer invites"),
    ("admin:dashboard", "Access admin dashboard"),
    ("admin:force_end", "Force-end any active session"),
    ("analytics:view", "View analytics dashboards"),
    ("audit:view", "View audit logs"),
]

AGENT_PERMS = {"session:create", "session:end_own", "recording:start", "recording:stop",
               "recording:download", "invite:create", "analytics:view"}

KB_SEED = [
    ("Resetting your router to factory defaults", "/kb/router-reset",
     "Hold the reset button for 10s until the LED blinks…", ["router", "wifi", "network"], "Networking"),
    ("Step-by-step device installation guide", "/kb/install-guide",
     "Power on the device and follow the on-screen wizard…", ["install", "setup", "firmware"], "Installation & Setup"),
    ("Requesting a refund or billing adjustment", "/kb/refunds",
     "Refunds are processed within 5-7 business days…", ["bill", "refund", "payment"], "Billing"),
    ("Recovering account access", "/kb/account-recovery",
     "Use the Forgot password link to reset…", ["login", "password", "account"], "Account & Access"),
    ("Troubleshooting app crashes", "/kb/app-crashes",
     "Clear the cache and reinstall the latest version…", ["crash", "bug", "error", "app"], "Software / App"),
]


async def run(db: AsyncSession) -> None:
    log.info("seeding")
    # permissions
    for key, desc in PERMISSIONS:
        if not (await db.execute(select(Permission).where(Permission.key == key))).scalar_one_or_none():
            db.add(Permission(key=key, description=desc))
    await db.flush()
    all_perms = {p.key: p for p in (await db.execute(select(Permission))).scalars().all()}

    async def grant(user: User, keys: set[str]) -> None:
        for k in keys:
            pid = all_perms[k].id
            exists = (await db.execute(select(UserPermission).where(UserPermission.user_id == user.id, UserPermission.permission_id == pid))).scalar_one_or_none()
            if not exists:
                db.add(UserPermission(user_id=user.id, permission_id=pid))

    async def upsert_user(email: str, name: str, role: UserRole, password: str) -> User:
        u = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if not u:
            u = User(email=email, name=name, role=role.value, password_hash=hash_password(password),
                     avatar_url=f"https://api.dicebear.com/9.x/initials/svg?seed={name}")
            db.add(u)
            await db.flush()
        return u

    admin = await upsert_user("admin@atomvision.dev", "Ops Admin", UserRole.ADMIN, "Admin@123")
    await grant(admin, set(all_perms.keys()))
    for email, name in [("agent@atomvision.dev", "Maya Agent"), ("rohan@atomvision.dev", "Rohan Sharma"), ("lena@atomvision.dev", "Lena Cruz")]:
        agent = await upsert_user(email, name, UserRole.AGENT, "Agent@123")
        await grant(agent, AGENT_PERMS)

    # KB (only if empty — admins edit live afterwards)
    if not (await db.execute(select(KbArticle).limit(1))).scalar_one_or_none():
        for title, url, snippet, kw, cat in KB_SEED:
            db.add(KbArticle(title=title, url=url, snippet=snippet, keywords=kw, category=cat))

    await config_service.ensure_seeded(db)
    await db.commit()
    log.info("seed_complete", admin="admin@atomvision.dev/Admin@123", agent="agent@atomvision.dev/Agent@123")


if __name__ == "__main__":
    import asyncio

    from app.db.session import SessionLocal

    async def _main() -> None:
        async with SessionLocal() as db:
            await run(db)

    asyncio.run(_main())
