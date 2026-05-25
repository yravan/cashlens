from __future__ import annotations

from base64 import urlsafe_b64encode
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from uuid import uuid4

import plaid
from cryptography.fernet import Fernet
from plaid.api import plaid_api
from plaid.configuration import Environment
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from sqlalchemy import select
from sqlalchemy.orm import Session

from cash_lens_api.core.config import Settings
from cash_lens_api.db import utc_now
from cash_lens_api.models import FinancialAccount, NotificationEvent, PlaidItem, RawTransaction, SyncRun, User
from cash_lens_api.schemas import ExchangePublicTokenResponse, LinkTokenResponse, PlaidItemRead, SyncResponse, WebhookPayload
from cash_lens_api.services.demo_seed import create_ledger_event, create_transaction


def _fernet(settings: Settings) -> Fernet:
    key_material = sha256(settings.app_encryption_key.encode("utf-8")).digest()
    return Fernet(urlsafe_b64encode(key_material))


def encrypt_value(value: str, settings: Settings) -> str:
    return _fernet(settings).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_value(value: str, settings: Settings) -> str:
    return _fernet(settings).decrypt(value.encode("utf-8")).decode("utf-8")


def _build_live_client(settings: Settings) -> plaid_api.PlaidApi:
    configuration = plaid.Configuration(
        host=Environment.Sandbox if settings.plaid_env == "sandbox" else Environment.Production,
        api_key={
            "clientId": settings.plaid_client_id,
            "secret": settings.plaid_secret,
        },
    )
    api_client = plaid.ApiClient(configuration)
    return plaid_api.PlaidApi(api_client)


def create_link_token(user: User, settings: Settings) -> LinkTokenResponse:
    if not settings.plaid_live_enabled:
        return LinkTokenResponse(
            mode="demo",
            link_token=f"demo-link-{uuid4()}",
            expiration=datetime.now(UTC) + timedelta(hours=4),
        )

    client = _build_live_client(settings)
    request = LinkTokenCreateRequest(
        client_name="Cash Lens",
        language="en",
        country_codes=[CountryCode("US")],
        user=LinkTokenCreateRequestUser(str(user.id)),
        products=[Products("transactions")],
        webhook=settings.plaid_webhook_url,
    )
    response = client.link_token_create(request)
    return LinkTokenResponse(
        mode="live",
        link_token=response.link_token,
        expiration=response.expiration,
    )


def exchange_public_token(
    db: Session,
    user: User,
    public_token: str,
    institution_name: str | None,
    settings: Settings,
) -> ExchangePublicTokenResponse:
    if not settings.plaid_live_enabled:
        return _connect_demo_item(db, user, institution_name)

    client = _build_live_client(settings)
    exchange_response = client.item_public_token_exchange(ItemPublicTokenExchangeRequest(public_token))
    access_token = exchange_response.access_token
    plaid_item_id = exchange_response.item_id

    plaid_item = db.scalar(select(PlaidItem).where(PlaidItem.plaid_item_id == plaid_item_id))
    if not plaid_item:
        plaid_item = PlaidItem(
            user_id=user.id,
            plaid_item_id=plaid_item_id,
            institution_name=institution_name or "Connected institution",
            status="healthy",
            encrypted_access_token=encrypt_value(access_token, settings),
            transactions_cursor=None,
            last_synced_at=None,
        )
        db.add(plaid_item)
        db.flush()
    else:
        plaid_item.encrypted_access_token = encrypt_value(access_token, settings)

    accounts_response = client.accounts_get(AccountsGetRequest(access_token))
    accounts_payload = accounts_response.to_dict().get("accounts", [])
    accounts_created = 0
    for account_data in accounts_payload:
        existing = db.scalar(
            select(FinancialAccount).where(FinancialAccount.plaid_account_id == account_data["account_id"])
        )
        if existing:
            existing.current_balance = float(account_data["balances"].get("current") or 0.0)
            existing.available_balance = account_data["balances"].get("available")
            existing.last_balance_at = utc_now()
            continue

        db.add(
            FinancialAccount(
                user_id=user.id,
                plaid_item_id=plaid_item.id,
                plaid_account_id=account_data["account_id"],
                name=account_data["name"],
                official_name=account_data.get("official_name"),
                mask=account_data.get("mask"),
                type=account_data["type"],
                subtype=account_data.get("subtype"),
                current_balance=float(account_data["balances"].get("current") or 0.0),
                available_balance=account_data["balances"].get("available"),
                iso_currency_code=account_data.get("balances", {}).get("iso_currency_code") or "USD",
                last_balance_at=utc_now(),
            )
        )
        accounts_created += 1
    db.flush()

    imported = _sync_live_item(db=db, user=user, plaid_item=plaid_item, settings=settings)
    db.commit()
    db.refresh(plaid_item)
    return ExchangePublicTokenResponse(
        status="connected",
        plaid_item=PlaidItemRead.model_validate(plaid_item),
        accounts_created=accounts_created,
        transactions_imported=imported,
    )


