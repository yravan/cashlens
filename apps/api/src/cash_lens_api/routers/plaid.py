from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from cash_lens_api.core.auth import get_current_user
from cash_lens_api.core.config import Settings, get_settings
from cash_lens_api.core.security import verify_plaid_webhook
from cash_lens_api.db import get_db
from cash_lens_api.models import PlaidItem, User
from cash_lens_api.schemas import ExchangePublicTokenRequest, ExchangePublicTokenResponse, LinkTokenResponse, MessageResponse, SyncResponse, WebhookPayload
from cash_lens_api.services.plaid import create_link_token, exchange_public_token, handle_webhook, manual_sync


router = APIRouter(tags=["plaid"])


@router.post("/plaid/create-link-token", response_model=LinkTokenResponse)
def create_plaid_link_token(
    user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LinkTokenResponse:
    return create_link_token(user, settings)


@router.post("/plaid/exchange-public-token", response_model=ExchangePublicTokenResponse)
def exchange_plaid_public_token(
    payload: ExchangePublicTokenRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ExchangePublicTokenResponse:
    return exchange_public_token(
        db=db,
        user=user,
        public_token=payload.public_token,
        institution_name=payload.institution_name,
        settings=settings,
    )


@router.post("/plaid/webhook", response_model=MessageResponse)
async def plaid_webhook(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MessageResponse:
    raw_body = await request.body()
    verify_plaid_webhook(raw_body, request.headers.get("plaid-verification"), settings)
    payload = WebhookPayload.model_validate_json(raw_body)
    handle_webhook(db, payload, settings)
    return MessageResponse(status="ok", message="Webhook processed.")


@router.post("/plaid/sync-item/{plaid_item_id}", response_model=SyncResponse)
def sync_plaid_item(
    plaid_item_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SyncResponse:
    plaid_item = db.scalar(
        select(PlaidItem).where(
            PlaidItem.id == plaid_item_id,
            PlaidItem.user_id == user.id,
        )
    )
    if not plaid_item:
        raise HTTPException(status_code=404, detail="Plaid item not found.")
    return manual_sync(db, user, plaid_item, settings)
