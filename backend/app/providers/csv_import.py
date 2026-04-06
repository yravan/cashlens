"""CSV bank statement import provider.

Bank format auto-detection via header signature matching.
Profiles for Chase, Capital One, Citi, Amex, Wells Fargo, Discover.
Format reference: github.com/firefly-iii/import-configurations

Amount sign conventions vary by bank:
- Chase/BofA/Wells/Discover: outflows = negative (standard)
- Amex: charges = positive (INVERTED — set invert_sign=True)
- Capital One/Citi: separate Debit/Credit columns
"""

import csv
import hashlib
import io
import logging
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

import chardet

from app.providers.protocol import NormalizedTransaction, TransactionStatus
from app.providers.registry import register_provider

logger = logging.getLogger(__name__)


@dataclass
class BankCSVProfile:
    name: str
    header_signature: set[str]
    date_column: str
    date_format: str
    description_column: str
    amount_column: str | None
    debit_column: str | None
    credit_column: str | None
    category_column: str | None
    invert_sign: bool = False


BANK_PROFILES = [
    BankCSVProfile(
        name="chase_credit",
        header_signature={
            "transaction date", "post date", "description",
            "category", "type", "amount",
        },
        date_column="Transaction Date",
        date_format="%m/%d/%Y",
        description_column="Description",
        amount_column="Amount",
        debit_column=None,
        credit_column=None,
        category_column="Category",
    ),
    BankCSVProfile(
        name="chase_checking",
        header_signature={
            "details", "posting date", "description",
            "amount", "type", "balance",
        },
        date_column="Posting Date",
        date_format="%m/%d/%Y",
        description_column="Description",
        amount_column="Amount",
        debit_column=None,
        credit_column=None,
        category_column=None,
    ),
    BankCSVProfile(
        name="capital_one",
        header_signature={
            "transaction date", "posted date", "card no.",
            "description", "debit", "credit",
        },
        date_column="Transaction Date",
        date_format="%Y-%m-%d",
        description_column="Description",
        amount_column=None,
        debit_column="Debit",
        credit_column="Credit",
        category_column=None,
    ),
    BankCSVProfile(
        name="citi",
        header_signature={"status", "date", "description", "debit", "credit"},
        date_column="Date",
        date_format="%m/%d/%Y",
        description_column="Description",
        amount_column=None,
        debit_column="Debit",
        credit_column="Credit",
        category_column=None,
    ),
    BankCSVProfile(
        name="amex",
        header_signature={
            "date", "description", "card member", "account #", "amount",
        },
        date_column="Date",
        date_format="%m/%d/%Y",
        description_column="Description",
        amount_column="Amount",
        debit_column=None,
        credit_column=None,
        category_column=None,
        invert_sign=True,
    ),
    BankCSVProfile(
        name="wells_fargo",
        header_signature={"date", "amount", "description"},
        date_column="Date",
        date_format="%m/%d/%Y",
        description_column="Description",
        amount_column="Amount",
        debit_column=None,
        credit_column=None,
        category_column=None,
    ),
    BankCSVProfile(
        name="discover",
        header_signature={
            "trans. date", "post date", "description", "amount", "category",
        },
        date_column="Trans. Date",
        date_format="%m/%d/%Y",
        description_column="Description",
        amount_column="Amount",
        debit_column=None,
        credit_column=None,
        category_column="Category",
    ),
]


def detect_bank_format(headers: list[str]) -> BankCSVProfile | None:
    """Match CSV headers to a known bank profile (>=80% match threshold)."""
    header_set = {h.strip().lower() for h in headers}
    best_match, best_score = None, 0.0
    for profile in BANK_PROFILES:
        score = len(profile.header_signature & header_set) / len(
            profile.header_signature
        )
        if score > best_score and score >= 0.8:
            best_match, best_score = profile, score
    return best_match


def _detect_encoding(file_bytes: bytes) -> str:
    """Detect file encoding using chardet."""
    result = chardet.detect(file_bytes)
    return result.get("encoding") or "utf-8"


def _parse_amount(
    row: dict, profile: BankCSVProfile
) -> Decimal | None:
    """Extract signed amount from a CSV row based on bank profile."""
    if profile.amount_column:
        raw = row.get(profile.amount_column, "").strip()
        if not raw:
            return None
        try:
            amount = Decimal(raw.replace(",", ""))
        except InvalidOperation:
            return None
        if profile.invert_sign:
            amount = -amount
        return amount

    # Separate debit/credit columns
    debit_raw = row.get(profile.debit_column or "", "").strip()
    credit_raw = row.get(profile.credit_column or "", "").strip()
    try:
        if debit_raw:
            return -abs(Decimal(debit_raw.replace(",", "")))
        if credit_raw:
            return abs(Decimal(credit_raw.replace(",", "")))
    except InvalidOperation:
        pass
    return None


def _row_hash(row: dict, profile: BankCSVProfile, idx: int) -> str:
    """Generate a stable dedup key from row contents + position."""
    parts = [
        row.get(profile.date_column, ""),
        row.get(profile.description_column, ""),
        str(_parse_amount(row, profile) or ""),
        str(idx),
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


@register_provider("csv")
class CSVProvider:
    """CSV file import provider with automatic bank format detection."""

    provider_type = "csv"

    def __init__(self, file_bytes: bytes, filename: str = "upload.csv"):
        self.file_bytes = file_bytes
        self.filename = filename

    async def fetch_accounts(self):
        return []  # CSV has no account concept

    async def fetch_transactions(
        self,
        account_id: str = "",
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_pending: bool = False,
    ) -> list[NormalizedTransaction]:
        encoding = _detect_encoding(self.file_bytes)
        text = self.file_bytes.decode(encoding)
        reader = csv.DictReader(io.StringIO(text))

        if not reader.fieldnames:
            raise ValueError("CSV file has no headers")

        profile = detect_bank_format(list(reader.fieldnames))
        if not profile:
            raise ValueError(
                f"Unrecognized CSV format. Headers: {reader.fieldnames}"
            )

        logger.info("Detected bank format: %s", profile.name)

        transactions = []
        for idx, row in enumerate(reader):
            amount = _parse_amount(row, profile)
            if amount is None:
                continue

            try:
                tx_date = datetime.strptime(
                    row[profile.date_column].strip(), profile.date_format
                ).date()
            except (ValueError, KeyError):
                continue

            if start_date and tx_date < start_date:
                continue
            if end_date and tx_date > end_date:
                continue

            category = (
                row.get(profile.category_column, "").strip()
                if profile.category_column
                else None
            ) or None

            transactions.append(
                NormalizedTransaction(
                    provider_id=f"csv:{profile.name}:{_row_hash(row, profile, idx)}",
                    provider_type="csv",
                    account_id=account_id or f"csv:{profile.name}",
                    amount=amount,
                    date=tx_date,
                    description=row.get(profile.description_column, "").strip(),
                    category=category,
                    status=TransactionStatus.POSTED,
                )
            )

        return transactions
