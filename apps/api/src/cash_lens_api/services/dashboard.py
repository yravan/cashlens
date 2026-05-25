from datetime import date

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from cash_lens_api.models import FinancialAccount, LedgerEvent, NotificationEvent, PlaidItem, SyncRun, User
from cash_lens_api.schemas import AccountRead, DashboardRead, DashboardSummary, NotificationRead, PlaidItemRead, TransactionRead


def build_dashboard(db: Session, user: User) -> DashboardRead:
    month_start = date.today().replace(day=1)

    accounts = db.scalars(
        select(FinancialAccount)
        .where(FinancialAccount.user_id == user.id)
        .order_by(FinancialAccount.type, FinancialAccount.name)
    ).all()
    cash_total = round(sum(account.current_balance for account in accounts if account.type != "credit"), 2)
    credit_total = round(sum(account.current_balance for account in accounts if account.type == "credit"), 2)

    monthly_events = db.scalars(
        select(LedgerEvent).where(
            LedgerEvent.user_id == user.id,
            LedgerEvent.date >= month_start,
        )
    ).all()

    inflow = round(sum(event.amount for event in monthly_events if event.amount > 0), 2)
    outflow = round(abs(sum(event.amount for event in monthly_events if event.amount < 0)), 2)
    true_spend_events = [
        event
        for event in monthly_events
        if not event.exclude_from_spend and event.event_type in {"purchase", "refund", "fee", "adjustment"}
    ]
    true_spend = round(max(0.0, -sum(event.amount for event in true_spend_events)), 2)

    latest_sync = db.scalar(
        select(SyncRun.status)
        .where(SyncRun.user_id == user.id)
        .order_by(desc(SyncRun.started_at))
        .limit(1)
    ) or "idle"
    unread_notifications = db.scalar(
        select(func.count(NotificationEvent.id)).where(
            NotificationEvent.user_id == user.id,
            NotificationEvent.read_at.is_(None),
        )
    ) or 0

    recent_transactions = db.scalars(
        select(LedgerEvent)
        .where(LedgerEvent.user_id == user.id)
        .order_by(desc(LedgerEvent.date), desc(LedgerEvent.id))
        .limit(8)
    ).all()
    recent_notifications = db.scalars(
        select(NotificationEvent)
        .where(NotificationEvent.user_id == user.id)
        .order_by(desc(NotificationEvent.created_at))
        .limit(6)
    ).all()
    plaid_items = db.scalars(
        select(PlaidItem)
        .where(PlaidItem.user_id == user.id)
        .order_by(PlaidItem.institution_name)
    ).all()

    return DashboardRead(
        summary=DashboardSummary(
            total_cash_balance=cash_total,
            total_credit_balance=credit_total,
            net_inflow_this_month=inflow,
            net_outflow_this_month=outflow,
            true_spend_this_month=true_spend,
            latest_sync_status=latest_sync,
            unread_notifications=unread_notifications,
        ),
        accounts=[AccountRead.model_validate(account) for account in accounts],
        recent_transactions=[TransactionRead.model_validate(event) for event in recent_transactions],
        recent_notifications=[NotificationRead.model_validate(event) for event in recent_notifications],
        plaid_items=[PlaidItemRead.model_validate(item) for item in plaid_items],
    )
