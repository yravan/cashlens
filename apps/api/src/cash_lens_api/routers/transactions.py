from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from cash_lens_api.core.auth import get_current_user
from cash_lens_api.db import get_db
from cash_lens_api.models import LedgerEvent, User
from cash_lens_api.schemas import TransactionRead, TransactionUpdate

router = APIRouter(tags=["transactions"])


@router.get("/transactions", response_model=list[TransactionRead])
def list_transactions(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    search: str | None = None,
    account_id: int | None = None,
    direction: str | None = Query(default=None, pattern="^(inflow|outflow)$"),
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[TransactionRead]:
    statement = select(LedgerEvent).where(LedgerEvent.user_id == user.id)
    if account_id:
        statement = statement.where(LedgerEvent.account_id == account_id)
    if direction:
        statement = statement.where(LedgerEvent.direction == direction)
    if search:
        statement = statement.where(LedgerEvent.merchant_name.ilike(f"%{search}%"))
    if date_from:
        statement = statement.where(LedgerEvent.date >= date_from)
    if date_to:
        statement = statement.where(LedgerEvent.date <= date_to)

    transactions = db.scalars(statement.order_by(desc(LedgerEvent.date), desc(LedgerEvent.id))).all()
    return [TransactionRead.model_validate(transaction) for transaction in transactions]


@router.get("/transactions/{transaction_id}", response_model=TransactionRead)
def get_transaction(
    transaction_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TransactionRead:
    transaction = db.scalar(
        select(LedgerEvent).where(
            LedgerEvent.id == transaction_id,
            LedgerEvent.user_id == user.id,
        )
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return TransactionRead.model_validate(transaction)


@router.patch("/transactions/{transaction_id}", response_model=TransactionRead)
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TransactionRead:
    transaction = db.scalar(
        select(LedgerEvent).where(
            LedgerEvent.id == transaction_id,
            LedgerEvent.user_id == user.id,
        )
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    update_data = payload.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(transaction, field, value)
    db.commit()
    db.refresh(transaction)
    return TransactionRead.model_validate(transaction)
