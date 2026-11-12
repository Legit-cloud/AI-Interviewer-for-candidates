"""generated_suggestions.code

Revision ID: c3e5f7a9b2d4
Revises: b2d4e6f8a1c3
Create Date: 2026-11-12 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3e5f7a9b2d4"
down_revision: Union[str, Sequence[str], None] = "b2d4e6f8a1c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("generated_suggestions", sa.Column("code", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("generated_suggestions", "code")
