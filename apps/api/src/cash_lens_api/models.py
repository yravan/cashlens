from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from cash_lens_api.db import Base, utc_now


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_auth_user_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    plaid_items: Mapped[list["PlaidItem"]] = relationship(back_populates="user")
    accounts: Mapped[list["FinancialAccount"]] = relationship(back_populates="user")
    ledger_events: Mapped[list["LedgerEvent"]] = relationship(back_populates="user")
    notifications: Mapped[list["NotificationEvent"]] = relationship(back_populates="user")


class PlaidItem(TimestampMixin, Base):
    __tablename__ = "plaid_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plaid_item_id: Mapped[str] = mapped_column(String(255), unique=True)
    institution_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    institution_name: Mapped[str] = mapped_column(String(255), default="Connected institution")
    encrypted_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    transactions_cursor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="healthy")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="plaid_items")
    accounts: Mapped[list["FinancialAccount"]] = relationship(back_populates="plaid_item")


class FinancialAccount(TimestampMixin, Base):
    __tablename__ = "financial_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plaid_item_id: Mapped[int | None] = mapped_column(ForeignKey("plaid_items.id"), nullable=True)
    plaid_account_id: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    official_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mask: Mapped[str | None] = mapped_column(String(10), nullable=True)
    type: Mapped[str] = mapped_column(String(50))
    subtype: Mapped[str | None] = mapped_column(String(50), nullable=True)
    current_balance: Mapped[float] = mapped_column(Float, default=0.0)
    available_balance: Mapped[float | None] = mapped_column(Float, nullable=True)
    iso_currency_code: Mapped[str] = mapped_column(String(10), default="USD")
    last_balance_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="accounts")
    plaid_item: Mapped[PlaidItem | None] = relationship(back_populates="accounts")
    raw_transactions: Mapped[list["RawTransaction"]] = relationship(back_populates="account")
    ledger_events: Mapped[list["LedgerEvent"]] = relationship(back_populates="account")


class RawTransaction(TimestampMixin, Base):
    __tablename__ = "raw_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plaid_item_id: Mapped[int | None] = mapped_column(ForeignKey("plaid_items.id"), nullable=True)
    plaid_account_id: Mapped[int | None] = mapped_column(ForeignKey("financial_accounts.id"), nullable=True)
    plaid_transaction_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    pending_transaction_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    amount: Mapped[float] = mapped_column(Float)
    date: Mapped[date] = mapped_column(Date)
    authorized_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    merchant_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payment_channel: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pending: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_personal_finance_category: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    raw_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    account: Mapped[FinancialAccount | None] = relationship(back_populates="raw_transactions")
    ledger_event: Mapped["LedgerEvent | None"] = relationship(back_populates="raw_transaction")


class LedgerEvent(TimestampMixin, Base):
    __tablename__ = "ledger_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    raw_transaction_id: Mapped[int | None] = mapped_column(ForeignKey("raw_transactions.id"), nullable=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("financial_accounts.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(50), default="unknown")
    direction: Mapped[str] = mapped_column(String(20), default="outflow")
    amount: Mapped[float] = mapped_column(Float)
    date: Mapped[date] = mapped_column(Date)
    merchant_name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    subcategory: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_transfer: Mapped[bool] = mapped_column(Boolean, default=False)
    is_card_payment: Mapped[bool] = mapped_column(Boolean, default=False)
    exclude_from_spend: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)

    user: Mapped[User] = relationship(back_populates="ledger_events")
    raw_transaction: Mapped[RawTransaction | None] = relationship(back_populates="ledger_event")
    account: Mapped[FinancialAccount | None] = relationship(back_populates="ledger_events")


class NotificationEvent(Base):
    __tablename__ = "notification_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User] = relationship(back_populates="notifications")


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plaid_item_id: Mapped[int | None] = mapped_column(ForeignKey("plaid_items.id"), nullable=True)
    job_type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(50))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
