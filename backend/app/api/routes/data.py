"""Data read routes — accounts, transactions for the frontend."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.financial import Account, Transaction

router = APIRouter(prefix="/data", tags=["data"])

USER_ID = "default"  # TODO: Clerk auth


@router.get("/accounts")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Account)
        .where(Account.user_id == USER_ID, Account.is_active == True)
        .order_by(Account.sort_order, Account.name)
    )
    accounts = result.scalars().all()
    return [
        {
            "id": str(a.id),
            "name": a.name,
            "institution_name": a.institution_name,
            "account_type": a.account_type,
            "currency_code": a.currency_code,
            "current_balance": str(a.current_balance) if a.current_balance else None,
            "account_mask": a.account_mask,
            "external_id": a.external_id,
        }
        for a in accounts
    ]


@router.get("/transactions")
async def list_transactions(
    limit: int = 100,
    offset: int = 0,
    account_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Transaction).where(Transaction.user_id == USER_ID)
    if account_id:
        q = q.where(Transaction.account_id == account_id)
    q = q.order_by(Transaction.date.desc()).limit(limit).offset(offset)

    result = await db.execute(q)
    txns = result.scalars().all()
    return [
        {
            "id": str(t.id),
            "account_id": str(t.account_id),
            "amount": str(t.amount),
            "date": t.date.isoformat(),
            "description": t.description,
            "original_description": t.original_description,
            "merchant_name": t.merchant_name,
            "source": t.source,
            "external_id": t.external_id,
            "is_pending": t.is_pending,
            "is_reviewed": t.is_reviewed,
            "category_id": str(t.category_id) if t.category_id else None,
        }
        for t in txns
    ]
