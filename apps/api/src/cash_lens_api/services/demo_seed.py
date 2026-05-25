from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from cash_lens_api.db import utc_now
from cash_lens_api.models import (
    FinancialAccount,
    LedgerEvent,
    NotificationEvent,
    PlaidItem,
    RawTransaction,
    SyncRun,
    User,
)


DEMO_TRANSACTIONS = [
    {
        "txn_id": "txn-demo-payroll",
        "account_key": "checking",
        "amount": -3200.00,
        "days_ago": 22,
        "merchant": "Acme Payroll",
        "name": "Payroll Deposit",
        "event_type": "income",
        "category": "income",
        "subcategory": "salary",
    },
    {
        "txn_id": "txn-demo-rent",
        "account_key": "checking",
        "amount": 1850.00,
        "days_ago": 20,
        "merchant": "Lakeside Apartments",
        "name": "Monthly Rent",
        "event_type": "purchase",
        "category": "housing",
        "subcategory": "rent",
    },
    {
        "txn_id": "txn-demo-wholefoods",
        "account_key": "checking",
        "amount": 128.43,
        "days_ago": 18,
        "merchant": "Whole Foods",
        "name": "Whole Foods Market",
        "event_type": "purchase",
        "category": "groceries",
        "subcategory": "produce",
    },
    {
        "txn_id": "txn-demo-target",
        "account_key": "credit",
        "amount": 82.31,
        "days_ago": 16,
        "merchant": "Target",
        "name": "Target T-2042",
        "event_type": "purchase",
        "category": "shopping",
        "subcategory": "household",
    },
    {
        "txn_id": "txn-demo-payment",
        "account_key": "checking",
        "amount": 750.00,
        "days_ago": 15,
        "merchant": "Amex Autopay",
        "name": "Credit Card Payment",
        "event_type": "credit_card_payment",
        "category": "transfers",
        "subcategory": "card payment",
        "exclude_from_spend": True,
        "is_card_payment": True,
        "is_transfer": True,
    },
    {
        "txn_id": "txn-demo-amex-payment",
        "account_key": "credit",
        "amount": -750.00,
        "days_ago": 15,
        "merchant": "Payment Thank You",
        "name": "Amex Payment Received",
        "event_type": "credit_card_payment",
        "category": "transfers",
        "subcategory": "card payment",
        "exclude_from_spend": True,
        "is_card_payment": True,
        "is_transfer": True,
    },
    {
        "txn_id": "txn-demo-therapy",
        "account_key": "checking",
        "amount": 140.00,
        "days_ago": 13,
        "merchant": "Dr. Rivera Therapy",
        "name": "RIVERA PSYCHOTHERAPY",
        "event_type": "purchase",
        "category": "health",
        "subcategory": "therapy",
    },
    {
        "txn_id": "txn-demo-spotify",
        "account_key": "credit",
        "amount": 11.99,
        "days_ago": 12,
        "merchant": "Spotify",
        "name": "SPOTIFY USA",
        "event_type": "purchase",
        "category": "subscriptions",
        "subcategory": "music",
    },
    {
        "txn_id": "txn-demo-coned",
        "account_key": "checking",
        "amount": 94.12,
        "days_ago": 11,
        "merchant": "Con Edison",
        "name": "Utility Bill",
        "event_type": "purchase",
        "category": "bills",
        "subcategory": "utilities",
    },
    {
        "txn_id": "txn-demo-refund",
        "account_key": "credit",
        "amount": -19.99,
        "days_ago": 9,
        "merchant": "Amazon",
        "name": "Amazon Refund",
        "event_type": "refund",
        "category": "shopping",
        "subcategory": "refund",
    },
    {
        "txn_id": "txn-demo-uber",
        "account_key": "credit",
        "amount": 24.60,
        "days_ago": 7,
        "merchant": "Uber",
        "name": "Uber Trip",
        "event_type": "purchase",
        "category": "transport",
        "subcategory": "rideshare",
    },
    {
        "txn_id": "txn-demo-transfer-out",
        "account_key": "checking",
        "amount": 500.00,
        "days_ago": 6,
        "merchant": "Transfer to Savings",
        "name": "Internal Transfer",
        "event_type": "transfer",
        "category": "transfers",
        "subcategory": "savings",
        "exclude_from_spend": True,
        "is_transfer": True,
    },
    {
        "txn_id": "txn-demo-transfer-in",
        "account_key": "savings",
        "amount": -500.00,
        "days_ago": 6,
        "merchant": "Transfer from Checking",
        "name": "Internal Transfer",
        "event_type": "transfer",
        "category": "transfers",
        "subcategory": "savings",
        "exclude_from_spend": True,
        "is_transfer": True,
    },
    {
        "txn_id": "txn-demo-cvs",
        "account_key": "checking",
        "amount": 18.41,
        "days_ago": 4,
        "merchant": "CVS",
        "name": "CVS PHARMACY",
        "event_type": "purchase",
        "category": "health",
        "subcategory": "pharmacy",
    },
    {
        "txn_id": "txn-demo-bluebottle",
        "account_key": "checking",
        "amount": 6.85,
        "days_ago": 2,
        "merchant": "Blue Bottle Coffee",
        "name": "Pending coffee",
        "event_type": "purchase",
        "category": "restaurants",
        "subcategory": "coffee",
        "pending": True,
    },
]

