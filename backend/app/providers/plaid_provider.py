"""Plaid bank data provider.

Adapted from mbafford/plaid-sync — cursor-based /transactions/sync.
plaid-python SDK is sync-only — all calls wrapped with asyncio.to_thread.

CRITICAL: Plaid uses OPPOSITE sign convention (positive=outflow).
We flip signs in the normalizer: normalized_amount = -Decimal(str(plaid_tx.amount))
"""

import asyncio
import logging
from datetime import date
from decimal import Decimal
from typing import Optional

from app.providers.protocol import (
    NormalizedAccount,
    NormalizedTransaction,
    TransactionStatus,
    TransactionType,
)
from app.providers.registry import register_provider

logger = logging.getLogger(__name__)

# Lazy-import plaid SDK to avoid import errors when plaid isn't needed
_plaid_client = None


def _get_plaid_client(client_id: str, secret: str, env: str):
    """Create or return cached Plaid API client."""
    global _plaid_client
    if _plaid_client is not None:
        return _plaid_client

    import plaid
    from plaid.api import plaid_api

    env_map = {
        "sandbox": plaid.Environment.Sandbox,
        "development": plaid.Environment.Development,
        "production": plaid.Environment.Production,
    }
    configuration = plaid.Configuration(
        host=env_map.get(env, plaid.Environment.Sandbox),
        api_key={"clientId": client_id, "secret": secret},
    )
    api_client = plaid.ApiClient(configuration)
    _plaid_client = plaid_api.PlaidApi(api_client)
    return _plaid_client


PLAID_TYPE_MAP = {
    "place": TransactionType.CARD_PAYMENT,
    "digital": TransactionType.CARD_PAYMENT,
    "special": TransactionType.OTHER,
    "unresolved": TransactionType.OTHER,
}


@register_provider("plaid")
class PlaidProvider:
    """Plaid bank data provider with cursor-based sync."""

    provider_type = "plaid"

    def __init__(
        self,
        access_token: str,
        client_id: str,
        secret: str,
        env: str = "sandbox",
    ):
        self.access_token = access_token
        self.client = _get_plaid_client(client_id, secret, env)

    async def fetch_accounts(self) -> list[NormalizedAccount]:
        from plaid.model.accounts_get_request import AccountsGetRequest

        request = AccountsGetRequest(access_token=self.access_token)
        response = await asyncio.to_thread(self.client.accounts_get, request)

        accounts = []
        for acct in response.accounts:
            balances = acct.balances
            accounts.append(
                NormalizedAccount(
                    provider_id=acct.account_id,
                    provider_type="plaid",
                    name=acct.name,
                    institution_name=acct.official_name,
                    account_type=str(acct.type) if acct.type else None,
                    account_subtype=str(acct.subtype) if acct.subtype else None,
                    mask=acct.mask,
                    currency=balances.iso_currency_code or "USD",
                    balance_current=(
                        Decimal(str(balances.current))
                        if balances.current is not None
                        else None
                    ),
                    balance_available=(
                        Decimal(str(balances.available))
                        if balances.available is not None
                        else None
                    ),
                    balance_limit=(
                        Decimal(str(balances.limit))
                        if balances.limit is not None
                        else None
                    ),
                )
            )
        return accounts

    async def sync_transactions(
        self, cursor: str = ""
    ) -> tuple[list[NormalizedTransaction], list[NormalizedTransaction], list[str], str]:
        """Cursor-based sync. Returns (added, modified, removed_ids, new_cursor)."""
        from plaid.model.transactions_sync_request import TransactionsSyncRequest

        added = []
        modified = []
        removed_ids = []

        has_more = True
        while has_more:
            request = TransactionsSyncRequest(
                access_token=self.access_token,
                cursor=cursor,
                count=500,
            )
            response = await asyncio.to_thread(
                self.client.transactions_sync, request
            )

            for tx in response.added:
                added.append(self._normalize(tx))
            for tx in response.modified:
                modified.append(self._normalize(tx))
            for tx in response.removed:
                removed_ids.append(tx.transaction_id)

            cursor = response.next_cursor
            has_more = response.has_more

        return added, modified, removed_ids, cursor

    async def fetch_transactions(
        self,
        account_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_pending: bool = False,
    ) -> list[NormalizedTransaction]:
        """Fetch via sync, filtering to account_id."""
        added, _, _, _ = await self.sync_transactions()
        txns = [t for t in added if t.account_id == account_id]
        if start_date:
            txns = [t for t in txns if t.date >= start_date]
        if end_date:
            txns = [t for t in txns if t.date <= end_date]
        if not include_pending:
            txns = [t for t in txns if t.status == TransactionStatus.POSTED]
        return txns

    def _normalize(self, tx) -> NormalizedTransaction:
        """Normalize a Plaid transaction. FLIPS SIGN (Plaid positive=outflow)."""
        pfc = getattr(tx, "personal_finance_category", None)
        category = pfc.primary if pfc else None
        subcategory = pfc.detailed if pfc else None
        confidence = pfc.confidence_level if pfc else None

        counterparties = getattr(tx, "counterparties", None) or []
        cp_name = counterparties[0].name if counterparties else None
        cp_type = counterparties[0].type if counterparties else None

        return NormalizedTransaction(
            provider_id=tx.transaction_id,
            provider_type="plaid",
            account_id=tx.account_id,
            # CRITICAL: flip sign — Plaid positive=outflow, we want positive=inflow
            amount=-Decimal(str(tx.amount)),
            date=tx.date,
            authorized_date=tx.authorized_date,
            description=tx.name or "",
            merchant_name=tx.merchant_name,
            category=category,
            subcategory=subcategory,
            category_confidence=confidence,
            transaction_type=PLAID_TYPE_MAP.get(
                tx.payment_channel or "", TransactionType.OTHER
            ),
            status=(
                TransactionStatus.PENDING
                if tx.pending
                else TransactionStatus.POSTED
            ),
            pending_transaction_id=tx.pending_transaction_id,
            payment_channel=tx.payment_channel,
            counterparty_name=cp_name,
            counterparty_type=cp_type,
        )
