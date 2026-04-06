"""Ingestion API routes — file upload, bank connections, sync, receipt scan."""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from httpx import HTTPStatusError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.db.session import get_db
from app.providers.camera_scan import scan_receipt
from app.providers.csv_import import CSVProvider
from app.providers.ofx_import import OFXProvider
from app.providers.simplefin import SimpleFINProvider, claim_setup_token
from app.providers.teller import TellerProvider
from app.services.ingestion.sync_service import (
    save_bank_connection,
    sync_connection,
    get_bank_connection,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


# ── Bank Connections ──────────────────────────────────────────────


@router.post("/connect/teller")
async def connect_teller(
    access_token: str,
    institution_name: str = "",
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Save a Teller enrollment and run initial 3-month backfill sync."""
    connection = await save_bank_connection(
        db, user_id, "teller", access_token, institution_name or None,
    )
    try:
        result = await sync_connection(db, connection)
    except HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        logger.exception("Teller sync failed")
        raise HTTPException(status_code=500, detail=str(e))
    return {"connection_id": str(connection.id), **result}


@router.post("/connect/simplefin")
async def connect_simplefin(
    access_url: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Save a SimpleFIN connection and run initial 3-month backfill sync."""
    connection = await save_bank_connection(
        db, user_id, "simplefin", access_url,
    )
    try:
        result = await sync_connection(db, connection)
    except Exception as e:
        logger.exception("SimpleFIN sync failed")
        raise HTTPException(status_code=500, detail=str(e))
    return {"connection_id": str(connection.id), **result}


@router.post("/sync/{connection_id}")
async def sync_bank_connection(
    connection_id: str,
    days_back: int = 30,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Re-sync an existing bank connection."""
    import uuid as _uuid
    connection = await get_bank_connection(db, _uuid.UUID(connection_id))
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")
    try:
        result = await sync_connection(db, connection, days_back=days_back)
    except HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    return result


# ── SimpleFIN claim (pre-connection) ──────────────────────────────


@router.post("/simplefin/claim")
async def simplefin_claim(
    setup_token: str,
    user_id: str = Depends(get_current_user_id),
):
    """One-time: convert SimpleFIN setup token to access URL."""
    access_url = await claim_setup_token(setup_token)
    return {"access_url": access_url}


# ── Quick test endpoints (no DB, for debugging) ──────────────────


@router.post("/teller/test")
async def teller_test(
    access_token: str,
    days_back: int = 30,
    user_id: str = Depends(get_current_user_id),
):
    """Test Teller connection without saving to DB."""
    from datetime import date, timedelta

    cert = settings.teller_cert_path if settings.teller_environment != "sandbox" else None
    key = settings.teller_key_path if settings.teller_environment != "sandbox" else None
    provider = TellerProvider(access_token=access_token, cert_path=cert, key_path=key)
    try:
        accounts = await provider.fetch_accounts()
    except HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))

    start_date = date.today() - timedelta(days=days_back)
    all_txns = []
    for acct in accounts:
        txns = await provider.fetch_transactions(
            account_id=acct.provider_id, start_date=start_date, include_pending=True,
        )
        all_txns.extend([t.model_dump(mode="json") for t in txns])
    return {
        "accounts": [a.model_dump(mode="json") for a in accounts],
        "transactions": all_txns,
        "count": len(all_txns),
    }


# ── File Import ───────────────────────────────────────────────────


@router.post("/upload/csv")
async def upload_csv(
    file: UploadFile = File(...),
    account_id: str = "",
    user_id: str = Depends(get_current_user_id),
):
    contents = await file.read()
    provider = CSVProvider(file_bytes=contents, filename=file.filename or "upload.csv")
    transactions = await provider.fetch_transactions(account_id=account_id)
    return {"filename": file.filename, "count": len(transactions),
            "transactions": [t.model_dump(mode="json") for t in transactions]}


@router.post("/upload/ofx")
async def upload_ofx(
    file: UploadFile = File(...),
    account_id: str = "",
    user_id: str = Depends(get_current_user_id),
):
    contents = await file.read()
    provider = OFXProvider(file_bytes=contents, filename=file.filename or "upload.ofx")
    transactions = await provider.fetch_transactions(account_id=account_id)
    return {"filename": file.filename, "count": len(transactions),
            "transactions": [t.model_dump(mode="json") for t in transactions]}


# ── Receipt Scan ──────────────────────────────────────────────────


@router.post("/scan/receipt")
async def scan_receipt_endpoint(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    contents = await file.read()
    result = await scan_receipt(contents)
    if result is None:
        return {"error": "Could not extract receipt data"}
    return result.model_dump(mode="json")
