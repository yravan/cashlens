"""Sync service — orchestrates provider sync → normalize → DB insert.

Handles: bank connection storage, account upsert, transaction insert with dedup,
and 3-month backfill for new connections.
"""

import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt, encrypt
from app.models.financial import Account, Transaction
from app.models.infrastructure import BankConnection, SystemEvent
from app.providers.protocol import NormalizedAccount, NormalizedTransaction

logger = logging.getLogger(__name__)

BACKFILL_DAYS = 90  # 3 months for new connections


async def save_bank_connection(
    session: AsyncSession,
    user_id: str,
    provider: str,
    access_token: str,
    institution_name: str | None = None,
) -> BankConnection:
    """Store a new bank connection with encrypted access token."""
    conn = BankConnection(
        id=uuid.uuid4(),
        user_id=user_id,
        provider=provider,
        encrypted_access_token=encrypt(access_token),
        institution_name=institution_name,
        status="active",
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)

    # Log the event
    session.add(SystemEvent(
        user_id=user_id,
        event_type="bank_connection_created",
        change_source="user",
        table_name="bank_connections",
        record_id=str(conn.id),
        new_values={"provider": provider, "institution_name": institution_name},
    ))
    await session.commit()

    logger.info("Saved bank connection %s (%s) for user %s", conn.id, provider, user_id)
    return conn


async def get_bank_connection(
    session: AsyncSession, connection_id: uuid.UUID
) -> BankConnection | None:
    result = await session.execute(
        select(BankConnection).where(BankConnection.id == connection_id)
    )
    return result.scalar_one_or_none()


async def get_decrypted_token(connection: BankConnection) -> str:
    """Decrypt the access token from a bank connection."""
    return decrypt(connection.encrypted_access_token)


async def upsert_accounts(
    session: AsyncSession,
    user_id: str,
    bank_connection_id: uuid.UUID,
    normalized_accounts: list[NormalizedAccount],
) -> dict[str, uuid.UUID]:
    """Upsert accounts from provider data. Returns {external_id: internal_id} map."""
    id_map: dict[str, uuid.UUID] = {}

    for acct in normalized_accounts:
        # Check if account already exists
        result = await session.execute(
            select(Account).where(
                Account.user_id == user_id,
                Account.external_id == acct.provider_id,
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update balance
            existing.current_balance = acct.balance_current
            existing.institution_name = acct.institution_name or existing.institution_name
            id_map[acct.provider_id] = existing.id
        else:
            # Create new account
            new_acct = Account(
                id=uuid.uuid4(),
                user_id=user_id,
                name=acct.name,
                institution_name=acct.institution_name,
                account_type=acct.account_subtype or acct.account_type or "checking",
                currency_code=acct.currency,
                current_balance=acct.balance_current,
                bank_connection_id=bank_connection_id,
                account_mask=acct.mask,
                external_id=acct.provider_id,
            )
            session.add(new_acct)
            await session.flush()
            id_map[acct.provider_id] = new_acct.id

    await session.commit()
    return id_map


async def insert_transactions(
    session: AsyncSession,
    user_id: str,
    account_id: uuid.UUID,
    transactions: list[NormalizedTransaction],
) -> int:
    """Insert normalized transactions with ON CONFLICT dedup. Returns new count."""
    if not transactions:
        return 0

    new_count = 0
    for tx in transactions:
        stmt = insert(Transaction).values(
            id=uuid.uuid4(),
            user_id=user_id,
            account_id=account_id,
            amount=tx.amount,
            currency_code=tx.currency,
            date=tx.date,
            description=tx.description,
            original_description=tx.description,
            merchant_name=tx.merchant_name,
            source=tx.provider_type,
            external_id=tx.provider_id,
            is_pending=tx.status == "pending",
            is_reviewed=False,
            raw_metadata=tx.extra,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ).on_conflict_do_nothing(
            constraint="uq_transactions_source_external_id"
        )
        result = await session.execute(stmt)
        if result.rowcount > 0:
            new_count += 1

    await session.commit()
    return new_count


async def sync_connection(
    session: AsyncSession,
    connection: BankConnection,
    days_back: int = 30,
) -> dict:
    """Full sync for a bank connection: fetch accounts + transactions.

    For new connections (never synced), backfills 3 months.
    """
    from app.providers.registry import get_provider

    access_token = decrypt(connection.encrypted_access_token)

    # Build provider kwargs based on type
    kwargs: dict = {"access_token": access_token}
    if connection.provider == "teller":
        from app.core.config import settings
        if settings.teller_environment != "sandbox":
            kwargs["cert_path"] = settings.teller_cert_path
            kwargs["key_path"] = settings.teller_key_path
    elif connection.provider == "simplefin":
        kwargs = {"access_url": access_token}

    provider = get_provider(connection.provider, **kwargs)

    # Backfill 3 months for first sync
    if connection.last_synced_at is None:
        days_back = BACKFILL_DAYS

    # Fetch accounts
    normalized_accounts = await provider.fetch_accounts()
    id_map = await upsert_accounts(
        session, connection.user_id, connection.id, normalized_accounts
    )

    # Fetch transactions per account
    start_date = date.today() - timedelta(days=days_back)
    total_new = 0
    for norm_acct in normalized_accounts:
        internal_id = id_map.get(norm_acct.provider_id)
        if not internal_id:
            continue

        txns = await provider.fetch_transactions(
            account_id=norm_acct.provider_id,
            start_date=start_date,
            include_pending=True,
        )
        count = await insert_transactions(session, connection.user_id, internal_id, txns)
        total_new += count

    # Update connection sync timestamp
    connection.last_synced_at = datetime.utcnow()
    connection.status = "active"
    connection.error_message = None
    await session.commit()

    # Log sync event
    session.add(SystemEvent(
        user_id=connection.user_id,
        event_type="sync_completed",
        change_source="sync",
        table_name="bank_connections",
        record_id=str(connection.id),
        metadata_={"provider": connection.provider, "new_transactions": total_new, "days_back": days_back},
    ))
    await session.commit()

    logger.info(
        "Sync complete for %s: %d accounts, %d new transactions",
        connection.provider, len(normalized_accounts), total_new,
    )
    return {
        "accounts": len(normalized_accounts),
        "new_transactions": total_new,
    }
