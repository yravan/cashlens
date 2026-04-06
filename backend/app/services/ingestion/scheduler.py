"""APScheduler orchestration for periodic bank sync.

Runs in-process with FastAPI (no Redis/RabbitMQ needed).
Uses explicit job IDs + replace_existing=True.
coalesce=True + max_instances=1 prevents overlap.

Multi-user: iterates ALL active bank connections and Gmail tokens from DB.
"""

import json
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(
    job_defaults={
        "coalesce": True,
        "max_instances": 1,
        "misfire_grace_time": 300,
    },
)


async def sync_all_bank_connections():
    """Iterate every active BankConnection and sync it."""
    from sqlalchemy import select

    from app.db.session import async_session
    from app.models.infrastructure import BankConnection
    from app.services.ingestion.sync_service import sync_connection

    async with async_session() as session:
        result = await session.execute(
            select(BankConnection).where(BankConnection.status == "active")
        )
        connections = result.scalars().all()

    if not connections:
        logger.debug("No active bank connections to sync")
        return

    logger.info("Starting bank sync for %d active connections", len(connections))

    for conn in connections:
        try:
            async with async_session() as session:
                # Re-fetch within this session so it's attached
                from sqlalchemy import select as sel
                fresh = await session.execute(
                    sel(BankConnection).where(BankConnection.id == conn.id)
                )
                connection = fresh.scalar_one_or_none()
                if not connection or connection.status != "active":
                    continue

                result = await sync_connection(session, connection, days_back=7)
                logger.info(
                    "Synced connection %s (%s/%s): %d new transactions",
                    connection.id,
                    connection.provider,
                    connection.user_id,
                    result.get("new_transactions", 0),
                )
        except Exception:
            logger.exception(
                "Failed to sync connection %s (%s) for user %s",
                conn.id,
                conn.provider,
                conn.user_id,
            )


async def scrape_all_gmail_receipts():
    """Iterate every stored Gmail OAuth token and scrape receipts."""
    from sqlalchemy import select

    from app.core.encryption import decrypt
    from app.db.session import async_session
    from app.models.infrastructure import UserOAuthToken

    async with async_session() as session:
        result = await session.execute(
            select(UserOAuthToken).where(UserOAuthToken.provider == "gmail")
        )
        tokens = result.scalars().all()

    if not tokens:
        logger.debug("No Gmail OAuth tokens to scrape")
        return

    logger.info("Starting Gmail receipt scrape for %d users", len(tokens))

    for token_row in tokens:
        try:
            token_data = json.loads(decrypt(token_row.encrypted_token_data))

            # Build credentials from stored token data
            from google.oauth2.credentials import Credentials

            creds = Credentials(
                token=token_data.get("token"),
                refresh_token=token_data.get("refresh_token"),
                token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
                client_id=token_data.get("client_id"),
                client_secret=token_data.get("client_secret"),
                scopes=token_data.get("scopes"),
            )

            # Refresh if expired
            if creds.expired and creds.refresh_token:
                from google.auth.transport.requests import Request
                creds.refresh(Request())

                # Update stored token
                token_data["token"] = creds.token
                from app.core.encryption import encrypt
                async with async_session() as session:
                    from sqlalchemy import select as sel
                    fresh = await session.execute(
                        sel(UserOAuthToken).where(UserOAuthToken.id == token_row.id)
                    )
                    row = fresh.scalar_one_or_none()
                    if row:
                        row.encrypted_token_data = encrypt(json.dumps(token_data))
                        if creds.expiry:
                            row.expires_at = creds.expiry
                        await session.commit()

            # Build Gmail service and fetch receipts
            from googleapiclient.discovery import build

            service = build("gmail", "v1", credentials=creds)

            from app.providers.gmail_receipts import (
                _decode_body,
                parse_email_receipt,
            )
            from app.models.infrastructure import ProcessedEmail

            # Fetch recent receipt-like emails
            query = " OR ".join([
                "{category:purchases}",
                "{category:finance}",
                "subject:(receipt OR invoice OR \"order confirmation\" OR \"payment received\")",
            ])

            results = (
                service.users()
                .messages()
                .list(userId="me", q=query, maxResults=20)
                .execute()
            )

            async with async_session() as session:
                for item in results.get("messages", []):
                    # Skip already-processed emails
                    existing = await session.execute(
                        select(ProcessedEmail).where(
                            ProcessedEmail.gmail_message_id == item["id"]
                        )
                    )
                    if existing.scalar_one_or_none():
                        continue

                    msg = (
                        service.users()
                        .messages()
                        .get(userId="me", id=item["id"], format="full")
                        .execute()
                    )
                    body = _decode_body(msg.get("payload", {}))
                    if body:
                        receipt = await parse_email_receipt(body)
                        result_status = "receipt_found" if receipt else "not_receipt"
                    else:
                        result_status = "no_body"

                    # Record as processed
                    session.add(ProcessedEmail(
                        gmail_message_id=item["id"],
                        gmail_thread_id=msg.get("threadId"),
                        processing_result=result_status,
                    ))

                await session.commit()

            logger.info(
                "Gmail scrape complete for user %s (%s)",
                token_row.user_id,
                token_row.email_address,
            )
        except Exception:
            logger.exception(
                "Failed to scrape Gmail for user %s (%s)",
                token_row.user_id,
                token_row.email_address,
            )


def setup_scheduler():
    """Register all sync jobs and start the scheduler."""
    scheduler.add_job(
        sync_all_bank_connections,
        "interval",
        hours=4,
        id="bank_sync_all",
        replace_existing=True,
    )
    scheduler.add_job(
        scrape_all_gmail_receipts,
        "interval",
        hours=6,
        id="gmail_scrape_all",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started with jobs: %s", [j.id for j in scheduler.get_jobs()])


def shutdown_scheduler():
    """Gracefully stop the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler shut down")
