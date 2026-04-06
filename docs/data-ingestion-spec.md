# CashLens — Data Ingestion Layer Implementation Spec

**Document Status:** Implementation-Ready Spec for Claude Code  
**Last Updated:** April 2026  
**Parent Document:** cashlens-spec-v4.md  
**Scope:** Pure data ingestion only — get data from external sources, normalize it, write it to PostgreSQL. Intelligence pipeline, deduplication, and categorization are handled by separate specs.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [⭐ Source Repos to Fork From & .env Setup](#2-source-repos-to-fork-from--env-setup)
3. [Unified Provider Protocol & Data Model](#3-unified-provider-protocol--data-model)
4. [Provider 1: SimpleFIN Bridge](#4-provider-1-simplefin-bridge)
5. [Provider 2: Teller](#5-provider-2-teller)
6. [Provider 3: Plaid](#6-provider-3-plaid)
7. [Provider 4: CSV/OFX/QFX Import](#7-provider-4-csvofxqfx-import)
8. [Gmail Receipt Parsing](#8-gmail-receipt-parsing)
9. [Camera Receipt Scanning](#9-camera-receipt-scanning)
10. [OpenRouter LLM Integration](#10-openrouter-llm-integration)
11. [APScheduler Orchestration](#11-apscheduler-orchestration)
12. [Provider Comparison Matrix](#12-provider-comparison-matrix)
13. [Cost Summary](#13-cost-summary)
14. [Implementation Order](#14-implementation-order)
15. [File & Directory Structure](#15-file--directory-structure)
16. [References & Templates](#16-references--templates)

---

## 1. Architecture Overview

The ingestion layer's job is simple: pull data from all external sources, normalize it into a common schema, and insert it into PostgreSQL. It does NOT categorize, deduplicate, or run intelligence — those are downstream consumers that react to new rows appearing in the transactions/receipts tables.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DATA SOURCES                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │SimpleFIN │  │ Teller   │  │ Plaid    │  │ CSV/OFX  │  │ Gmail /    │  │
│  │ Bridge   │  │ API      │  │ API      │  │ Upload   │  │ Camera     │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
└───────┼──────────────┼────────────┼──────────────┼───────────────┼──────────┘
        │              │            │              │               │
        ▼              ▼            ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PROVIDER ABSTRACTION LAYER                              │
│                                                                             │
│  All providers implement BankProvider Protocol                              │
│  All output → NormalizedTransaction / NormalizedAccount                     │
│  Provider registry with @register_provider decorator                       │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PostgreSQL INSERT                                       │
│                                                                             │
│  INSERT INTO transactions ... ON CONFLICT (provider_type, provider_id)     │
│  DO NOTHING                                                                │
│  (downstream intelligence pipeline picks up new rows separately)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Dependencies (pip install)

```
httpx                    # HTTP client for SimpleFIN, Teller, OpenRouter
openai                   # OpenRouter (OpenAI-compatible SDK)
instructor               # Structured LLM output with Pydantic validation
plaid-python             # Official Plaid SDK (sync only — wrap with asyncio.to_thread)
ofxtools                 # OFX/QFX parser (zero deps, MIT)
google-api-python-client # Gmail API
google-auth-oauthlib     # Gmail OAuth 2.0
mail-parser              # RFC-compliant email body extraction
beautifulsoup4           # HTML receipt parsing
Pillow                   # Image preprocessing for receipt scanning
chardet                  # CSV encoding detection
apscheduler              # Job scheduling (3.x, AsyncIOScheduler)
pydantic                 # Data models
```

---

## 2. ⭐ Source Repos to Fork From & .env Setup

**DO NOT write API clients from scratch.** The following open-source projects already have working Python implementations for every provider. Clone them, study the code, and adapt the patterns into our `BankProvider` Protocol. This section is the FIRST thing to read before writing any code.

### Primary Source Repos (clone and study ALL of these)

| Repo | URL | What to extract | Provider |
|------|-----|-----------------|----------|
| **`getfin`** | https://github.com/arclighteng/fin (PyPI: `getfin`) | **The closest thing to CashLens's ingestion layer already built.** Local-first personal finance, SimpleFIN sync, CSV import, SQLite storage, `.env` config, subscription detection. Study this entire codebase first — its sync logic, data models, and credential handling are directly reusable. | SimpleFIN, CSV |
| **`bursar`** | https://github.com/avirut/bursar | Minimal SimpleFIN → Google Sheets sync. `setup.py` handles the claim flow (setup token → access URL). `update.py` does incremental daily pulls. Clean, under 200 lines total. Fork the claim flow and fetch logic directly. | SimpleFIN |
| **`simplefin-python`** | https://github.com/chrishas35/simplefin-python (PyPI: `simplefin`) | CLI that converts setup tokens to access tokens, lists account IDs, dumps transactions as JSON. Uses env vars with direnv. The cleanest SimpleFIN reference for our provider pattern. | SimpleFIN |
| **`songyuew/teller`** | https://github.com/songyuew/teller | **Working Python Teller client** with mTLS cert loading, Basic Auth, account listing, transaction fetching, and CSV export. Has the exact `requests` + cert pattern we need — convert to `httpx` async. Also shows the frontend Teller Connect auth flow. | Teller |
| **`tellerhq/examples`** | https://github.com/tellerhq/examples | **Official Teller examples** with Python backend. Shows Teller Connect widget integration, access token handling, and all API endpoints. Includes sandbox test setup. | Teller |
| **`mbafford/plaid-sync`** | https://github.com/mbafford/plaid-sync | **The most CashLens-relevant Plaid reference.** CLI syncing Plaid to SQLite with cursor-based `/transactions/sync`, `ITEM_LOGIN_REQUIRED` error handling, `--update` mode for re-auth, and date-range sync. Fork the sync loop directly. | Plaid |
| **`plaid/quickstart`** | https://github.com/plaid/quickstart | Official Plaid quickstart with Python backend. Full Link → public_token → access_token exchange flow, transaction fetching, sandbox setup. The `python/` directory has a working Flask server — port to FastAPI. | Plaid |
| **`plaid/pattern`** | https://github.com/plaid/pattern | End-to-end Plaid integration showing item creation, transaction sync, and webhook handling. More complete than quickstart. | Plaid |
| **`bhimrazy/receipt-ocr`** | https://github.com/bhimrazy/receipt-ocr | **FastAPI receipt OCR service** using OpenAI/Gemini for structured extraction. Fork the endpoint, swap to OpenRouter, add our `ReceiptData` Pydantic model. | Camera scan |
| **Firefly III import configs** | https://github.com/firefly-iii/import-configurations | **JSON configs for 100+ bank CSV formats** organized by country. Column role mappings, date formats, delimiter settings. Use as the source of truth when adding new bank CSV profiles. | CSV |

### Additional References (read, don't clone)

| Repo | URL | What to learn |
|------|-----|---------------|
| `simplefin4py` | https://github.com/jeeftor/simplefin4py | Data model classes (`FinancialData`, `Account`, `Transaction`) and async `aiohttp` fetch pattern. Don't use the library (outdated, pre-v2 protocol) but read the models. |
| `simplefin-notifier` | https://github.com/thiagogpa/simplefin-notifier | Docker + `.env` template + encryption key pattern for SimpleFIN credentials. Good DevOps reference. |
| SimpleFIN official demo script | https://beta-bridge.simplefin.org/info/developers | Copy-paste Python script: claim flow + fetch in ~15 lines. **Also provides free demo tokens for testing** — no bank account needed. |
| `simplefin/simplefin-example` | https://github.com/simplefin/simplefin-example | Official SimpleFIN example implementations. |
| `teller-ruby` | https://github.com/tellerhq/teller-ruby | The most polished Teller client (Ruby). Study the caching pattern, `links`-based resource discovery, and config setup even though it's not Python. |
| `Gmail-Api-through-Python` | https://github.com/abhishekchhibber/Gmail-Api-through-Python | Working `gmail_read.py` with full OAuth setup, token pickle, and message fetching. Port directly. |
| `SpamScope/mail-parser` | https://github.com/SpamScope/mail-parser | RFC-compliant email body/attachment extraction. Use for parsing Gmail message payloads. |

### .env.template

Create this file at the project root. Copy to `.env` and fill in credentials. **For initial development, only SimpleFIN demo token + OpenRouter key are needed.**

```env
# ═══════════════════════════════════════════════════════════════════
# CashLens — Environment Configuration
# Copy this file to .env and fill in your credentials
# ═══════════════════════════════════════════════════════════════════

# ── SimpleFIN ──────────────────────────────────────────────────────
# SETUP: Visit https://bridge.simplefin.org/simplefin/create
#   → Connect your bank → Copy the setup token
#   → Run: python -m app.providers.simplefin --claim <token>
#   → Paste the resulting access URL below
#
# FOR TESTING: Use a free demo token from the developer guide:
#   https://beta-bridge.simplefin.org/info/developers
#   (refresh page for a new demo token, claim it, paste access URL)
#
SIMPLEFIN_ACCESS_URL=

# ── Teller ─────────────────────────────────────────────────────────
# SETUP: Sign up at https://teller.io
#   → Download certificate.pem + private_key.pem from Dashboard
#   → Place in ./certs/teller/
#   → Get your app ID from Application Settings
#
# FOR TESTING: Use sandbox (no certs needed)
#   Sandbox login: username=username, password=password, MFA=0000
#
TELLER_APPLICATION_ID=
TELLER_ENVIRONMENT=sandbox
# Access tokens come from Teller Connect widget (per-enrollment)
# Store per-account in DB, not here. This is for single-account testing:
TELLER_ACCESS_TOKEN=test_token_ky6igyqi3qxa4
TELLER_CERT_PATH=./certs/teller/certificate.pem
TELLER_KEY_PATH=./certs/teller/private_key.pem

# ── Plaid ──────────────────────────────────────────────────────────
# SETUP: Sign up at https://plaid.com → Dashboard → Keys
#
# FOR TESTING: Use sandbox environment
#   Sandbox login: username=user_good, password=pass_good
#   Test institution: ins_109508 (First Platypus Bank)
#
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox

# ── Gmail ──────────────────────────────────────────────────────────
# SETUP: Follow https://martinheinz.dev/blog/84
#   → Google Cloud Console → Create project → Enable Gmail API
#   → OAuth consent screen (External) → Add your email as test user
#   → Create OAuth client ID (Desktop) → Download credentials.json
#   → Place at the path below
#
GMAIL_CREDENTIALS_PATH=./creds/gmail_credentials.json
GMAIL_TOKEN_PATH=./creds/gmail_token.pickle

# ── OpenRouter (LLM) ──────────────────────────────────────────────
# SETUP: Sign up at https://openrouter.ai → Keys → Create key
# Needed for: email receipt parsing, camera receipt scanning,
#             transaction categorization (downstream)
#
OPENROUTER_API_KEY=

# ── Database ───────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://cashlens:cashlens@localhost:5432/cashlens

# ── Encryption (for storing bank credentials at rest) ──────────────
# Generate with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY=
```

### Development Quick Start

For initial testing, you only need TWO credentials:

1. **SimpleFIN demo token** — free, no bank account needed. Visit https://beta-bridge.simplefin.org/info/developers, copy the demo token, claim it with a POST request, paste the access URL into `.env`.
2. **OpenRouter API key** — sign up at https://openrouter.ai, add $5 credit (will last months), create a key.

Everything else can use sandbox/test mode or be added later.

---

## 3. Unified Provider Protocol & Data Model

Every provider normalizes its output into these common models before anything touches the database. The Protocol pattern uses `typing.Protocol` (PEP 544) for structural subtyping — providers don't need to inherit from a base class, they just need to implement the right methods.

> **Reference:** Python Protocols vs ABCs — https://jellis18.github.io/post/2022-01-11-abc-vs-protocol/
> **Reference:** Registry pattern in Python — https://github.com/SughoshKulkarni/Python-Registry
> **Reference:** How Maybe Finance structures providers — https://deepwiki.com/maybe-finance/maybe/7-external-services
> **Reference:** How Firefly III separates data import — https://github.com/firefly-iii/data-importer

### NormalizedTransaction

```python
from typing import Optional
from decimal import Decimal
from datetime import date, datetime
from enum import Enum
from pydantic import BaseModel


class TransactionType(str, Enum):
    CARD_PAYMENT = "card_payment"
    ATM = "atm"
    TRANSFER = "transfer"
    ACH = "ach"
    CHECK = "check"
    FEE = "fee"
    INTEREST = "interest"
    DEPOSIT = "deposit"
    OTHER = "other"


class TransactionStatus(str, Enum):
    POSTED = "posted"
    PENDING = "pending"


class NormalizedTransaction(BaseModel):
    """Common transaction model all providers normalize into."""

    # Identity & source
    provider_id: str               # Provider's unique ID (dedup key)
    provider_type: str             # "simplefin" | "teller" | "plaid" | "csv" | "ofx"
    account_id: str                # Provider's account identifier

    # Core financial data — ALWAYS SIGNED: negative = outflow, positive = inflow
    amount: Decimal
    currency: str = "USD"
    date: date                     # Posted date (or transaction date if pending)
    authorized_date: Optional[date] = None

    # Description & merchant
    description: str               # Raw description from provider
    merchant_name: Optional[str] = None       # Cleaned merchant (Teller/Plaid provide this)
    category: Optional[str] = None            # Provider's category (Teller/Plaid/some CSVs)
    subcategory: Optional[str] = None         # Plaid's detailed subcategory
    category_confidence: Optional[str] = None # Plaid: VERY_HIGH/HIGH/MEDIUM/LOW

    # Classification hints
    transaction_type: TransactionType = TransactionType.OTHER
    status: TransactionStatus = TransactionStatus.POSTED
    pending_transaction_id: Optional[str] = None  # Links pending → posted (Plaid)
    payment_channel: Optional[str] = None         # online, in_store, other (Plaid)

    # Counterparty (Teller/Plaid)
    counterparty_name: Optional[str] = None
    counterparty_type: Optional[str] = None  # person, organization, merchant, payment_app

    # Extra provider-specific data
    extra: Optional[dict] = None
```

### NormalizedAccount

```python
class NormalizedAccount(BaseModel):
    """Common account model all providers normalize into."""

    provider_id: str
    provider_type: str
    name: str
    institution_name: Optional[str] = None
    account_type: Optional[str] = None     # depository, credit, loan
    account_subtype: Optional[str] = None  # checking, savings, credit_card
    mask: Optional[str] = None             # Last 4 digits
    currency: str = "USD"
    balance_current: Optional[Decimal] = None
    balance_available: Optional[Decimal] = None
    balance_limit: Optional[Decimal] = None
    balance_as_of: Optional[datetime] = None
```

### BankProvider Protocol

```python
from typing import Protocol, Optional
from datetime import date


class BankProvider(Protocol):
    """All bank data providers implement this interface."""

    provider_type: str  # "simplefin", "teller", "plaid", "csv", "ofx"

    async def fetch_accounts(self) -> list[NormalizedAccount]:
        """Return all accounts for this connection."""
        ...

    async def fetch_transactions(
        self,
        account_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_pending: bool = False,
    ) -> list[NormalizedTransaction]:
        """Return transactions for a specific account."""
        ...
```

### Provider Registry

```python
_PROVIDER_REGISTRY: dict[str, type] = {}


def register_provider(name: str):
    """Decorator to register a provider class."""
    def decorator(cls):
        _PROVIDER_REGISTRY[name] = cls
        return cls
    return decorator


def get_provider(name: str, **kwargs) -> BankProvider:
    """Factory to instantiate a provider by name."""
    cls = _PROVIDER_REGISTRY.get(name)
    if not cls:
        raise ValueError(f"Unknown provider: {name}. Available: {list(_PROVIDER_REGISTRY)}")
    return cls(**kwargs)
```

### Database Insert (the ingestion layer's only DB responsibility)

The ingestion layer inserts normalized data and nothing more. `ON CONFLICT DO NOTHING` handles re-ingestion of already-seen transactions.

```python
async def insert_normalized_transactions(
    session: AsyncSession,
    transactions: list[NormalizedTransaction],
    user_id: str,
    account_id: str,  # CashLens internal account ID
) -> int:
    """Insert normalized transactions. Returns count of new rows."""
    new_count = 0
    for tx in transactions:
        stmt = insert(Transaction).values(
            id=str(uuid4()),
            user_id=user_id,
            account_id=account_id,
            external_id=tx.provider_id,
            source=tx.provider_type,
            amount_cents=int(tx.amount * 100),
            description=tx.description,
            merchant_name=tx.merchant_name,
            date=tx.date,
            posted_date=tx.date if tx.status == TransactionStatus.POSTED else None,
            provider_type=tx.transaction_type.value,
            provider_category=tx.category,
            is_p2p_platform=tx.counterparty_type == "payment_app",
            counterparty_name=tx.counterparty_name,
            status="pending_review",
            created_at=datetime.utcnow(),
        ).on_conflict_do_nothing(
            index_elements=["source", "external_id"]  # Composite unique constraint
        )
        result = await session.execute(stmt)
        if result.rowcount > 0:
            new_count += 1
    await session.commit()
    return new_count
```

---

## 4. Provider 1: SimpleFIN Bridge

**Cost:** $15/year ($1.50/month)
**Coverage:** Thousands of US banks via MX aggregator
**Data richness:** Minimal — raw descriptions only, no categories, no merchant names, no transaction types
**Rate limits:** 24 requests/day, 90-day max date range

> **API Documentation:**
> - Protocol spec: https://www.simplefin.org/protocol.html
> - Protocol spec (GitHub markdown): https://github.com/simplefin/simplefin.github.com/blob/master/protocol.md
> - Developer guide (Bridge): https://beta-bridge.simplefin.org/info/developers
>
> **Reference Implementations:**
> - `simplefin4py` Python library (Home Assistant): https://github.com/jeeftor/simplefin4py — PyPI: https://pypi.org/project/simplefin4py/
> - `bursar` — minimal SimpleFIN → Google Sheets sync in Python/Docker: https://github.com/avirut/bursar
> - Actual Budget SimpleFIN integration & setup guide: https://actualbudget.org/docs/advanced/bank-sync/simplefin/
> - Firefly III data importer (supports SimpleFIN): https://github.com/firefly-iii/data-importer
>
> **Why NOT to use simplefin4py:** v0.0.18 (July 2024) predates the v2.0.0 protocol (March 2026). Uses aiohttp not httpx, lacks the claim flow, no rate limiting, won't support errlist/connections/balances-only. The API is one endpoint — write a custom ~100-line client instead.
>
> **⭐ FORK FROM:** Adapt the claim flow from `bursar` (setup.py), the fetch logic from `getfin` (fin/sync.py), and the CLI/env var pattern from `simplefin-python`. Read `simplefin4py`'s data model classes for field reference but don't use the library.

### Authentication Flow (3 steps, one-time)

```
Step 1: User visits https://bridge.simplefin.org/simplefin/create
        → Connects bank → Copies BASE64-ENCODED SETUP TOKEN into CashLens

Step 2: App decodes token → gets a claim URL → POSTs to claim URL (ONE-TIME ONLY)
        → Response body = Access URL (https://user:pass@bridge.simplefin.org/simplefin)
        → 403 = token already claimed (warn user, generate new token)

Step 3: App stores Access URL encrypted at rest → reuses forever
        → Parse with urlparse() to extract Basic Auth credentials
```

```python
import base64, httpx
from urllib.parse import urlparse


async def claim_simplefin_token(setup_token: str) -> str:
    """One-time: convert setup token to permanent access URL."""
    claim_url = base64.b64decode(setup_token).decode("utf-8")
    async with httpx.AsyncClient() as client:
        resp = await client.post(claim_url)
        if resp.status_code == 403:
            raise ValueError("Token already claimed — user must generate a new one")
        resp.raise_for_status()
        return resp.text  # The access URL
```

### The Single Data Endpoint

SimpleFIN has **one endpoint**: `GET {base_url}/accounts`

| Parameter | Type | Description |
|-----------|------|-------------|
| `start-date` | Unix timestamp (int) | Transactions on or after this time |
| `end-date` | Unix timestamp (int) | Transactions before (not on) this time |
| `pending` | `1` | Include pending transactions |
| `account` | string (repeatable) | Filter to specific account IDs |
| `balances-only` | `1` | Skip transactions, return only balances |
| `version` | `2` | Use v2 protocol (adds errlist, connections) |

**HTTP status codes:** 200 = success, 402 = subscription expired, 403 = access revoked.

### Response Data Model

**CRITICAL TYPE DETAILS:**
- **Amounts are STRINGS** (`"100.23"`, `"-33293.43"`) — parse with `Decimal()`
- **Dates are UNIX TIMESTAMPS** (integers) — convert with `datetime.fromtimestamp()`
- **Account field names are HYPHENATED** (`available-balance`, `balance-date`) — use Pydantic aliases
- **Transaction IDs are unique WITHIN an account only** — compose `{account_id}:{transaction_id}` for global uniqueness

```json
{
  "errors": [],
  "accounts": [
    {
      "id": "ACT-xxxx",
      "name": "My Checking",
      "currency": "USD",
      "balance": "1234.56",
      "available-balance": "1200.00",
      "balance-date": 1712345678,
      "transactions": [
        {
          "id": "TXN-xxxx",
          "posted": 1712300000,
          "amount": "-42.50",
          "description": "UBER EATS",
          "transacted_at": 1712290000,
          "pending": false,
          "extra": {}
        }
      ],
      "extra": {}
    }
  ]
}
```

### What SimpleFIN Does NOT Provide

No transaction categories, no merchant names (only raw description), no MCCs, no transaction type hints (ATM/transfer/POS), no account type (checking/savings/credit), no last-four digits, no payee/memo separation. **LLM-powered categorization (downstream, not this spec) is essential for SimpleFIN transactions.**

### Rate Limits & Constraints

- **24 requests/day** — replenished throughout the day, not midnight reset
- **90-day max** date range per request — chunk initial history loads
- **No pagination** — all matching transactions return in one response
- **Data freshness:** ~once per day per linked account (upstream MX timing)
- **Graduated enforcement:** warnings in errlist first, then access tokens get permanently disabled
- **Recommended sync frequency:** once every 4-6 hours

### Error Handling (v2 errlist)

Always check errlist even on 200 responses:
- `gen.auth` — SimpleFIN auth failure (bad credentials)
- `con.auth` — Bank connection needs re-authentication (user must visit SimpleFIN)
- `act.failed` — Temporary failure, retry later
- `act.missingdata` — Incomplete data returned

**HTML-escape all error messages before displaying** — spec warns they may contain uncontrolled content.

### SimpleFIN Client Implementation

```python
import httpx
from datetime import datetime, timezone, date
from decimal import Decimal
from urllib.parse import urlparse


@register_provider("simplefin")
class SimpleFINProvider:
    provider_type = "simplefin"

    def __init__(self, access_url: str):
        parsed = urlparse(access_url)
        self.base_url = f"{parsed.scheme}://{parsed.hostname}{parsed.path}"
        self.auth = (parsed.username, parsed.password)

    async def _fetch(self, params: dict | None = None) -> dict:
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
            for err in data.get("errors", []):
                if err.startswith("con.auth"):
                    pass  # Log and create user notification
            return data

    async def fetch_accounts(self) -> list[NormalizedAccount]:
        data = await self._fetch({"balances-only": "1"})
        accounts = []
        for acct in data.get("accounts", []):
            accounts.append(NormalizedAccount(
                provider_id=acct["id"],
                provider_type="simplefin",
                name=acct["name"],
                currency=acct.get("currency", "USD"),
                balance_current=Decimal(acct["balance"]) if acct.get("balance") else None,
                balance_available=Decimal(acct["available-balance"]) if acct.get("available-balance") else None,
                balance_as_of=datetime.fromtimestamp(acct["balance-date"], tz=timezone.utc) if acct.get("balance-date") else None,
            ))
        return accounts

    async def fetch_transactions(
        self, account_id: str,
        start_date: date | None = None,
        end_date: date | None = None,
        include_pending: bool = False,
    ) -> list[NormalizedTransaction]:
        params = {"account": account_id}
        if start_date:
            params["start-date"] = str(int(datetime.combine(start_date, datetime.min.time()).timestamp()))
        if end_date:
            params["end-date"] = str(int(datetime.combine(end_date, datetime.min.time()).timestamp()))
        if include_pending:
            params["pending"] = "1"

        data = await self._fetch(params)
        transactions = []
        for acct in data.get("accounts", []):
            if acct["id"] != account_id:
                continue
            for tx in acct.get("transactions", []):
                posted_ts = tx.get("posted", 0)
                tx_date = datetime.fromtimestamp(posted_ts, tz=timezone.utc).date() if posted_ts else date.today()
                transactions.append(NormalizedTransaction(
                    provider_id=f"{account_id}:{tx['id']}",
                    provider_type="simplefin",
                    account_id=account_id,
                    amount=Decimal(tx["amount"]),
                    date=tx_date,
                    description=tx["description"],
                    status=TransactionStatus.PENDING if tx.get("pending") else TransactionStatus.POSTED,
                    extra=tx.get("extra"),
                ))
        return transactions
```

---

## 5. Provider 2: Teller

**Cost:** Free (100 enrollments in Development), custom pricing for Production
**Coverage:** 5,000+ US financial institutions
**Data richness:** Good — 28 categories, counterparty names, transaction types
**Authentication:** Mutual TLS (client certificates) + access tokens
**Key advantage:** Live real-time data from bank mobile APIs (not scraped/cached)

> **API Documentation:**
> - Authentication: https://teller.io/docs/api/authentication
> - Accounts: https://teller.io/docs/api/accounts
> - Transactions: https://teller.io/docs/api/account/transactions
> - Webhooks: https://teller.io/docs/api/webhooks
> - Teller Connect (frontend widget): https://teller.io/docs/guides/connect
> - Environments (sandbox/dev/prod): https://teller.io/docs/guides/environments
> - Sandbox guide: https://teller.io/docs/guides/sandbox
>
> **No official Python SDK.** Write a custom httpx client with mTLS.
>
> **⭐ FORK FROM:** Port `songyuew/teller`'s Python client (https://github.com/songyuew/teller) from `requests` to `httpx` async. It already handles cert loading, Basic Auth, and transaction fetching. Study `tellerhq/examples` (https://github.com/tellerhq/examples) for the Teller Connect frontend flow and sandbox setup.

### Authentication: mTLS + Access Tokens

**Teller requires TLS client certificates** for Development and Production environments. Download `certificate.pem` and `private_key.pem` from the Teller Dashboard.

**Teller Connect** is a JavaScript widget for bank enrollment. The `onSuccess` callback returns `accessToken` and `enrollment` object. Store `accessToken` encrypted — it authenticates all API calls via HTTP Basic Auth (token = username, password = empty).

```python
import httpx

@register_provider("teller")
class TellerProvider:
    provider_type = "teller"

    def __init__(self, access_token: str, cert_path: str, key_path: str):
        self.access_token = access_token
        self.cert = (cert_path, key_path)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url="https://api.teller.io",
            cert=self.cert,
            auth=httpx.BasicAuth(self.access_token, ""),
            headers={"Teller-Version": "2020-10-12"},
            timeout=30.0,
        )
```

### Environments

| Environment | Real data? | mTLS required? | Cost | Limit |
|-------------|-----------|----------------|------|-------|
| **Sandbox** | No (fake data) | No | Free | Unlimited |
| **Development** | **Yes (real)** | Yes | **Free forever** | **100 enrollments** |
| **Production** | Yes (real) | Yes | Custom pricing | Per plan |

**Sandbox credentials:** username `username`, password `password`, MFA code `0000`.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/accounts` | GET | List all enrolled accounts |
| `/accounts/{id}/transactions` | GET | List transactions (paginated via `count` + `from_id`) |
| `/accounts/{id}/balances` | GET | **Live** balance (synchronous from bank) |
| `/accounts/{id}/details` | GET | Full account/routing numbers |

### Transaction Data Model

```json
{
  "id": "txn_xxxxxxxxxxxx",
  "account_id": "acc_xxxxxxxxxxxx",
  "date": "2026-04-01",
  "description": "Uber Eats",
  "amount": "-23.50",
  "status": "posted",
  "type": "card_payment",
  "running_balance": "1234.56",
  "details": {
    "category": "dining",
    "counterparty": { "name": "Uber Eats", "type": "organization" },
    "processing_status": "complete"
  },
  "links": { "self": "...", "account": "..." }
}
```

**Key fields:**
- `amount` — **STRING, already signed** (negative = outflow). Parse with `Decimal()`.
- `type` — `card_payment`, `atm`, `transfer`, `ach`, etc.
- `details.category` — 28 categories: accommodation, dining, fuel, groceries, income, transport, utilities, etc.
- `details.counterparty` — `name` (str) and `type` (`organization` or `person`).
- `status` — `"posted"` or `"pending"`. Pending transactions have `running_balance: null`.
- **Check `links` object** — not all banks support all endpoints.

### Type Mapping

```python
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
```

### Webhooks

Configure in Dashboard: `transactions.processed`, `enrollment.disconnected` (reasons: `credentials_invalid`, `account_locked`, `mfa_required`). Verify via `Teller-Signature` header (HMAC-SHA256, reject if timestamp > 3 min old).

### Gotchas

- Live data = higher latency; use **7-10 day lookback** to catch pending-to-posted shifts; **US-only**.

---

## 6. Provider 3: Plaid

**Cost:** Pay-as-you-go (200 free API calls, then monthly per-Item subscription)
**Coverage:** 12,000+ institutions
**Data richness:** The richest — merchant names, 104 subcategories with confidence, counterparty info, location, logos

> **API Documentation:**
> - Quickstart: https://plaid.com/docs/quickstart/
> - Glossary: https://plaid.com/docs/quickstart/glossary/
> - Transactions guide: https://plaid.com/docs/transactions/add-to-app/
> - Transactions API: https://plaid.com/docs/api/products/transactions/
> - Sync migration: https://plaid.com/docs/transactions/sync-migration/
> - Transaction states: https://plaid.com/docs/transactions/transactions-data/
> - Categories (PFC): https://plaid.com/docs/transactions/pfc-migration/
> - Link: https://plaid.com/docs/link/
> - Link update mode: https://plaid.com/docs/link/update-mode/
> - Webhooks: https://plaid.com/docs/api/webhooks/
> - Errors: https://plaid.com/docs/errors/
> - Rate limits: https://plaid.com/docs/errors/rate-limit-exceeded/
> - Sandbox: https://plaid.com/docs/sandbox/
> - Pricing: https://plaid.com/pricing/
> - Free tier FAQ: https://support.plaid.com/hc/en-us/articles/16194695660311
> - Billing: https://plaid.com/docs/account/billing/
>
> **Python SDK:**
> - `plaid-python` (official, sync only): https://github.com/plaid/plaid-python
>
> **Reference Implementations:**
> - `plaid-sync` — CLI syncing Plaid to SQLite: https://github.com/mbafford/plaid-sync
> - Plaid Quickstart repo: https://github.com/plaid/quickstart
>
> **⭐ FORK FROM:** Port the sync loop from `mbafford/plaid-sync` — it already handles cursor pagination, `ITEM_LOGIN_REQUIRED` errors, and the `--update` re-auth flow. Use `plaid/quickstart/python/` for the Link token → access token exchange. Port from Flask to FastAPI.

### Authentication Flow

```
Step 1: Server → POST /link/token/create → returns link_token (~30 min validity)
Step 2: Frontend → Plaid Link widget → user authenticates → onSuccess returns public_token
Step 3: Server → POST /item/public_token/exchange → returns permanent access_token + item_id
```

### The /transactions/sync Endpoint

```python
async def sync_plaid_transactions(plaid_client, access_token: str, stored_cursor: str = ""):
    cursor = stored_cursor
    added, modified, removed = [], [], []
    has_more = True
    while has_more:
        request = TransactionsSyncRequest(access_token=access_token, cursor=cursor, count=500)
        response = await asyncio.to_thread(plaid_client.transactions_sync, request)
        added.extend(response.added)
        modified.extend(response.modified)
        removed.extend(response.removed)
        cursor = response.next_cursor
        has_more = response.has_more
    return added, modified, removed, cursor
```

### ⚠️ CRITICAL: Amount Sign Convention

**Plaid uses the OPPOSITE sign convention from all other providers:** positive = outflow, negative = inflow. **Flip signs in normalizer:**

```python
normalized_amount = -Decimal(str(plaid_tx.amount))
```

### Transaction Data Model

Plaid provides: `transaction_id`, `account_id`, `amount` (float, inverted sign), `date`, `authorized_date`, `name`, `merchant_name`, `pending`, `pending_transaction_id`, `payment_channel`, `personal_finance_category` (primary + detailed + confidence_level), `counterparties` (array with name, type, logo_url, website), `location` (address, lat/lon).

**16 primary categories, 104 detailed subcategories** with confidence: VERY_HIGH/HIGH/MEDIUM/LOW.

### Rate Limits

| Endpoint | Per Item/min | Per Client/min |
|----------|-------------|----------------|
| `/transactions/sync` | 50 | 2,500 |
| `/accounts/get` | 15 | 15,000 |
| `/accounts/balance/get` | 5 | 1,200 |

### Pricing

- **Sandbox:** free, fake data. Test: username `user_good`, password `pass_good`, institution `ins_109508`.
- **Development:** 200 free API calls.
- **Production:** monthly per-Item subscription. Available to individual developers.

### SDK Note

`plaid-python` is **sync only**. Wrap all calls: `await asyncio.to_thread(plaid_client.method, request)`

---

## 7. Provider 4: CSV/OFX/QFX Import

**Cost:** Free
**Coverage:** Universal

> **Libraries:**
> - `ofxtools` (recommended, MIT, zero deps): https://github.com/csingley/ofxtools
> - `ofxparse` (stale since 2021, avoid): https://github.com/jseutter/ofxparse
> - `bankstatementparser` (CAMT/MT940, EU): https://github.com/sebastienrousseau/bankstatementparser
> - `mt-940` (SWIFT MT940): https://pypi.org/project/mt-940/
> - `chardet` (encoding detection): https://pypi.org/project/chardet/
>
> **CSV Format References:**
> - Firefly III import configs (100s of bank formats): https://github.com/firefly-iii/import-configurations
> - README (JSON schema): https://github.com/firefly-iii/import-configurations/blob/main/README.md
> - OFX TRNTYPE reference: https://csvconverter.biz/project/issues/98146
>
> **⭐ FORK FROM:** Use `getfin`'s CSV import logic as a starting point. For adding new bank formats, consult Firefly III's `import-configurations` repo — it has JSON configs for 100+ banks with column roles, date formats, and delimiter specs. The `ofxtools` library is production-ready and needs no wrapper — use it directly.

### OFX/QFX Parsing

```python
from ofxtools.Parser import OFXTree

parser = OFXTree()
parser.parse("statement.ofx")
ofx = parser.convert()
for stmt in ofx.statements:
    for tx in stmt.transactions:
        # tx.fitid (str, DEDUP KEY), tx.trnamt (Decimal), tx.dtposted (datetime)
        # tx.trntype (str: DEBIT/CREDIT/ATM/XFER/CHECK/etc.), tx.name, tx.memo
```

### OFX Type Mapping

```python
OFX_TYPE_MAP = {
    "DEBIT": TransactionType.OTHER, "CREDIT": TransactionType.OTHER,
    "INT": TransactionType.INTEREST, "FEE": TransactionType.FEE,
    "SRVCHG": TransactionType.FEE, "DEP": TransactionType.DEPOSIT,
    "ATM": TransactionType.ATM, "POS": TransactionType.CARD_PAYMENT,
    "XFER": TransactionType.TRANSFER, "CHECK": TransactionType.CHECK,
    "DIRECTDEP": TransactionType.DEPOSIT, "DIRECTDEBIT": TransactionType.ACH,
    "REPEATPMT": TransactionType.ACH,
}
```

### CSV Bank Format Registry

#### ⚠️ Amount Sign Conventions

| Bank | Convention | Style |
|------|-----------|-------|
| Chase CC/Checking, BofA, Wells, Discover | Outflows = NEGATIVE | Single column |
| **Amex** | **Charges = POSITIVE (INVERTED!)** | Single column |
| Capital One, Citi | N/A | **Separate Debit/Credit columns** |

```python
from dataclasses import dataclass

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
    BankCSVProfile(name="chase_credit",
        header_signature={"transaction date", "post date", "description", "category", "type", "amount"},
        date_column="Transaction Date", date_format="%m/%d/%Y",
        description_column="Description", amount_column="Amount",
        debit_column=None, credit_column=None, category_column="Category"),
    BankCSVProfile(name="chase_checking",
        header_signature={"details", "posting date", "description", "amount", "type", "balance"},
        date_column="Posting Date", date_format="%m/%d/%Y",
        description_column="Description", amount_column="Amount",
        debit_column=None, credit_column=None, category_column=None),
    BankCSVProfile(name="capital_one",
        header_signature={"transaction date", "posted date", "card no.", "description", "debit", "credit"},
        date_column="Transaction Date", date_format="%Y-%m-%d",
        description_column="Description", amount_column=None,
        debit_column="Debit", credit_column="Credit", category_column=None),
    BankCSVProfile(name="citi",
        header_signature={"status", "date", "description", "debit", "credit"},
        date_column="Date", date_format="%m/%d/%Y",
        description_column="Description", amount_column=None,
        debit_column="Debit", credit_column="Credit", category_column=None),
    BankCSVProfile(name="amex",
        header_signature={"date", "description", "card member", "account #", "amount"},
        date_column="Date", date_format="%m/%d/%Y",
        description_column="Description", amount_column="Amount",
        debit_column=None, credit_column=None, category_column=None,
        invert_sign=True),
    BankCSVProfile(name="wells_fargo",
        header_signature={"date", "amount", "description"},
        date_column="Date", date_format="%m/%d/%Y",
        description_column="Description", amount_column="Amount",
        debit_column=None, credit_column=None, category_column=None),
    BankCSVProfile(name="discover",
        header_signature={"trans. date", "post date", "description", "amount", "category"},
        date_column="Trans. Date", date_format="%m/%d/%Y",
        description_column="Description", amount_column="Amount",
        debit_column=None, credit_column=None, category_column="Category"),
]

def detect_bank_format(headers: list[str]) -> BankCSVProfile | None:
    header_set = {h.strip().lower() for h in headers}
    best_match, best_score = None, 0
    for profile in BANK_PROFILES:
        score = len(profile.header_signature & header_set) / len(profile.header_signature)
        if score > best_score and score >= 0.8:
            best_match, best_score = profile, score
    return best_match
```

---

## 8. Gmail Receipt Parsing

**Cost:** Free (15,000 quota units/user/minute)

> **References:**
> - Gmail API Python reference: https://developers.google.com/resources/api-libraries/documentation/gmail/v1/python/latest/gmail_v1.users.messages.html
> - Gmail history.list: https://googleapis.dev/java/google-api-services-gmail/latest/com/google/api/services/gmail/Gmail.Users.History.List.html
> - Google APIs Python tutorial (OAuth walkthrough): https://martinheinz.dev/blog/84
> - `bhimrazy/receipt-ocr` — FastAPI receipt OCR reference: https://github.com/bhimrazy/receipt-ocr

### OAuth Setup

Desktop app credential type in Google Cloud Console. Enable Gmail API. Add email as test user. Download `credentials.json`. **GOTCHA:** Testing status = refresh tokens expire in 7 days. Publish for permanent tokens.

### Incremental Sync with historyId

Store `historyId` from responses. Use `history.list` (2 quota units) for subsequent syncs. Fall back to full sync if historyId expires (~1 week).

### Email Body Extraction

Gmail uses **URL-safe base64**. Check for **Schema.org JSON-LD** first — many merchants embed structured order data as `<script type="application/ld+json">`.

### LLM Receipt Extraction

Send HTML to OpenRouter via Instructor with `EmailReceiptResult` Pydantic model. Truncate HTML to ~8000 chars to control tokens.

---

## 9. Camera Receipt Scanning

**Cost:** ~$0.0003 per receipt (Gemini 2.5 Flash-Lite)

> **References:**
> - LLM vision cost analysis: https://medium.com/@rajeev_ratan/how-llms-see-images-and-what-it-really-costs-you
> - LLM vs OCR benchmarks: https://arxiv.org/html/2509.04469v1
> - Receipt OCR FastAPI reference: https://github.com/bhimrazy/receipt-ocr
>
> **⭐ FORK FROM:** Clone `bhimrazy/receipt-ocr` — it's already a FastAPI service doing structured receipt extraction with LLM vision. Swap OpenAI for OpenRouter, replace their response model with our `ReceiptData` Pydantic model, add Pillow preprocessing.

### Image Preprocessing

Resize to 1024px max, grayscale, JPEG quality 85. Use `Pillow`.

### Vision Model Pricing

| Model | Input/1M tokens | Output/1M tokens | Cost/receipt |
|-------|----------------|------------------|-------------|
| Gemini 2.0 Flash Lite | $0.075 | $0.30 | ~$0.0002 |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | ~$0.0003 |
| GPT-4o-mini | $0.15 | $0.60 | ~$0.0005 |

---

## 10. OpenRouter LLM Integration

> **Documentation:**
> - OpenRouter API: https://openrouter.ai/docs
> - OpenRouter tutorial: https://www.datacamp.com/tutorial/openrouter
> - Free models: https://openrouter.ai/openrouter/free — also: https://costgoat.com/pricing/openrouter-free-models
> - LLM pricing 2026: https://www.tldl.io/resources/llm-api-pricing-2026
> - Instructor docs: https://python.useinstructor.com/
>
> **Why NOT LiteLLM:**
> - Supply chain attack March 24, 2026 (credential-stealing malware in v1.82.7/1.82.8): https://docs.litellm.ai/blog/security-update-march-2026
> - Full analysis: https://snyk.io/blog/poisoned-security-scanner-backdooring-litellm/
> - OpenRouter already does unified model routing — LiteLLM on top is redundant

### Client Setup

```python
from openai import AsyncOpenAI

openrouter_client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
    default_headers={"HTTP-Referer": "https://cashlens.app", "X-OpenRouter-Title": "CashLens"},
)
```

### Instructor Integration

```python
import instructor

instructor_client = instructor.from_provider("openrouter/google/gemini-2.5-flash-lite", async_client=True)
```

### Model Fallback

```python
extra_body={
    "models": ["google/gemini-2.5-flash-lite", "openai/gpt-4o-mini", "google/gemini-2.5-flash"],
    "route": "fallback",
    "provider": {"require_parameters": True},
    "plugins": [{"id": "response-healing"}],
}
```

### Cost Tracking

Every response includes `resp.usage.cost` (dollars). Log to `LLMUsageLog` table.

---

## 11. APScheduler Orchestration

> **Documentation:**
> - APScheduler 3.x user guide: https://apscheduler.readthedocs.io/en/3.x/userguide.html
> - APScheduler architecture: https://enqueuezero.com/concrete-architecture/apscheduler.html
>
> **Why APScheduler over Celery/arq/taskiq:** Runs in-process with FastAPI, zero external deps (no Redis/RabbitMQ). Single-user app doesn't need distributed task queues.

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore

scheduler = AsyncIOScheduler(
    jobstores={"default": SQLAlchemyJobStore(url=DATABASE_URL)},
    job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 300},
)
```

**Critical:** Always use explicit job IDs + `replace_existing=True`. Set `coalesce=True` and `max_instances=1`.

---

## 12. Provider Comparison Matrix

| Capability | SimpleFIN | Teller | Plaid | CSV/OFX |
|-----------|----------|--------|-------|---------|
| **Cost** | $15/year | Free (100 enrollments) | Per-Item monthly | Free |
| **Merchant name** | ❌ | ✅ | ✅ (enriched) | ❌ |
| **Category** | ❌ | ✅ (28) | ✅ (104 + confidence) | ❌ (some CSVs) |
| **Transaction type** | ❌ | ✅ | ✅ | ✅ (OFX TRNTYPE) |
| **Counterparty** | ❌ | ✅ | ✅ (+ logo) | ❌ |
| **Dedup key** | `{acct}:{txn_id}` | `txn_xxx` (global) | `transaction_id` | FITID / hash |
| **Amount format** | String (signed) | String (signed) | **Float (INVERTED!)** | Decimal (OFX) |
| **Auth complexity** | Simple | Medium (mTLS) | Complex (Link widget) | None |

---

## 13. Cost Summary

| Component | Annual Cost |
|-----------|------------|
| SimpleFIN Bridge | $15.00 |
| Teller (Development) | $0.00 |
| Gmail API | $0.00 |
| OpenRouter LLM (all tasks) | ~$1.00 |
| CSV/OFX import | $0.00 |
| **Total** | **~$16/year** |

---

## 14. Implementation Order

### Phase 0: Study Existing Code (Day 1)
Before writing a single line, clone and read these repos:
```bash
git clone https://github.com/arclighteng/fin.git        # getfin — full SimpleFIN+CSV finance app
git clone https://github.com/avirut/bursar.git           # SimpleFIN claim flow + fetch
git clone https://github.com/chrishas35/simplefin-python.git  # SimpleFIN CLI + env var pattern
git clone https://github.com/songyuew/teller.git         # Python Teller client with mTLS
git clone https://github.com/mbafford/plaid-sync.git     # Plaid cursor sync to SQLite
git clone https://github.com/plaid/quickstart.git        # Official Plaid Python quickstart
git clone https://github.com/bhimrazy/receipt-ocr.git    # FastAPI receipt OCR service
```
Study `getfin` most carefully — its sync service, data models, and credential handling are closest to what we need.

### Phase 1: Foundation + .env (Week 1)
1. **Copy `.env.template` → `.env`**, fill in SimpleFIN demo token + OpenRouter key
2. **Provider Protocol + Registry** — adapt from `getfin`'s provider pattern
3. **Database insert function** — `ON CONFLICT DO NOTHING`
4. **APScheduler setup** — lifespan integration
5. **OpenRouter client + Instructor** — test with a simple categorization call

### Phase 2: File Import (Week 2)
6. **CSV import** — bank format registry, header detection, 7 bank profiles. Use Firefly III import-configurations as format reference.
7. **OFX/QFX import** — `ofxtools` parsing. This is the simplest provider.

### Phase 3: Bank Sync (Week 3)
8. **SimpleFIN** — fork claim flow from `bursar`, fetch pattern from `getfin` or `simplefin-python`. Test with demo token first, then connect real bank.
9. **Teller** — port `songyuew/teller`'s Python client from `requests` to `httpx` async. Add mTLS cert loading. Test with sandbox first.

### Phase 4: Receipts (Week 4)
10. **Gmail receipt parser** — port OAuth from `Gmail-Api-through-Python`, add incremental sync via historyId
11. **Camera receipt scanner** — fork from `bhimrazy/receipt-ocr`, swap to OpenRouter, add `ReceiptData` model

### Phase 5: Advanced (Week 5)
12. **Plaid** — fork sync loop from `mbafford/plaid-sync`, port to async. Use `plaid/quickstart` for the Link flow. Test with sandbox.

---

## 15. File & Directory Structure

```
backend/app/
├── providers/
│   ├── protocol.py          # BankProvider Protocol, NormalizedTransaction, NormalizedAccount
│   ├── registry.py          # @register_provider, get_provider()
│   ├── simplefin.py
│   ├── teller.py
│   ├── plaid_provider.py    # Avoid name clash with plaid package
│   ├── csv_import.py        # CSVProvider + BankCSVProfile profiles
│   ├── ofx_import.py
│   ├── gmail_receipts.py
│   └── camera_scan.py
├── ingestion/
│   ├── sync_service.py      # Orchestrates provider sync → normalize → DB insert
│   └── scheduler.py         # APScheduler setup + job definitions
├── llm/
│   ├── client.py            # OpenRouter + Instructor setup
│   ├── models.py            # EmailReceiptResult, ReceiptData, etc.
│   └── cost_tracker.py
```

---

## 16. References & Templates

### Bank Provider APIs

| Resource | URL |
|----------|-----|
| SimpleFIN Protocol spec | https://www.simplefin.org/protocol.html |
| SimpleFIN Protocol (GitHub) | https://github.com/simplefin/simplefin.github.com/blob/master/protocol.md |
| SimpleFIN Bridge dev guide | https://beta-bridge.simplefin.org/info/developers |
| Teller Authentication | https://teller.io/docs/api/authentication |
| Teller Accounts | https://teller.io/docs/api/accounts |
| Teller Transactions | https://teller.io/docs/api/account/transactions |
| Teller Webhooks | https://teller.io/docs/api/webhooks |
| Teller Connect | https://teller.io/docs/guides/connect |
| Teller Environments | https://teller.io/docs/guides/environments |
| Teller Sandbox | https://teller.io/docs/guides/sandbox |
| Plaid Quickstart | https://plaid.com/docs/quickstart/ |
| Plaid Glossary | https://plaid.com/docs/quickstart/glossary/ |
| Plaid Transactions | https://plaid.com/docs/transactions/add-to-app/ |
| Plaid Transactions API | https://plaid.com/docs/api/products/transactions/ |
| Plaid Sync migration | https://plaid.com/docs/transactions/sync-migration/ |
| Plaid Transaction states | https://plaid.com/docs/transactions/transactions-data/ |
| Plaid Categories (PFC) | https://plaid.com/docs/transactions/pfc-migration/ |
| Plaid Link | https://plaid.com/docs/link/ |
| Plaid Webhooks | https://plaid.com/docs/api/webhooks/ |
| Plaid Errors | https://plaid.com/docs/errors/ |
| Plaid Rate limits | https://plaid.com/docs/errors/rate-limit-exceeded/ |
| Plaid Sandbox | https://plaid.com/docs/sandbox/ |
| Plaid Pricing | https://plaid.com/pricing/ |
| Plaid Billing | https://plaid.com/docs/account/billing/ |

### Python Libraries

| Library | URL | Notes |
|---------|-----|-------|
| `simplefin4py` | https://github.com/jeeftor/simplefin4py | Don't use — outdated |
| `plaid-python` | https://github.com/plaid/plaid-python | Official SDK, sync only |
| `ofxtools` | https://github.com/csingley/ofxtools | Recommended OFX parser |
| `bankstatementparser` | https://github.com/sebastienrousseau/bankstatementparser | EU formats |
| `mt-940` | https://pypi.org/project/mt-940/ | SWIFT MT940 |
| `chardet` | https://pypi.org/project/chardet/ | Encoding detection |
| `instructor` | https://python.useinstructor.com/ | Structured LLM output |
| APScheduler 3.x | https://apscheduler.readthedocs.io/en/3.x/userguide.html | Scheduler docs |

### Open-Source Finance Apps (Architecture Patterns)

| Project | URL | What to learn |
|---------|-----|---------------|
| Maybe Finance (44K★) | https://github.com/maybe-finance/maybe | Provider abstraction |
| Maybe external services | https://deepwiki.com/maybe-finance/maybe/7-external-services | Service layer patterns |
| Firefly III Data Importer | https://github.com/firefly-iii/data-importer | Separate import app |
| Firefly III CSV configs | https://github.com/firefly-iii/import-configurations | Bank CSV format configs |
| Bursar (SimpleFIN → Sheets) | https://github.com/avirut/bursar | Minimal SimpleFIN reference |
| plaid-sync (Plaid → SQLite) | https://github.com/mbafford/plaid-sync | Minimal Plaid reference |
| Plaid Quickstart | https://github.com/plaid/quickstart | Official multi-language |
| Actual Budget SimpleFIN | https://actualbudget.org/docs/advanced/bank-sync/simplefin/ | SimpleFIN setup guide |
| OpenBB Platform | https://deepwiki.com/OpenBB-finance/OpenBB | 3-stage pipeline pattern |

### LLM & OpenRouter

| Resource | URL |
|----------|-----|
| OpenRouter API docs | https://openrouter.ai/docs |
| OpenRouter tutorial | https://www.datacamp.com/tutorial/openrouter |
| OpenRouter free models | https://openrouter.ai/openrouter/free |
| Free models list | https://costgoat.com/pricing/openrouter-free-models |
| LLM pricing 2026 | https://www.tldl.io/resources/llm-api-pricing-2026 |
| LLM vision costs | https://medium.com/@rajeev_ratan/how-llms-see-images-and-what-it-really-costs-you |
| LLM vs OCR benchmarks | https://arxiv.org/html/2509.04469v1 |
| Receipt OCR reference | https://github.com/bhimrazy/receipt-ocr |
| LLM cost optimization | https://www.maviklabs.com/blog/llm-cost-optimization-2026 |

### Architecture Patterns

| Resource | URL |
|----------|-----|
| Python Protocol vs ABC | https://jellis18.github.io/post/2022-01-11-abc-vs-protocol/ |
| Python Registry pattern | https://github.com/SughoshKulkarni/Python-Registry |
| APScheduler architecture | https://enqueuezero.com/concrete-architecture/apscheduler.html |
| Gmail API Python ref | https://developers.google.com/resources/api-libraries/documentation/gmail/v1/python/latest/ |
| Google APIs Python tutorial | https://martinheinz.dev/blog/84 |

### Security (Why Not LiteLLM)

| Resource | URL |
|----------|-----|
| LiteLLM incident report | https://docs.litellm.ai/blog/security-update-march-2026 |
| Snyk analysis | https://snyk.io/blog/poisoned-security-scanner-backdooring-litellm/ |
| Kaspersky analysis | https://www.kaspersky.com/blog/critical-supply-chain-attack-trivy-litellm-checkmarx-teampcp/55510/ |
| Trend Micro deep dive | https://www.trendmicro.com/en_us/research/26/c/inside-litellm-supply-chain-compromise.html |

---

*This spec covers pure data ingestion only. Intelligence pipeline (categorization, pattern learning, reimbursement matching) and deduplication logic are separate downstream specs.*
