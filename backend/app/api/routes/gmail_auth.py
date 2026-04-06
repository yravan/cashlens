"""Gmail OAuth2 endpoints — start flow, handle callback, disconnect."""

import json
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from google_auth_oauthlib.flow import Flow
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.encryption import decrypt, encrypt
from app.db.session import get_db
from app.models.infrastructure import UserOAuthToken

logger = logging.getLogger(__name__)

router = APIRouter()

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def _build_flow(redirect_uri: str) -> Flow:
    """Build a Google OAuth2 flow from env-based client config."""
    client_config = {
        "web": {
            "client_id": settings.gmail_client_id,
            "client_secret": settings.gmail_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=GMAIL_SCOPES)
    flow.redirect_uri = redirect_uri
    return flow


@router.get("/auth/gmail")
async def gmail_auth_start(
    user_id: str = Depends(get_current_user_id),
):
    """Start the Gmail OAuth2 flow. Returns the authorization URL."""
    if not settings.gmail_client_id or not settings.gmail_client_secret:
        raise HTTPException(status_code=500, detail="Gmail OAuth not configured")

    redirect_uri = f"{settings.api_base_url}/api/auth/gmail/callback"
    flow = _build_flow(redirect_uri)

    # Encrypt user_id into state so the callback can identify the user
    state = encrypt(json.dumps({"user_id": user_id}))

    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )

    return {"authorization_url": authorization_url}


@router.get("/auth/gmail/callback")
async def gmail_auth_callback(
    request: Request,
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle the Gmail OAuth2 callback — exchange code for tokens, store them."""
    # Decrypt state to get user_id
    try:
        state_data = json.loads(decrypt(state))
        user_id = state_data["user_id"]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    redirect_uri = f"{settings.api_base_url}/api/auth/gmail/callback"
    flow = _build_flow(redirect_uri)

    try:
        flow.fetch_token(code=code)
    except Exception as e:
        logger.exception("Failed to exchange Gmail OAuth code")
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {e}")

    credentials = flow.credentials
    token_data = {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": list(credentials.scopes) if credentials.scopes else GMAIL_SCOPES,
    }

    expires_at = None
    if credentials.expiry:
        expires_at = credentials.expiry

    # Get the Gmail email address
    email_address = None
    try:
        from googleapiclient.discovery import build

        service = build("gmail", "v1", credentials=credentials)
        profile = service.users().getProfile(userId="me").execute()
        email_address = profile.get("emailAddress")
    except Exception:
        logger.warning("Could not fetch Gmail profile email")

    # Upsert the token
    existing = await db.execute(
        select(UserOAuthToken).where(
            UserOAuthToken.user_id == user_id,
            UserOAuthToken.provider == "gmail",
        )
    )
    token_row = existing.scalars().first()

    encrypted_data = encrypt(json.dumps(token_data))

    if token_row:
        token_row.encrypted_token_data = encrypted_data
        token_row.scopes = list(credentials.scopes) if credentials.scopes else GMAIL_SCOPES
        token_row.email_address = email_address
        token_row.expires_at = expires_at
    else:
        token_row = UserOAuthToken(
            user_id=user_id,
            provider="gmail",
            encrypted_token_data=encrypted_data,
            scopes=list(credentials.scopes) if credentials.scopes else GMAIL_SCOPES,
            email_address=email_address,
            expires_at=expires_at,
        )
        db.add(token_row)

    await db.commit()
    logger.info("Stored Gmail OAuth token for user %s (%s)", user_id, email_address)

    # Redirect to frontend setup page
    return RedirectResponse(url=f"{settings.frontend_url}/setup?gmail=connected")


@router.delete("/auth/gmail")
async def gmail_disconnect(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Disconnect Gmail — remove stored OAuth tokens."""
    await db.execute(
        delete(UserOAuthToken).where(
            UserOAuthToken.user_id == user_id,
            UserOAuthToken.provider == "gmail",
        )
    )
    await db.commit()
    return {"status": "disconnected"}
