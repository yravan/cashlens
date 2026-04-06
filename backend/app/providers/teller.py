"""Teller bank data provider.

Adapted from songyuew/teller — ported from requests to httpx async.
mTLS client certificates required for Development/Production.
Sandbox: no certs needed, use username=username, password=password, MFA=0000.

Amounts are strings (already signed negative=outflow).
28 categories, counterparty names, transaction types included.
"""

import logging
from datetime import date
from decimal import Decimal
from typing import Optional

import httpx

from app.providers.protocol import (
    NormalizedAccount,
    NormalizedTransaction,
    TransactionStatus,
    TransactionType,
)
from app.providers.registry import register_provider

logger = logging.getLogger(__name__)

TELLER_TYPE_MAP = {
    "card_payment": TransactionType.CARD_PAYMENT,
    "atm": TransactionType.ATM,
    "transfer": TransactionType.TRANSFER,
    "ach": TransactionType.ACH,
    "check": TransactionType.CHECK,
    "fee": TransactionType.FEE,
    "interest": TransactionType.INTEREST,
    "deposit": TransactionType.DEPOSIT,
}


@register_provider("teller")
class TellerProvider:
    """Teller API bank data provider with mTLS + Basic Auth."""

    provider_type = "teller"

    def __init__(
        self,
        access_token: str,
        cert_path: str | None = None,
        key_path: str | None = None,
    ):
        self.access_token = access_token
        self.cert = (cert_path, key_path) if cert_path and key_path else None

    def _client(self) -> httpx.AsyncClient:
        kwargs: dict = {
            "base_url": "https://api.teller.io",
            "auth": httpx.BasicAuth(self.access_token, ""),
            "headers": {"Teller-Version": "2020-10-12"},
            "timeout": 30.0,
        }
        if self.cert:
            kwargs["cert"] = self.cert
        return httpx.AsyncClient(**kwargs)

    async def fetch_accounts(self) -> list[NormalizedAccount]:
        async with self._client() as client:
            resp = await client.get("/accounts")
            resp.raise_for_status()
            accounts = []
            for acct in resp.json():
                # Fetch balance separately (live from bank)
                balance_current = None
                balance_available = None
                try:
                    bal_resp = await client.get(
                        f"/accounts/{acct['id']}/balances"
                    )
                    if bal_resp.status_code == 200:
                        bal = bal_resp.json()
                        balance_current = (
                            Decimal(bal["ledger"]) if bal.get("ledger") else None
                        )
                        balance_available = (
                            Decimal(bal["available"]) if bal.get("available") else None
                        )
                except httpx.HTTPError:
                    logger.warning("Failed to fetch balance for %s", acct["id"])

                accounts.append(
                    NormalizedAccount(
                        provider_id=acct["id"],
                        provider_type="teller",
                        name=acct.get("name", ""),
                        institution_name=acct.get("institution", {}).get("name"),
                        account_type=acct.get("type"),
                        account_subtype=acct.get("subtype"),
                        mask=acct.get("last_four"),
                        currency=acct.get("currency", "USD"),
                        balance_current=balance_current,
                        balance_available=balance_available,
                    )
                )
            return accounts

    async def fetch_transactions(
        self,
        account_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_pending: bool = False,
    ) -> list[NormalizedTransaction]:
        """Fetch transactions with pagination via count + from_id."""
        all_txns: list[NormalizedTransaction] = []
        from_id: str | None = None

        async with self._client() as client:
            while True:
                params: dict = {"count": "250"}
                if from_id:
                    params["from_id"] = from_id

                resp = await client.get(
                    f"/accounts/{account_id}/transactions",
                    params=params,
                )
                resp.raise_for_status()
                batch = resp.json()

                if not batch:
                    break

                for tx in batch:
                    tx_date = date.fromisoformat(tx["date"])

                    # Filter by date range client-side
                    if start_date and tx_date < start_date:
                        continue
                    if end_date and tx_date > end_date:
                        continue

                    status = (
                        TransactionStatus.PENDING
                        if tx.get("status") == "pending"
                        else TransactionStatus.POSTED
                    )
                    if not include_pending and status == TransactionStatus.PENDING:
                        continue

                    details = tx.get("details") or {}
                    counterparty = details.get("counterparty") or {}

                    all_txns.append(
                        NormalizedTransaction(
                            provider_id=tx["id"],
                            provider_type="teller",
                            account_id=account_id,
                            amount=Decimal(tx["amount"]),
                            date=tx_date,
                            description=tx.get("description", ""),
                            merchant_name=counterparty.get("name"),
                            category=details.get("category"),
                            transaction_type=TELLER_TYPE_MAP.get(
                                tx.get("type", ""), TransactionType.OTHER
                            ),
                            status=status,
                            counterparty_name=counterparty.get("name"),
                            counterparty_type=counterparty.get("type"),
                        )
                    )

                # Pagination: use last transaction ID as cursor
                if len(batch) < 250:
                    break
                from_id = batch[-1]["id"]

        return all_txns
