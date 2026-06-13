"""initial schema — creates all tables from SQLAlchemy metadata.

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-13
"""
from __future__ import annotations

from alembic import op

from app.db.base import Base
import app.models  # noqa: F401  registers models

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
