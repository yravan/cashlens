"""Shared FastAPI dependencies — auth, DB session."""

from fastapi import Depends
from fastapi_clerk_auth import ClerkConfig, ClerkHTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db

# ── Clerk auth ──
clerk_config = ClerkConfig(jwks_url=settings.clerk_jwks_url)
clerk_auth = ClerkHTTPBearer(config=clerk_config)


async def get_current_user_id(credentials=Depends(clerk_auth)) -> str:
    """Extract the Clerk user_id from a validated JWT."""
    return credentials.decoded["sub"]
