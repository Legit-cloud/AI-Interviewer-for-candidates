"""answer_language

Revision ID: b2d4e6f8a1c3
Revises: a1f3c9d2b7e4
Create Date: 2026-11-12 13:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b2d4e6f8a1c3"
down_revision: Union[str, Sequence[str], None] = "a1f3c9d2b7e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "interview_preferences",
        sa.Column("answer_language", sa.String(length=64), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("interview_preferences", "answer_language")
