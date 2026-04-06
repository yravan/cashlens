"""add_user_oauth_tokens

Revision ID: a1b2c3d4e5f6
Revises: c3db36f5dab2
Create Date: 2026-04-06 20:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'c3db36f5dab2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('user_oauth_tokens',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.Text(), nullable=False),
        sa.Column('provider', sa.Text(), nullable=False),
        sa.Column('encrypted_token_data', sa.Text(), nullable=False),
        sa.Column('scopes', postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column('email_address', sa.Text(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'provider', name='uq_user_oauth_provider'),
    )
    op.create_index(op.f('ix_user_oauth_tokens_user_id'), 'user_oauth_tokens', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_user_oauth_tokens_user_id'), table_name='user_oauth_tokens')
    op.drop_table('user_oauth_tokens')