DEMO_INCREMENTAL_BATCHES = [
    [
        {
            "txn_id": "txn-sync-gym",
            "account_key": "credit",
            "amount": 48.00,
            "merchant": "Climbing Gym",
            "name": "Monthly Gym",
            "event_type": "purchase",
            "category": "health",
            "subcategory": "fitness",
        },
        {
            "txn_id": "txn-sync-roommate",
            "account_key": "checking",
            "amount": -42.00,
            "merchant": "Venmo",
            "name": "Roommate reimbursement",
            "event_type": "income",
            "category": "reimbursements",
            "subcategory": "shared expenses",
        },
    ],
    [
        {
            "txn_id": "txn-sync-lululemon",
            "account_key": "credit",
            "amount": 138.00,
            "merchant": "Lululemon",
            "name": "LULULEMON SF",
            "event_type": "purchase",
            "category": "shopping",
            "subcategory": "fitness",
        },
        {
            "txn_id": "txn-sync-payroll-2",
            "account_key": "checking",
            "amount": -3200.00,
            "merchant": "Acme Payroll",
            "name": "Payroll Deposit",
            "event_type": "income",
            "category": "income",
            "subcategory": "salary",
        },
    ],
]


def seed_demo_workspace(db: Session, email: str, full_name: str) -> User:
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        return existing

    user = User(email=email, full_name=full_name)
    db.add(user)
    db.flush()

    item = PlaidItem(
        user_id=user.id,
        plaid_item_id="item-demo-primary",
        institution_id="ins-demo",
        institution_name="Demo Credit Union",
        status="healthy",
        transactions_cursor="demo-cursor-0",
        last_synced_at=utc_now(),
    )
    db.add(item)
    db.flush()

    accounts = {
        "checking": FinancialAccount(
            user_id=user.id,
            plaid_item_id=item.id,
            plaid_account_id="acc-demo-checking",
            name="Main Checking",
            official_name="Cash Lens Checking",
            mask="4321",
            type="depository",
            subtype="checking",
            current_balance=8420.14,
            available_balance=8397.14,
            last_balance_at=utc_now(),
        ),
        "savings": FinancialAccount(
            user_id=user.id,
            plaid_item_id=item.id,
            plaid_account_id="acc-demo-savings",
            name="High Yield Savings",
            official_name="Cash Lens HYSA",
            mask="1099",
            type="depository",
            subtype="savings",
            current_balance=14980.55,
            available_balance=14980.55,
            last_balance_at=utc_now(),
        ),
        "credit": FinancialAccount(
            user_id=user.id,
            plaid_item_id=item.id,
            plaid_account_id="acc-demo-credit",
            name="Rewards Card",
            official_name="Cash Lens Rewards",
            mask="2001",
            type="credit",
            subtype="credit card",
            current_balance=1243.80,
            available_balance=None,
            last_balance_at=utc_now(),
        ),
    }

    db.add_all(accounts.values())
    db.flush()

    for transaction in DEMO_TRANSACTIONS:
        create_transaction(
            db=db,
            user=user,
            plaid_item=item,
            account=accounts[transaction["account_key"]],
            transaction=transaction,
            days_ago=transaction["days_ago"],
        )

    db.add_all(
        [
            NotificationEvent(
                user_id=user.id,
                type="sync",
                title="Initial sync completed",
                body="Imported your latest account balances and recent transactions.",
                entity_type="plaid_item",
                entity_id=str(item.id),
            ),
            NotificationEvent(
                user_id=user.id,
                type="review",
                title="Large rent payment detected",
                body="Monthly rent was detected and included in true spend.",
                entity_type="transaction",
                entity_id="txn-demo-rent",
            ),
            NotificationEvent(
                user_id=user.id,
                type="subscription",
                title="Recurring subscription candidate",
                body="Spotify now has three matching monthly charges. Review if you want to mark it as recurring.",
                entity_type="transaction",
                entity_id="txn-demo-spotify",
            ),
        ]
    )

    db.add(
        SyncRun(
            user_id=user.id,
            plaid_item_id=item.id,
            job_type="initial_plaid_sync",
            status="completed",
            started_at=utc_now() - timedelta(minutes=4),
            finished_at=utc_now() - timedelta(minutes=3),
        )
    )

    db.commit()
    db.refresh(user)
    return user


