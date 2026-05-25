from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserRead(ORMModel):
    id: int
    email: str
    full_name: str | None = None
    external_auth_user_id: str | None = None


class AccountRead(ORMModel):
    id: int
    plaid_item_id: int | None = None
    name: str
    official_name: str | None = None
    mask: str | None = None
    type: str
    subtype: str | None = None
    current_balance: float
    available_balance: float | None = None
    iso_currency_code: str
    last_balance_at: datetime | None = None


class TransactionRead(ORMModel):
    id: int
    raw_transaction_id: int | None = None
    account_id: int | None = None
    event_type: str
    direction: str
    amount: float
    date: date
    merchant_name: str
    description: str | None = None
    category: str | None = None
    subcategory: str | None = None
    is_transfer: bool
    is_card_payment: bool
    exclude_from_spend: bool
    confidence: float


class TransactionUpdate(BaseModel):
    event_type: str | None = None
    category: str | None = None
    subcategory: str | None = None
    exclude_from_spend: bool | None = None


class NotificationRead(ORMModel):
    id: int
    type: str
    title: str
    body: str
    entity_type: str | None = None
    entity_id: str | None = None
    read_at: datetime | None = None
    created_at: datetime


class PlaidItemRead(ORMModel):
    id: int
    plaid_item_id: str
    institution_name: str
    status: str
    last_synced_at: datetime | None = None


class DashboardSummary(BaseModel):
    total_cash_balance: float
    total_credit_balance: float
    net_inflow_this_month: float
    net_outflow_this_month: float
    true_spend_this_month: float
    latest_sync_status: str
    unread_notifications: int


class DashboardRead(BaseModel):
    summary: DashboardSummary
    accounts: list[AccountRead]
    recent_transactions: list[TransactionRead]
    recent_notifications: list[NotificationRead]
    plaid_items: list[PlaidItemRead]


class LinkTokenResponse(BaseModel):
    mode: str
    link_token: str
    expiration: datetime


class ExchangePublicTokenRequest(BaseModel):
    public_token: str
    institution_name: str | None = None


class ExchangePublicTokenResponse(BaseModel):
    status: str
    plaid_item: PlaidItemRead
    accounts_created: int
    transactions_imported: int


class SyncResponse(BaseModel):
    status: str
    imported_count: int
    plaid_item: PlaidItemRead


class WebhookPayload(BaseModel):
    webhook_type: str | None = None
    webhook_code: str | None = None
    item_id: str | None = None
    error: dict | None = None


class MessageResponse(BaseModel):
    status: str
    message: str
