"""Unified provider protocol and normalized data models.

Every provider normalizes its output into NormalizedTransaction / NormalizedAccount
before anything touches the database. Uses typing.Protocol (PEP 544) for structural
subtyping — providers just need to implement the right methods.
"""

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Optional, Protocol

from pydantic import BaseModel


class TransactionType(str, Enum):
    CARD_PAYMENT = "card_payment"
    ATM = "atm"
    TRANSFER = "transfer"
    ACH = "ach"
    CHECK = "check"
    FEE = "fee"
    INTEREST = "interest"
    DEPOSIT = "deposit"
    OTHER = "other"


class TransactionStatus(str, Enum):
    POSTED = "posted"
    PENDING = "pending"


class NormalizedTransaction(BaseModel):
    """Common transaction model all providers normalize into."""

    # Identity & source
    provider_id: str
    provider_type: str  # "simplefin" | "teller" | "plaid" | "csv" | "ofx"
    account_id: str

    # Core financial data — ALWAYS SIGNED: negative = outflow, positive = inflow
    amount: Decimal
    currency: str = "USD"
    date: date
    authorized_date: Optional[date] = None

    # Description & merchant
    description: str
    merchant_name: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    category_confidence: Optional[str] = None

    # Classification hints
    transaction_type: TransactionType = TransactionType.OTHER
    status: TransactionStatus = TransactionStatus.POSTED
    pending_transaction_id: Optional[str] = None
    payment_channel: Optional[str] = None

    # Counterparty
    counterparty_name: Optional[str] = None
    counterparty_type: Optional[str] = None  # person, organization, merchant, payment_app

    # Extra provider-specific data
    extra: Optional[dict] = None


class NormalizedAccount(BaseModel):
    """Common account model all providers normalize into."""

    provider_id: str
    provider_type: str
    name: str
    institution_name: Optional[str] = None
    account_type: Optional[str] = None  # depository, credit, loan
    account_subtype: Optional[str] = None  # checking, savings, credit_card
    mask: Optional[str] = None  # Last 4 digits
    currency: str = "USD"
    balance_current: Optional[Decimal] = None
    balance_available: Optional[Decimal] = None
    balance_limit: Optional[Decimal] = None
    balance_as_of: Optional[datetime] = None


class BankProvider(Protocol):
    """All bank data providers implement this interface."""

    provider_type: str

    async def fetch_accounts(self) -> list[NormalizedAccount]: ...

    async def fetch_transactions(
        self,
        account_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_pending: bool = False,
    ) -> list[NormalizedTransaction]: ...