def ensure_seeded_user(db: Session, email: str, full_name: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user:
        return user
    return seed_demo_workspace(db, email=email, full_name=full_name)


def create_transaction(
    db: Session,
    user: User,
    plaid_item: PlaidItem | None,
    account: FinancialAccount,
    transaction: dict,
    days_ago: int = 0,
) -> LedgerEvent:
    posted_date = date.today() - timedelta(days=days_ago)
    raw_transaction = RawTransaction(
        user_id=user.id,
        plaid_item_id=plaid_item.id if plaid_item else None,
        plaid_account_id=account.id,
        plaid_transaction_id=transaction["txn_id"],
        pending_transaction_id=None,
        amount=transaction["amount"],
        date=posted_date,
        authorized_date=posted_date,
        name=transaction["name"],
        merchant_name=transaction.get("merchant"),
        payment_channel="online",
        pending=transaction.get("pending", False),
        raw_personal_finance_category={
            "primary": transaction.get("category"),
            "detailed": transaction.get("subcategory"),
        },
        raw_json={"source": "demo"},
    )
    db.add(raw_transaction)
    db.flush()
    return create_ledger_event(
        db=db,
        user=user,
        raw_transaction=raw_transaction,
        account=account,
        event_type=transaction.get("event_type", "unknown"),
        category=transaction.get("category"),
        subcategory=transaction.get("subcategory"),
        merchant_name=transaction.get("merchant") or transaction["name"],
        description=transaction["name"],
        is_transfer=transaction.get("is_transfer", False),
        is_card_payment=transaction.get("is_card_payment", False),
        exclude_from_spend=transaction.get("exclude_from_spend", False),
        confidence=0.88,
    )


def create_ledger_event(
    db: Session,
    user: User,
    raw_transaction: RawTransaction,
    account: FinancialAccount,
    event_type: str,
    category: str | None,
    subcategory: str | None,
    merchant_name: str,
    description: str,
    is_transfer: bool,
    is_card_payment: bool,
    exclude_from_spend: bool,
    confidence: float,
) -> LedgerEvent:
    direction = "inflow" if raw_transaction.amount < 0 else "outflow"
    signed_amount = abs(raw_transaction.amount) if direction == "inflow" else -abs(raw_transaction.amount)

    ledger_event = LedgerEvent(
        user_id=user.id,
        raw_transaction_id=raw_transaction.id,
        account_id=account.id,
        event_type=event_type,
        direction=direction,
        amount=signed_amount,
        date=raw_transaction.date,
        merchant_name=merchant_name,
        description=description,
        category=category,
        subcategory=subcategory,
        is_transfer=is_transfer,
        is_card_payment=is_card_payment,
        exclude_from_spend=exclude_from_spend,
        confidence=confidence,
    )
    db.add(ledger_event)
    db.flush()
    return ledger_event


def add_demo_sync_batch(db: Session, user: User, plaid_item: PlaidItem) -> int:
    account_list = db.scalars(select(FinancialAccount).where(FinancialAccount.user_id == user.id)).all()
    account_map = {
        "checking": next(account for account in account_list if account.name == "Main Checking"),
        "savings": next(account for account in account_list if account.name == "High Yield Savings"),
        "credit": next(account for account in account_list if account.name == "Rewards Card"),
    }
    sync_runs = db.scalars(select(SyncRun).where(SyncRun.plaid_item_id == plaid_item.id)).all()
    batch = DEMO_INCREMENTAL_BATCHES[len(sync_runs) % len(DEMO_INCREMENTAL_BATCHES)]
    imported = 0
    today = date.today()

    for index, transaction in enumerate(batch):
        transaction_id = f"{transaction['txn_id']}-{today.isoformat()}"
        exists = db.scalar(
            select(RawTransaction).where(RawTransaction.plaid_transaction_id == transaction_id)
        )
        if exists:
            continue

        payload = {**transaction, "txn_id": transaction_id}
        create_transaction(
            db=db,
            user=user,
            plaid_item=plaid_item,
            account=account_map[transaction["account_key"]],
            transaction=payload,
            days_ago=index,
        )
        imported += 1

    plaid_item.last_synced_at = utc_now()
    plaid_item.transactions_cursor = f"demo-cursor-{int(utc_now().timestamp())}"

    db.add(
        SyncRun(
            user_id=user.id,
            plaid_item_id=plaid_item.id,
            job_type="incremental_plaid_sync",
            status="completed",
            started_at=utc_now() - timedelta(seconds=10),
            finished_at=utc_now(),
        )
    )
    db.add(
        NotificationEvent(
            user_id=user.id,
            type="sync",
            title="Manual sync completed",
            body=f"Imported {imported} new transactions from {plaid_item.institution_name}.",
            entity_type="plaid_item",
            entity_id=str(plaid_item.id),
        )
    )
    db.commit()
    return imported