def manual_sync(db: Session, user: User, plaid_item: PlaidItem, settings: Settings) -> SyncResponse:
    if not settings.plaid_live_enabled:
        imported = _run_demo_sync(db, user, plaid_item)
        db.refresh(plaid_item)
        return SyncResponse(
            status="completed",
            imported_count=imported,
            plaid_item=PlaidItemRead.model_validate(plaid_item),
        )

    imported = _sync_live_item(db=db, user=user, plaid_item=plaid_item, settings=settings)
    db.commit()
    db.refresh(plaid_item)
    return SyncResponse(
        status="completed",
        imported_count=imported,
        plaid_item=PlaidItemRead.model_validate(plaid_item),
    )


def handle_webhook(db: Session, payload: WebhookPayload, settings: Settings) -> None:
    if not payload.item_id:
        return

    plaid_item = db.scalar(select(PlaidItem).where(PlaidItem.plaid_item_id == payload.item_id))
    if not plaid_item:
        return

    user = db.scalar(select(User).where(User.id == plaid_item.user_id))
    if not user:
        return

    if payload.webhook_code == "SYNC_UPDATES_AVAILABLE":
        manual_sync(db, user, plaid_item, settings)
    elif payload.webhook_code == "ITEM_LOGIN_REQUIRED":
        db.add(
            NotificationEvent(
                user_id=user.id,
                type="reconnect",
                title="Account needs reconnect",
                body=f"{plaid_item.institution_name} needs to be reconnected in Plaid Link update mode.",
                entity_type="plaid_item",
                entity_id=str(plaid_item.id),
            )
        )
        db.commit()


def _connect_demo_item(
    db: Session,
    user: User,
    institution_name: str | None,
) -> ExchangePublicTokenResponse:
    plaid_item = PlaidItem(
        user_id=user.id,
        plaid_item_id=f"item-demo-{uuid4()}",
        institution_id=f"ins-demo-{uuid4().hex[:8]}",
        institution_name=institution_name or "Demo Sandbox Bank",
        status="healthy",
        transactions_cursor=f"demo-cursor-{uuid4().hex[:8]}",
        last_synced_at=utc_now(),
    )
    db.add(plaid_item)
    db.flush()

    checking = FinancialAccount(
        user_id=user.id,
        plaid_item_id=plaid_item.id,
        plaid_account_id=f"acc-demo-{uuid4().hex[:8]}",
        name=f"{plaid_item.institution_name} Checking",
        official_name=f"{plaid_item.institution_name} Everyday Checking",
        mask="7788",
        type="depository",
        subtype="checking",
        current_balance=2660.42,
        available_balance=2601.11,
        last_balance_at=utc_now(),
    )
    credit = FinancialAccount(
        user_id=user.id,
        plaid_item_id=plaid_item.id,
        plaid_account_id=f"acc-demo-{uuid4().hex[:8]}",
        name=f"{plaid_item.institution_name} Credit",
        official_name=f"{plaid_item.institution_name} Rewards Visa",
        mask="5531",
        type="credit",
        subtype="credit card",
        current_balance=681.44,
        available_balance=None,
        last_balance_at=utc_now(),
    )
    db.add_all([checking, credit])
    db.flush()

    for offset, transaction in enumerate(
        [
            {
                "txn_id": f"txn-connect-{uuid4().hex[:8]}",
                "amount": 62.88,
                "merchant": "Trader Joe's",
                "name": "TRADER JOE'S",
                "event_type": "purchase",
                "category": "groceries",
                "subcategory": "groceries",
            },
            {
                "txn_id": f"txn-connect-{uuid4().hex[:8]}",
                "amount": 89.00,
                "merchant": "Delta",
                "name": "DELTA AIR",
                "event_type": "purchase",
                "category": "travel",
                "subcategory": "flights",
            },
        ]
    ):
        create_transaction(
            db=db,
            user=user,
            plaid_item=plaid_item,
            account=checking if offset == 0 else credit,
            transaction=transaction,
            days_ago=offset,
        )

    db.add(
        SyncRun(
            user_id=user.id,
            plaid_item_id=plaid_item.id,
            job_type="initial_plaid_sync",
            status="completed",
            started_at=utc_now() - timedelta(seconds=8),
            finished_at=utc_now(),
        )
    )
    db.add(
        NotificationEvent(
            user_id=user.id,
            type="sync",
            title=f"{plaid_item.institution_name} connected",
            body="Imported your starter accounts and recent transactions in demo mode.",
            entity_type="plaid_item",
            entity_id=str(plaid_item.id),
        )
    )
    db.commit()
    db.refresh(plaid_item)
    return ExchangePublicTokenResponse(
        status="connected",
        plaid_item=PlaidItemRead.model_validate(plaid_item),
        accounts_created=2,
        transactions_imported=2,
    )


