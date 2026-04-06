"""APScheduler orchestration for periodic bank sync.

Runs in-process with FastAPI (no Redis/RabbitMQ needed).
Uses explicit job IDs + replace_existing=True.
coalesce=True + max_instances=1 prevents overlap.
"""

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


async def _teller_sync_job():
    """Scheduled Teller sync — runs every 4 hours."""
    from app.core.config import settings
    from app.db.session import async_session
    from app.providers.teller import TellerProvider
    from app.services.ingestion.sync_service import sync_provider

    # TODO: load access tokens per-enrollment from DB
    # For now, skip if no teller config
    if not settings.teller_application_id:
        return

    # Teller access tokens are per-enrollment, stored in DB.
    # This job would iterate over all stored enrollments.
    logger.info("Teller sync job: implement per-enrollment sync from DB")


async def _simplefin_sync_job():
    """Scheduled SimpleFIN sync — runs every 6 hours."""
    from app.core.config import settings
    from app.db.session import async_session
    from app.providers.simplefin import SimpleFINProvider
    from app.services.ingestion.sync_service import sync_provider

    if not settings.simplefin_access_url:
        return

    provider = SimpleFINProvider(access_url=settings.simplefin_access_url)
    accounts = await provider.fetch_accounts()

    async with async_session() as session:
        total = 0
        for acct in accounts:
            count = await sync_provider(
                session=session,
                provider=provider,
                user_id="default",  # TODO: multi-user support
                account_id=acct.provider_id,
                days_back=7,
            )
            total += count
        logger.info("SimpleFIN sync complete: %d new transactions", total)


def setup_scheduler():
    """Register all sync jobs and start the scheduler."""
    scheduler.add_job(
        _teller_sync_job,
        "interval",
        hours=4,
        id="teller_sync",
        replace_existing=True,
    )
    scheduler.add_job(
        _simplefin_sync_job,
        "interval",
        hours=6,
        id="simplefin_sync",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started with jobs: %s", [j.id for j in scheduler.get_jobs()])


def shutdown_scheduler():
    """Gracefully stop the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler shut down")
