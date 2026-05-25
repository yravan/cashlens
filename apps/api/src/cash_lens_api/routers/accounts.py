from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from cash_lens_api.core.auth import get_current_user
from cash_lens_api.db import get_db
from cash_lens_api.models import FinancialAccount, User
from cash_lens_api.schemas import AccountRead


router = APIRouter(tags=["accounts"])


@router.get("/accounts", response_model=list[AccountRead])
def list_accounts(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[AccountRead]:
    accounts = db.scalars(
        select(FinancialAccount)
        .where(FinancialAccount.user_id == user.id)
        .order_by(FinancialAccount.type, FinancialAccount.name)
    ).all()
    return [AccountRead.model_validate(account) for account in accounts]


@router.get("/accounts/{account_id}", response_model=AccountRead)
def get_account(
    account_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> AccountRead:
    account = db.scalar(
        select(FinancialAccount).where(
            FinancialAccount.id == account_id,
            FinancialAccount.user_id == user.id,
        )
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found.")
    return AccountRead.model_validate(account)
