"""Onboarding status endpoint -- tells the frontend what the user has set up."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.db.session import get_db
from app.models.infrastructure import BankConnection, UserOAuthToken
from app.models.financial import Account, Transaction

router = APIRouter()


@router.get("/onboarding/status")
async def onboarding_status(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Returns what the user has set up so far."""
    bank_connections = await db.execute(
        select(BankConnection)
        .where(BankConnection.user_id == user_id, BankConnection.status == "active")
    )
    has_bank = bank_connections.scalars().first() is not None

    # Check if Gmail is connected
    gmail_token = await db.execute(
        select(UserOAuthToken)
        .where(UserOAuthToken.user_id == user_id, UserOAuthToken.provider == "gmail")
    )
    has_gmail = gmail_token.scalars().first() is not None

    accounts_count = await db.scalar(
        select(func.count()).select_from(Account)
        .where(Account.user_id == user_id, Account.is_active == True)  # noqa: E712
    )
    transactions_count = await db.scalar(
        select(func.count()).select_from(Transaction)
        .where(Transaction.user_id == user_id)
    )

    return {
        "has_bank_connection": has_bank,
        "has_gmail": has_gmail,
        "accounts_count": accounts_count or 0,
        "transactions_count": transactions_count or 0,
        "setup_complete": has_bank,
    }
