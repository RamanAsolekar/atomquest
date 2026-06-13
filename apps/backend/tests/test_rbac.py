"""Unit tests for the RBAC dependencies — a CUSTOMER must never satisfy an
AGENT-gated dependency; ADMIN bypasses; permissions are enforced."""
import pytest
from fastapi import HTTPException

from app.core.deps import CurrentUser, require_permissions, require_roles
from app.core.enums import UserRole


def _user(role: str, perms=None):
    return CurrentUser(id="u", email="e", name="n", role=role, permissions=perms or [])


@pytest.mark.asyncio
async def test_customer_blocked_from_agent_route():
    dep = require_roles(UserRole.AGENT)
    with pytest.raises(HTTPException) as exc:
        await dep(_user(UserRole.CUSTOMER.value))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_agent_allowed_on_agent_route():
    dep = require_roles(UserRole.AGENT)
    assert (await dep(_user(UserRole.AGENT.value))).role == "AGENT"


@pytest.mark.asyncio
async def test_admin_bypasses_role_and_permission():
    assert await require_roles(UserRole.AGENT)(_user(UserRole.ADMIN.value))
    assert await require_permissions("admin:force_end")(_user(UserRole.ADMIN.value))


@pytest.mark.asyncio
async def test_permission_enforced():
    dep = require_permissions("recording:start")
    with pytest.raises(HTTPException):
        await dep(_user(UserRole.AGENT.value, []))
    assert await dep(_user(UserRole.AGENT.value, ["recording:start"]))