def _run_demo_sync(db: Session, user: User, plaid_item: PlaidItem) -> int:
    account_list = db.scalars(
        select(FinancialAccount).where(FinancialAccount.plaid_item_id == plaid_item.id)
    ).all()
    if len(account_list) < 2:
        return 0
    checking = next((account for account in account_list if account.subtype == "checking"), account_list[0])
    credit = next((account for account in account_list if account.type == "credit"), account_list[-1])

    sync_runs = db.scalars(select(SyncRun).where(SyncRun.plaid_item_id == plaid_item.id)).all()
    if len(sync_runs) % 2 == 0:
        source_batch = [
            {
                "txn_id": "txn-sync-gym",
                "amount": 48.00,
                "merchant": "Climbing Gym",
                "name": "Monthly Gym",
                "event_type": "purchase",
                "category": "health",
                "subcategory": "fitness",
            },
            {
                "txn_id": "txn-sync-roommate",
                "amount": -42.00,
                "merchant": "Venmo",
                "name": "Roommate reimbursement",
                "event_type": "income",
                "category": "reimbursements",
                "subcategory": "shared expenses",
            },
        ]
    else:
        source_batch = [
            {
                "txn_id": "txn-sync-lululemon",
                "amount": 138.00,
                "merchant": "Lululemon",
                "name": "LULULEMON SF",
                "event_type": "purchase",
                "category": "shopping",
                "subcategory": "fitness",
            },
            {
                "txn_id": "txn-sync-payroll-2",
                "amount": -3200.00,
                "merchant": "Acme Payroll",
                "name": "Payroll Deposit",
                "event_type": "income",
                "category": "income",
                "subcategory": "salary",
            },
        ]

    batch = [
        {**transaction, "txn_id": f"{transaction['txn_id']}-{date.today().isoformat()}"}
        for transaction in source_batch
    ]

    imported = 0
    for index, transaction in enumerate(batch):
        exists = db.scalar(
            select(RawTransaction).where(RawTransaction.plaid_transaction_id == transaction["txn_id"])
        )
        if exists:
            continue
        create_transaction(
            db=db,
            user=user,
            plaid_item=plaid_item,
            account=credit if index == 0 else checking,
            transaction=transaction,
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


def _sync_live_item(db: Session, user: User, plaid_item: PlaidItem, settings: Settings) -> int:
    if not plaid_item.encrypted_access_token:
        return 0

    client = _build_live_client(settings)
    access_token = decrypt_value(plaid_item.encrypted_access_token, settings)
    imported = 0
    cursor = plaid_item.transactions_cursor
    has_more = True

    while has_more:
        response = client.transactions_sync(
            TransactionsSyncRequest(
                access_token,
                cursor=cursor,
                count=100,
            )
        )
        payload = response.to_dict()
        account_lookup = {
            account.plaid_account_id: account
            for account in db.scalars(
                select(FinancialAccount).where(FinancialAccount.plaid_item_id == plaid_item.id)
            ).all()
        }
        imported += _upsert_live_transactions(
            db=db,
            user=user,
            plaid_item=plaid_item,
            account_lookup=account_lookup,
            transactions=payload.get("added", []),
        )
        imported += _upsert_live_transactions(
            db=db,
            user=user,
            plaid_item=plaid_item,
            account_lookup=account_lookup,
            transactions=payload.get("modified", []),
        )
        cursor = payload.get("next_cursor")
        has_more = payload.get("has_more", False)

    plaid_item.transactions_cursor = cursor
    plaid_item.last_synced_at = utc_now()
    db.add(
        SyncRun(
            user_id=user.id,
            plaid_item_id=plaid_item.id,
            job_type="incremental_plaid_sync",
            status="completed",
            started_at=utc_now() - timedelta(seconds=5),
            finished_at=utc_now(),
        )
    )
    db.add(
        NotificationEvent(
            user_id=user.id,
            type="sync",
            title="Plaid sync completed",
            body=f"Imported {imported} updates from {plaid_item.institution_name}.",
            entity_type="plaid_item",
            entity_id=str(plaid_item.id),
        )
    )
    return imported


def _upsert_live_transactions(
    db: Session,
    user: User,
    plaid_item: PlaidItem,
    account_lookup: dict[str, FinancialAccount],
    transactions: list[dict],
) -> int:
    imported = 0
    for transaction in transactions:
        raw = db.scalar(
            select(RawTransaction).where(RawTransaction.plaid_transaction_id == transaction["transaction_id"])
        )
        account = account_lookup.get(transaction["account_id"])
        if not account:
            continue

        classification = _classify_transaction(
            name=transaction["name"],
            merchant=transaction.get("merchant_name"),
            amount=float(transaction["amount"]),
        )
        posted_date = date.fromisoformat(transaction["date"])
        authorized_date = transaction.get("authorized_date")
        parsed_authorized_date = date.fromisoformat(authorized_date) if authorized_date else None

        if raw:
            raw.amount = float(transaction["amount"])
            raw.date = posted_date
            raw.authorized_date = parsed_authorized_date
            raw.name = transaction["name"]
            raw.merchant_name = transaction.get("merchant_name")
            raw.payment_channel = transaction.get("payment_channel")
            raw.pending = transaction.get("pending", False)
            raw.raw_personal_finance_category = transaction.get("personal_finance_category")
            raw.raw_json = transaction
            if raw.ledger_event:
                raw.ledger_event.event_type = str(classification["event_type"])
                raw.ledger_event.direction = "inflow" if raw.amount < 0 else "outflow"
                raw.ledger_event.amount = abs(raw.amount) if raw.amount < 0 else -abs(raw.amount)
                raw.ledger_event.date = posted_date
                raw.ledger_event.merchant_name = transaction.get("merchant_name") or transaction["name"]
                raw.ledger_event.description = transaction["name"]
                raw.ledger_event.category = classification["category"]
                raw.ledger_event.subcategory = classification["subcategory"]
                raw.ledger_event.is_transfer = bool(classification["is_transfer"])
                raw.ledger_event.is_card_payment = bool(classification["is_card_payment"])
                raw.ledger_event.exclude_from_spend = bool(classification["exclude_from_spend"])
            imported += 1
            continue

        raw = RawTransaction(
            user_id=user.id,
            plaid_item_id=plaid_item.id,
            plaid_account_id=account.id,
            plaid_transaction_id=transaction["transaction_id"],
            pending_transaction_id=transaction.get("pending_transaction_id"),
            amount=float(transaction["amount"]),
            date=posted_date,
            authorized_date=parsed_authorized_date,
            name=transaction["name"],
            merchant_name=transaction.get("merchant_name"),
            payment_channel=transaction.get("payment_channel"),
            pending=transaction.get("pending", False),
            raw_personal_finance_category=transaction.get("personal_finance_category"),
            raw_json=transaction,
        )
        db.add(raw)
        db.flush()
        create_ledger_event(
            db=db,
            user=user,
            raw_transaction=raw,
            account=account,
            event_type=str(classification["event_type"]),
            category=classification["category"],
            subcategory=classification["subcategory"],
            merchant_name=transaction.get("merchant_name") or transaction["name"],
            description=transaction["name"],
            is_transfer=bool(classification["is_transfer"]),
            is_card_payment=bool(classification["is_card_payment"]),
            exclude_from_spend=bool(classification["exclude_from_spend"]),
            confidence=0.66,
        )
        db.add(
            NotificationEvent(
                user_id=user.id,
                type="transaction",
                title=f"New transaction: {transaction.get('merchant_name') or transaction['name']}",
                body=f"Captured {transaction['name']} for ${abs(float(transaction['amount'])):,.2f}.",
                entity_type="transaction",
                entity_id=str(raw.id),
            )
        )
        imported += 1
    return imported


def _classify_transaction(name: str, merchant: str | None, amount: float) -> dict[str, str | bool]:
    merchant_text = f"{merchant or ''} {name}".lower()

    if "payment" in merchant_text and "card" in merchant_text:
        return {
            "event_type": "credit_card_payment",
            "category": "transfers",
            "subcategory": "card payment",
            "exclude_from_spend": True,
            "is_transfer": True,
            "is_card_payment": True,
        }
    if "transfer" in merchant_text or "autopay" in merchant_text:
        return {
            "event_type": "transfer",
            "category": "transfers",
            "subcategory": "internal",
            "exclude_from_spend": True,
            "is_transfer": True,
            "is_card_payment": False,
        }
    if amount < 0 and "refund" in merchant_text:
        return {
            "event_type": "refund",
            "category": "shopping",
            "subcategory": "refund",
            "exclude_from_spend": False,
            "is_transfer": False,
            "is_card_payment": False,
        }
    if amount < 0:
        return {
            "event_type": "income",
            "category": "income",
            "subcategory": "deposit",
            "exclude_from_spend": False,
            "is_transfer": False,
            "is_card_payment": False,
        }
    return {
        "event_type": "purchase",
        "category": "uncategorized",
        "subcategory": "review",
        "exclude_from_spend": False,
        "is_transfer": False,
        "is_card_payment": False,
    }
