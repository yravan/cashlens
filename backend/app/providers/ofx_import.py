"""OFX/QFX file import provider.

Uses ofxtools (MIT, zero deps) for parsing.
OFX TRNTYPE values mapped to our TransactionType enum.
FITID (Financial Institution Transaction ID) used as dedup key.
"""

import io
import logging
from datetime import date
from typing import Optional

from ofxtools.Parser import OFXTree

from app.providers.protocol import (
    NormalizedTransaction,
    TransactionStatus,
    TransactionType,
)
from app.providers.registry import register_provider

logger = logging.getLogger(__name__)

OFX_TYPE_MAP = {
    "DEBIT": TransactionType.OTHER,
    "CREDIT": TransactionType.OTHER,
    "INT": TransactionType.INTEREST,
    "FEE": TransactionType.FEE,
    "SRVCHG": TransactionType.FEE,
    "DEP": TransactionType.DEPOSIT,
    "ATM": TransactionType.ATM,
    "POS": TransactionType.CARD_PAYMENT,
    "XFER": TransactionType.TRANSFER,
    "CHECK": TransactionType.CHECK,
    "DIRECTDEP": TransactionType.DEPOSIT,
    "DIRECTDEBIT": TransactionType.ACH,
    "REPEATPMT": TransactionType.ACH,
}


@register_provider("ofx")
class OFXProvider:
    """OFX/QFX file import provider."""

    provider_type = "ofx"

    def __init__(self, file_bytes: bytes, filename: str = "upload.ofx"):
        self.file_bytes = file_bytes
        self.filename = filename

    async def fetch_accounts(self):
        return []  # OFX account info could be extracted but not needed for import

    async def fetch_transactions(
        self,
        account_id: str = "",
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_pending: bool = False,
    ) -> list[NormalizedTransaction]:
        parser = OFXTree()
        parser.parse(io.BytesIO(self.file_bytes))
        ofx = parser.convert()

        transactions = []
        for stmt in ofx.statements:
            for tx in stmt.transactions:
                tx_date = tx.dtposted.date() if tx.dtposted else date.today()

                if start_date and tx_date < start_date:
                    continue
                if end_date and tx_date > end_date:
                    continue

                description = " ".join(
                    filter(None, [getattr(tx, "name", None), getattr(tx, "memo", None)])
                )
                trntype = getattr(tx, "trntype", "OTHER")

                transactions.append(
                    NormalizedTransaction(
                        provider_id=f"ofx:{tx.fitid}",
                        provider_type="ofx",
                        account_id=account_id or "ofx:import",
                        amount=tx.trnamt,  # Already a Decimal
                        date=tx_date,
                        description=description,
                        transaction_type=OFX_TYPE_MAP.get(
                            trntype, TransactionType.OTHER
                        ),
                        status=TransactionStatus.POSTED,
                    )
                )

        return transactions
