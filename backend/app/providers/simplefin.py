"""SimpleFIN Bridge provider.

Adapted from:
- bursar (github.com/avirut/bursar) — claim flow pattern
- simplefin-python (github.com/chrishas35/simplefin-python) — httpx client pattern

Rate limits: 24 requests/day, 90-day max date range.
Amounts are strings, dates are Unix timestamps, account fields are hyphenated.
Transaction IDs are unique only within an account — compose {account_id}:{txn_id}.
"""

import base64
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from urllib.parse import urlparse

import httpx

from app.providers.protocol import (
    NormalizedAccount,
    NormalizedTransaction,
    TransactionStatus,
)
from app.providers.registry import register_provider

logger = logging.getLogger(__name__)


async def claim_setup_token(setup_token: str) -> str:
    """One-time: convert base64-encoded setup token to permanent access URL.

    The setup token is a base64-encoded claim URL. POST to it once to get the
    access URL. A 403 means the token was already claimed.
    """
    claim_url = base64.b64decode(setup_token).decode("utf-8")
    async with httpx.AsyncClient() as client:
        resp = await client.post(claim_url)
        if resp.status_code == 403:
            raise ValueError(
                "Setup token already claimed — user must generate a new one"
            )
        resp.raise_for_status()
        return resp.text  # The access URL (https://user:pass@host/simplefin)


@register_provider("simplefin")
class SimpleFINProvider:
    """SimpleFIN Bridge bank data provider.

    Access URL format: https://username:password@bridge.simplefin.org/simplefin
    Single endpoint: GET {base_url}/accounts with query params.
    """

    provider_type = "simplefin"

    def __init__(self, access_url: str):
        parsed = urlparse(access_url)
        self.base_url = f"{parsed.scheme}://{parsed.hostname}{parsed.path}"
        self.auth = (parsed.username or "", parsed.password or "")

    async def _fetch(self, params: dict | None = None) -> dict:
        """Fetch from SimpleFIN /accounts endpoint with v2 protocol."""
        base_params = {"version": "2"}
        if params:
            base_params.update(params)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.base_url}/accounts",
                auth=self.auth,
                params=base_params,
            )
            if resp.status_code == 402:
                raise ConnectionError("SimpleFIN subscription expired")
            if resp.status_code == 403:
                raise PermissionError("SimpleFIN access revoked — re-setup required")
            resp.raise_for_status()

            data = resp.json()
            # Check v2 error list even on 200
            for err in data.get("errors", []):
                logger.warning("SimpleFIN error: %s", err)
            return data

    async def fetch_accounts(self) -> list[NormalizedAccount]:
        data = await self._fetch({"balances-only": "1"})
        accounts = []
        for acct in data.get("accounts", []):
            accounts.append(
                NormalizedAccount(
                    provider_id=acct["id"],
                    provider_type="simplefin",
                    name=acct["name"],
                    institution_name=acct.get("org", {}).get("name"),
                    currency=acct.get("currency", "USD"),
                    balance_current=(
                        Decimal(acct["balance"]) if acct.get("balance") else None
                    ),
                    balance_available=(
                        Decimal(acct["available-balance"])
                        if acct.get("available-balance")
                        else None
                    ),
                    balance_as_of=(
                        datetime.fromtimestamp(acct["balance-date"], tz=timezone.utc)
                        if acct.get("balance-date")
                        else None
                    ),
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
        params: dict = {"account": account_id}
        if start_date:
            params["start-date"] = str(
                int(
                    datetime.combine(
                        start_date, datetime.min.time(), tzinfo=timezone.utc
                    ).timestamp()
                )
            )
        if end_date:
            params["end-date"] = str(
                int(
                    datetime.combine(
                        end_date, datetime.min.time(), tzinfo=timezone.utc
                    ).timestamp()
                )
            )
        if include_pending:
            params["pending"] = "1"

        data = await self._fetch(params)
        transactions = []
        for acct in data.get("accounts", []):
            if acct["id"] != account_id:
                continue
            for tx in acct.get("transactions", []):
                posted_ts = tx.get("posted", 0)
                tx_date = (
                    datetime.fromtimestamp(posted_ts, tz=timezone.utc).date()
                    if posted_ts
                    else date.today()
                )
                transactions.append(
                    NormalizedTransaction(
                        provider_id=f"{account_id}:{tx['id']}",
                        provider_type="simplefin",
                        account_id=account_id,
                        amount=Decimal(tx["amount"]),
                        date=tx_date,
                        description=tx["description"],
                        status=(
                            TransactionStatus.PENDING
                            if tx.get("pending")
                            else TransactionStatus.POSTED
                        ),
                        extra=tx.get("extra"),
                    )
                )
        return transactions
