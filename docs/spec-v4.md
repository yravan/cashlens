# CashLens — Technical Architecture Specification

**Document Status:** Unified Spec — v4.0
**Last Updated:** April 2026
**Audience:** Engineering (Claude Code), technical leadership, and anyone who needs to understand how this system works end-to-end.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement and Product Vision](#2-problem-statement-and-product-vision)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Tech Stack and Assembly Strategy](#4-tech-stack-and-assembly-strategy)
5. [External Data Sources](#5-external-data-sources)
6. [Data Ingestion Layer](#6-data-ingestion-layer)
7. [Data Storage Layer](#7-data-storage-layer)
8. [Intelligence Engine](#8-intelligence-engine)
9. [API Layer](#9-api-layer)
10. [Frontend Dashboard](#10-frontend-dashboard)
11. [Authentication and Security](#11-authentication-and-security)
12. [Infrastructure and Deployment](#12-infrastructure-and-deployment)
13. [Monitoring and Observability](#13-monitoring-and-observability)
14. [Build Sequence and Phasing](#14-build-sequence-and-phasing)
15. [Test Plan](#15-test-plan)
16. [Risk Register](#16-risk-register)
17. [Glossary](#17-glossary)

---

## 1. Executive Summary

CashLens is a self-hosted personal finance app that uses LLM-powered intelligence to track, categorize, and explain every dollar that flows through your bank accounts, credit cards, and P2P payment platforms. It is built as a monorepo with a FastAPI (Python) backend and a Next.js (React) frontend.

The system has three core subsystems:

1. **A data pipeline** that pulls transactions from bank accounts (via SimpleFIN), parses email receipts (via Gmail API), and accepts manual entries and CSV imports.
2. **An intelligence engine** that uses tiered LLM routing (cheap/mid/smart models via OpenRouter) to categorize transactions, detect duplicates, match reimbursements, identify refunds, and extract receipt data — all without hardcoded regex or keyword lists.
3. **A review queue** where every uncertain AI decision surfaces for one-tap human confirmation. The system learns from each confirmation and auto-applies patterns after 2+ confirmations.

The closest analogy is Monarch Money or YNAB, but self-hosted, LLM-powered, and designed so that every dollar is accounted for — the app actively drives an "unallocated" number toward $0.

---

## 2. Problem Statement and Product Vision

### 2.1 The Problem

Existing personal finance apps fall into two camps, and both fail:

| Category | Examples | What's Wrong |
|---|---|---|
| **Auto-categorize everything** | Mint (dead), Copilot, Monarch | Can't handle Venmo ("haha thanks bro 🍕"), ATM cash, split bills, or reimbursements. 30-40% of transactions are wrong or uncategorized. You spend more time fixing than it saves. |
| **Manual everything** | YNAB, spreadsheets | Accurate but brutal. Every transaction requires manual entry. One missed weekend and you're behind forever. |

The specific pain points this app solves:

| Pain Point | Why It's Hard | CashLens Approach |
|---|---|---|
| Venmo/Zelle descriptions are useless | "april fool lol" tells you nothing about category | Learn person + amount + timing patterns. Ask when uncertain. Auto-apply after 2+ confirmations. |
| ATM cash disappears into a black hole | $60 ATM withdrawal = $60 unaccounted | Detect ATM withdrawals, prompt for allocation. Track unallocated balance toward $0. |
| Reimbursements distort spending | You paid $200 for dinner, 3 friends Venmo'd you $150 back. Reports show $200 dining. | Match incoming P2P payments to original expenses. Net cost = $50 dining, not $200. |
| Cross-account duplicates | Same $1,200 rent appears on your bank statement AND your Venmo account | Detect same-amount, same-date transactions across accounts. Hide duplicates. |
| Merchant refunds float in limbo | Amazon refund for $47.32 sits as uncategorized income | Match credits to original purchases using amount, merchant, and email receipt order numbers. |
| Email receipts sit unread | DoorDash receipt with itemized line items, but only "DOORDASH*ORDER" on your card | Parse email receipts, match to bank transactions, enable per-item categorization. |
| No one knows where the money actually went | End-of-month: "I made $4,200 and spent... somewhere?" | Complete breakdown report with every dollar accounted for, unallocated line driven to $0. |

### 2.2 Product Vision

**The promise:** Every dollar that flows through your bank accounts, cards, Venmo, and PayPal is tracked, categorized, and accounted for — either automatically by the system or with a quick tap in the review queue. The "complete breakdown" report has an explicit unallocated line that the app actively drives toward $0.

### 2.3 Design Principles

1. **Assemble, don't build.** Use existing open-source templates, libraries, and components wherever possible. Custom code only for genuinely novel logic.
2. **LLM for all fuzzy text.** No regex, no keyword lists, no hardcoded string matching. The LLM handles merchant name cleaning, P2P platform detection, refund identification, counterparty extraction, and receipt parsing.
3. **Human-in-the-loop.** Every uncertain AI decision goes to the review queue. The system learns from confirmations and applies patterns automatically after 2+ confirmations.
4. **Cheap by default.** Tiered LLM routing puts the cheapest model on high-volume tasks. Target: ~$3.50/year in LLM costs.
5. **Every dollar accounted for.** The "unallocated" number drives toward $0. ATM cash, Venmo mystery payments, and uncategorized transactions all get surfaced and resolved.

### 2.4 Intended User

The primary user is **you** — a financially literate person who wants to understand exactly where their money goes without spending hours on manual data entry. You're comfortable self-hosting a Docker container and setting up API keys, but you want the daily experience to be fast taps on your phone while waiting for coffee.

### 2.5 Scope Boundaries

**In scope:**
- All transactions from bank accounts, credit cards, and P2P platforms (Venmo, Zelle, CashApp, PayPal).
- Email receipt parsing and line-item categorization.
- Camera receipt scanning via phone.
- Event-based spending tracking ("Date — April 3", "Scooter tire blowout").
- Natural language queries ("How much did I spend on dining this month?").
- PWA with iOS push notifications.

**Out of scope:**
- Someone else pays for you (no transaction exists — not trackable).
- Tracking consumption of prepaid credits (purchase date = spend date is fine).
- Native iOS/Android app (PWA is sufficient).
- Investment tracking or net worth calculations.
- Budgeting / envelope system (this is a tracking app, not a budgeting app).

---

## 3. System Architecture Overview

### 3.1 High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DATA SOURCES                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │SimpleFIN │  │ Gmail    │  │ CSV/OFX  │  │ Camera   │  │ Manual     │  │
│  │(16K+     │  │ API      │  │ Upload   │  │ Receipt  │  │ Entry      │  │
│  │ banks)   │  │(receipts)│  │          │  │ Scan     │  │            │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
└───────┼──────────────┼───────────┼──────────────┼───────────────┼──────────┘
        │              │           │              │               │
        ▼              ▼           ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA INGESTION LAYER                                 │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Bank Sync   │  │ Email       │  │ CSV/OFX      │  │ Receipt OCR    │  │
│  │ Service     │  │ Scraper     │  │ Parser       │  │ (LLM Vision)   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └────────┬───────┘  │
└─────────┼────────────────┼────────────────┼────────────────────┼────────────┘
          │                │                │                    │
          ▼                ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      INTELLIGENCE ENGINE                                    │
│                                                                             │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │ Categorizer  │  │ Dedup      │  │ Reimbursement│  │ Merchant Refund  │ │
│  │ (pre→LLM→    │  │ Detector   │  │ Matcher      │  │ Linker           │ │
│  │  post flow)  │  │            │  │              │  │                  │ │
│  └──────┬───────┘  └──────┬─────┘  └──────┬───────┘  └────────┬─────────┘ │
│         │                 │               │                    │           │
│  ┌──────▼───────┐  ┌──────▼─────┐  ┌──────▼───────┐                      │
│  │ Receipt      │  │ Recurring  │  │ Event        │                      │
│  │ Matcher      │  │ Pattern    │  │ Suggester    │                      │
│  │              │  │ Detector   │  │              │                      │
│  └──────────────┘  └────────────┘  └──────────────┘                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LLM Client (LiteLLM + Instructor)                │   │
│  │  cheap: gemini-2.5-flash-lite | mid: gemini-2.5-flash | smart: haiku│   │
│  │  Built-in: cost tracking, retry, timeout, structured output         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA STORAGE LAYER                                  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                      PostgreSQL                                       │ │
│  │  Transactions, Accounts, Categories, Receipts, Events, Reviews,       │ │
│  │  Patterns, Chat, LLM Usage Logs, Audit Log                           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API LAYER (FastAPI)                                │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌────────────────┐ │
│  │ REST / JSON  │  │ OpenAPI Spec │  │ Clerk JWT   │  │ Auto-gen'd     │ │
│  │ Endpoints    │  │ Generation   │  │ Auth Guard  │  │ TS Client      │ │
│  └──────┬───────┘  └──────────────┘  └─────────────┘  └────────────────┘ │
└─────────┼────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       FRONTEND DASHBOARD (Next.js)                          │
│                                                                             │
│  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌────────┐  ┌─────────────┐│
│  │ Dashboard │  │ Review   │  │ Transac-  │  │ Chat   │  │ Reports     ││
│  │           │  │ Queue    │  │ tions     │  │ (AI)   │  │             ││
│  └───────────┘  └──────────┘  └───────────┘  └────────┘  └─────────────┘│
│                                                                             │
│  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌────────┐                   │
│  │ Receipts  │  │ Events   │  │ Settings  │  │ Ask    │                   │
│  │ + Scanner │  │          │  │ + LLM $   │  │        │                   │
│  └───────────┘  └──────────┘  └───────────┘  └────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Cross-Cutting Concerns

These are not separate layers but touch every layer:

- **Authentication** — Clerk handles all auth. Frontend uses Clerk components. Backend validates Clerk JWTs. Every DB query filters by `user_id`.
- **Encryption** — Bank access tokens encrypted with AES-256-GCM at rest. All HTTP over TLS.
- **Error Handling** — Every external API call (OpenRouter, SimpleFIN, Gmail) wrapped in try/except with structured logging. LLM calls have 30s timeout and return None on failure — never raise to caller.
- **Cost Tracking** — Every LLM call logs model, tokens, cost, latency, and task name to the LLMUsageLog table.
- **Audit Trail** — Every categorization, confirmation, override, and pattern change is logged with timestamp, source (llm/user/system/pattern), and previous value.

---

## 4. Tech Stack and Assembly Strategy

### 4.1 Core Principle

~70% of CashLens can be assembled from existing open-source components. Custom code is only needed for the intelligence pipeline logic (categorization flow, pattern learning, reimbursement matching) and the review queue UX. Everything else — auth, dashboard shell, charts, chat UI, bank sync, LLM client, push notifications — has a production-ready library or template.

### 4.2 Frontend Stack

| Layer | Library / Template | Source | Why This One |
|---|---|---|---|
| Starter shell | Kiranism/next-shadcn-dashboard-starter | GitHub ~5.9K★, MIT | Next.js 16 + shadcn/ui + Tailwind v4 + Clerk + TanStack Table + charts. Strip what you don't need. |
| UI primitives | shadcn/ui | ui.shadcn.com | Card, Badge, Button, Dialog, Command, Sheet, Tabs, DropdownMenu. Copy-paste, full ownership. |
| Review queue blocks | shadcn.io CRUD blocks | shadcn.io/blocks | "Approval Queue Manager", "Status Workflow", "Activity Feed", "Category Tree Manager". Pre-built React components with shadcn primitives. |
| Charts | shadcn Charts (Recharts v3) | Built into shadcn/ui | 53+ chart variants, auto-themed with design tokens in light and dark mode. |
| Dashboard KPIs | Tremor | @tremor/react ~16K★ | KPI cards, sparklines, bar lists, progress trackers. Purpose-built for dashboard data. |
| Chat interface | assistant-ui | @assistant-ui/react ~9.1K★ | Composable chat primitives with native shadcn theme, streaming, tool-call rendering with inline approval. 365K weekly npm downloads. |
| API client | openapi-fetch | npm | Auto-generated typed TypeScript client from FastAPI's OpenAPI spec. Zero manual fetch calls. |
| Data fetching | TanStack React Query v5 | npm | Caching, mutations, optimistic updates, background refetch. |
| PWA / Service worker | Serwist | @serwist/next | Official Next.js-recommended SW toolkit. Push notifications, precaching, offline fallback. |
| Camera capture | react-webcam + native HTML input | npm ~1.7K★ | `getScreenshot()` for base64 JPEG. `facingMode: "environment"` for rear camera. On iOS, supplement with `<input type="file" accept="image/*" capture="environment">`. |
| File upload | react-dropzone | npm | Drag-and-drop for CSV import and receipt upload. |
| Category picker | cmdk (via shadcn Command) | npm ~10K★ | Searchable command palette for category selection. Already integrated into shadcn. |
| Swipe gestures | Framer Motion drag | npm | Drag-to-approve/reject on review cards. Already in the shadcn ecosystem. |
| Auth | Clerk | @clerk/nextjs | `<SignIn/>`, `<UserButton/>`, session management. Free tier: 50K monthly users. |
| Toasts | Sonner | npm | Notification toasts. |
| Theming | next-themes | npm | Dark/light mode toggle. |
| Virtual scroll | react-window | npm | Performance for large transaction lists (1000+ rows). |
| Dates | date-fns v4 | npm | Date formatting and manipulation. |

### 4.3 Backend Stack

| Layer | Library | Source | Why This One |
|---|---|---|---|
| Framework | FastAPI + uvicorn | pip | Async, auto-generates OpenAPI spec, Pydantic validation. |
| Auth middleware | fastapi-clerk-auth | PyPI | JWT validation against Clerk JWKS endpoint. Three-line setup. Extracts user_id from claims. |
| ORM | SQLAlchemy 2.0 async + asyncpg | pip | Async queries, modern `select()` API. No legacy `query()`. |
| Migrations | Alembic | pip | Autogenerate from model changes. |
| Settings | pydantic-settings | pip | Typed env vars with `.env` support and validation. |
| LLM client | LiteLLM | pip ~28K★ | Unified `acompletion()` interface for 100+ providers including OpenRouter. Built-in cost tracking per call, router-level retry/fallback, load balancing. |
| Structured LLM output | Instructor | pip ~11K★, 3M+/month PyPI | Define Pydantic models for LLM responses. Auto-validates against schema, auto-retries on failure. This is the categorization engine's backbone. |
| Bank sync | simplefin4py | PyPI, MIT | Async SimpleFIN client. `sf = SimpleFin(url)` → `await sf.fetch_data()`. Battle-tested via Home Assistant integration. |
| Bank statement import | bankstatementparser + ofxparse | PyPI | CSV, OFX/QFX, CAMT, MT940 auto-detection. Chase, BofA, Amex formats handled. |
| Gmail API | google-api-python-client + google-auth-oauthlib | pip | OAuth flow + Gmail message search and retrieval. |
| Email parsing | mail-parser | pip, Apache 2.0 | RFC-compliant email body/attachment extraction. |
| Receipt OCR | LLM vision via LiteLLM | — | Send receipt image directly to multimodal LLM (Gemini Flash). No Tesseract or traditional OCR. |
| Web push | pywebpush | pip, Apache 2.0 | VAPID auth, RFC 8188 encryption. Supports `webpush_async()`. |
| Image processing | Pillow | pip | Resize receipt photos before sending to LLM vision. |
| Scheduled tasks | APScheduler | pip ~6K★ | `AsyncIOScheduler` in FastAPI's lifespan context. No Redis or RabbitMQ needed for single-user. |
| HTTP client | httpx | pip | Async HTTP for external API calls. |
| Encryption | cryptography | pip | AES-256-GCM for stored bank tokens. |
| File uploads | python-multipart | pip | Multipart form data for receipt image upload. |

### 4.4 Infrastructure Stack

| Layer | Tool | Why |
|---|---|---|
| Containerization | Docker + Docker Compose | Each service in its own container. Dev and prod Compose files. |
| Reverse proxy | Traefik | Auto-HTTPS via Let's Encrypt. Pattern from fastapi/full-stack-fastapi-template. |
| DB backup | prodrigestivill/postgres-backup-local | Docker sidecar. Daily/weekly/monthly rotation with retention policies. Zero config. |
| Frontend deploy | Vercel | Zero-config Next.js hosting. Free tier sufficient. |
| Backend deploy | Railway or Hetzner VPS + Coolify | Railway: single command deploy. Hetzner: $4/mo VPS with Coolify for git-push deploys. |

### 4.5 Reference Implementations

These are not dependencies — they are open-source projects to study and extract patterns from:

| Project | Stars | What to Learn From It |
|---|---|---|
| elie222/inbox-zero | ~9K | AI categorize → user review → learn pattern. Bulk action toolbar. Category badges. Rule confirmation flow. Same UX pattern as CashLens review queue, just for email. |
| vas3k/TaxHacker | — | LLM receipt scanning with multi-model support. Custom AI prompt fields. Item splitting from invoices. Receipt pipeline architecture. |
| actualbudget/actual | ~25K | SimpleFIN integration (the only major OSS app that has it). Transaction rules engine. CSV/OFX/QIF import pipeline. |
| firefly-iii/firefly-iii | ~22.5K | Transaction data model — double-entry, split transactions, multi-currency. REST API design (fully OpenAPI documented). Data importer for CSV column mapping and duplicate detection. |
| maybe-finance/maybe | ~54K | PostgreSQL schema design. Transfer detection between accounts. Demo data seeding. Archived July 2025 but code is reference-quality. |
| Codehagen/Badget | ~2.7K | Next.js + shadcn/ui + Prisma finance dashboard. Transaction lists, spending charts, account cards. Closest open-source analog to CashLens frontend. |
| satnaing/shadcn-admin | ~11.4K | Best sidebar, command palette, page layout patterns for shadcn/ui dashboards. |

### 4.6 Estimated Annual Cost

```
SimpleFIN bank sync:                    $15/year
OpenRouter LLM (with cheap routing):    ~$3.50/year
Hetzner VPS (or Railway free tier):     $0-48/year
Domain:                                 ~$12/year
Clerk (free tier, 50K users):           $0/year
Vercel (free tier):                     $0/year
────────────────────────────────────────
Total:                                  $30-78/year (vs Monarch $99)
```

---

## 5. External Data Sources

### 5.1 Bank Transactions (Primary Source)

Bank transactions are the backbone of CashLens. The system uses a **pluggable provider abstraction** so that no single bank connection service is hardcoded.

#### 5.1.1 SimpleFIN (Recommended Primary)

- **What it is:** A simple REST API that acts as a middleman between your app and 16,000+ banks (via MX, the same infrastructure Mint used). You sign up, connect your banks through SimpleFIN's UI, and get an API token.
- **Cost:** $15/year.
- **API type:** REST. Dead simple — one endpoint returns all accounts and transactions.
- **Python client:** `simplefin4py` (PyPI, MIT). Async-native. `sf = SimpleFin(access_url)` → `data = await sf.fetch_data()`.
- **Data returned per transaction:** External ID, amount, description, date, posted date, pending status.
- **Key consideration:** SimpleFIN is the only bank provider with a realistic cost structure for a personal self-hosted app. Plaid charges $5-20/month. SimpleFIN charges $15/year.
- **Reference implementation:** Actual Budget's SimpleFIN integration is the most mature open-source reference for the claim/sync flow.

#### 5.1.2 CSV / OFX / QFX Import (Universal Fallback)

- **What it is:** Manual upload of bank statement files downloaded from your bank's website.
- **Cost:** Free.
- **Formats supported:** CSV (bank-specific: Chase, BofA, Amex, Capital One, generic), OFX/QFX (standard format most banks export), CAMT XML, MT940.
- **Python libraries:** `bankstatementparser` (auto-detects format), `ofxparse` (OFX-specific), `csv2ofx` (converts bank-specific CSVs to standard OFX).
- **LLM-assisted format detection:** For unrecognized CSV formats, send the first 5 rows to the LLM and ask it to identify which columns are date, amount, description, etc.

#### 5.1.3 Teller (Optional, Free but Limited)

- **What it is:** A service that reverse-engineers bank mobile apps to pull transaction data. Great data quality including structured `type` fields ("atm", "card_payment", "transfer", "fee", "interest").
- **Cost:** Free for personal use.
- **Coverage:** Varies — may not support your specific bank.
- **Key advantage:** Returns structured metadata (`type`, `category`) that SimpleFIN doesn't provide. This structured data enables pre-LLM categorization (e.g., `type == "atm"` → Cash category without calling the LLM).

#### 5.1.4 Plaid (Expensive, Broadest Coverage)

- **What it is:** The industry standard bank connection API. 12,000+ banks.
- **Cost:** $5-20/month — priced for companies, not individuals.
- **When to use:** Only if SimpleFIN doesn't support a bank you need and you're willing to pay.

### 5.2 Bank Provider Abstraction

All bank providers implement a common protocol. The sync code is provider-agnostic:

```python
class BankTransaction:
    external_id: str
    amount: Decimal           # negative = debit
    description: str
    date: datetime
    posted_date: datetime | None
    type: str | None          # "atm", "card_payment", "transfer" (if provider gives this)
    category: str | None      # provider's category hint (if available)
    pending: bool

class BankAccount:
    external_id: str
    institution_name: str
    account_name: str
    account_type: str         # "checking", "credit_card", "savings"
    mask: str | None          # last 4 digits
    balance_cents: int | None

class BankProvider(Protocol):
    async def list_accounts(self) -> list[BankAccount]: ...
    async def get_balance(self, account_id: str) -> int: ...
    async def list_transactions(
        self, account_id: str, since: datetime | None = None
    ) -> list[BankTransaction]: ...
```

Implementations: `SimpleFINProvider`, `TellerProvider`, `CSVProvider`, `PlaidProvider`.

### 5.3 Email Receipts (Gmail)

- **What it is:** Gmail API integration that searches your inbox for receipt emails, extracts structured data (merchant, items, total, order number), and matches to bank transactions.
- **Authentication:** Gmail OAuth 2.0 (guided setup script walks the user through Google Cloud Console).
- **Search strategy:** Broad keyword filter — `subject:(receipt OR order OR confirmation OR invoice OR payment)` — rather than a hardcoded list of merchant email addresses. The LLM then determines if each email is actually a receipt (`isReceipt: boolean`). False positives are cheap (LLM says "not a receipt," skip it). False negatives (missing real receipts) are expensive. So err broad.
- **Polling frequency:** Every 15 minutes via APScheduler.

### 5.4 Camera Receipt Scan

- **What it is:** User takes a photo of a physical receipt on their phone. The image is sent to a multimodal LLM (Gemini Flash via LiteLLM) which extracts merchant, line items, totals, tax, and tip.
- **Frontend:** `react-webcam` with `facingMode: "environment"` for rear camera, or native `<input type="file" accept="image/*" capture="environment">` which opens the device camera app (more reliable on iOS).
- **Backend:** Pillow resizes the image to reduce token cost, then sends to LLM vision model (mid tier) via Instructor with a `ReceiptData` Pydantic model for validated structured output.

---

## 6. Data Ingestion Layer

### 6.1 Purpose

The ingestion layer pulls data from all external sources, normalizes it, deduplicates it, and writes it into PostgreSQL. It then triggers the intelligence pipeline to categorize, detect duplicates, and match receipts.

### 6.2 Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Scheduler (APScheduler)                      │
│              In FastAPI lifespan context                  │
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Cron Jobs:                                       │   │
│  │    Bank sync:    every 6 hours                    │   │
│  │    Email scrape: every 15 minutes                 │   │
│  │    Process queue: every 30 minutes                │   │
│  └──────────────────┬───────────────────────────────┘   │
└─────────────────────┼───────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Bank Sync   │ │  Email       │ │  Manual /    │
│  Service     │ │  Scraper     │ │  CSV Import  │
│              │ │              │ │              │
│  SimpleFIN → │ │  Gmail API → │ │  Upload →    │
│  normalize → │ │  LLM parse → │ │  detect fmt →│
│  dedup →     │ │  match txn → │ │  parse →     │
│  insert      │ │  create      │ │  insert      │
│              │ │  receipt      │ │              │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       ▼                ▼                ▼
┌─────────────────────────────────────────────────┐
│          Intelligence Pipeline Trigger            │
│                                                   │
│  For each new/updated transaction batch:          │
│    1. Pre-categorize (structured metadata)        │
│    2. LLM batch categorize (everything else)      │
│    3. Post-categorize (catch edge cases)          │
│    4. Check duplicates across accounts            │
│    5. Match reimbursements (incoming credits)     │
│    6. Match merchant refunds (merchant credits)   │
│    7. Match receipts (email/camera ↔ transactions)│
│    8. Detect recurring patterns                   │
│    9. Suggest events (spending clusters)          │
│   10. Create review items for uncertain decisions │
└─────────────────────────────────────────────────┘
```

### 6.3 Bank Sync Flow

```python
async def sync_account(account: Account) -> SyncResult:
    # 1. Get the right provider
    provider = get_provider_for_account(account)
    
    # 2. Pull data (provider-agnostic from here)
    balance = await provider.get_balance(account.external_id)
    transactions = await provider.list_transactions(
        account.external_id, since=account.last_sync_at
    )
    
    # 3. Update balance
    account.balance_cents = balance
    
    # 4. Insert new transactions (skip existing by external_id)
    new_txns = []
    for txn in transactions:
        existing = await find_by_external_id(txn.external_id)
        if not existing:
            db_txn = Transaction(
                user_id=account.user_id,
                external_id=txn.external_id,
                account_id=account.id,
                amount_cents=int(txn.amount * 100),
                description=txn.description,
                date=txn.date,
                provider_type=txn.type,        # "atm", "card_payment", etc.
                provider_category=txn.category,
                source="bank",
                status="pending_review",
            )
            new_txns.append(db_txn)
    
    # 5. Trigger intelligence pipeline
    await run_intelligence_pipeline(new_txns)
    
    # 6. Update sync timestamp
    account.last_sync_at = utcnow()
    
    return SyncResult(new=len(new_txns), balance=balance)
```

### 6.4 Email Receipt Ingestion Flow

```python
async def scrape_receipts(user_id: str):
    # 1. Broad Gmail search (no hardcoded merchant list)
    query = (
        "subject:(receipt OR order OR confirmation OR invoice OR payment) "
        f"after:{last_scrape.strftime('%Y/%m/%d')}"
    )
    emails = await gmail.messages().list(q=query).execute()
    
    # 2. Skip already-processed emails
    emails = [e for e in emails if not await is_processed(e.id)]
    
    # 3. For each email, LLM determines if it's a receipt
    for email in emails:
        body = await gmail.messages().get(id=email.id).execute()
        html = extract_html_body(body)
        
        result = await call_llm(
            messages=[{"role": "user", "content": EXTRACT_EMAIL_RECEIPT_PROMPT + html}],
            tier="cheap",
            task="email_parse",
            response_model=EmailReceiptResult,  # Instructor Pydantic model
        )
        
        if result and result.is_receipt:
            receipt = Receipt(
                user_id=user_id,
                source="email",
                merchant_name=result.merchant_name,
                total_cents=result.total_cents,
                order_number=result.order_number,
                # ... all extracted fields
            )
            await match_receipt_to_transaction(receipt)
        
        await mark_processed(email.id, was_receipt=result.is_receipt if result else False)
```

### 6.5 Error Handling and Resilience

- **Retry with backoff:** If SimpleFIN or Gmail returns a transient error (network, rate limit), retry 3 times with exponential backoff (1s, 2s, 4s). Most transient errors resolve within a few retries.
- **Graceful degradation:** If a bank sync fails, skip that account and continue with others. Log the error. Try again next cycle. Never crash the entire sync because one account has issues.
- **LLM timeout:** Every LLM call has a 30-second timeout. If it times out, the function returns `None` and the transaction stays in `pending_review` — it doesn't disappear.
- **Deduplication:** Transactions are deduped by `external_id` (from the bank provider). Manual entries have no `external_id` and skip dedup.
- **Idempotent sync:** Running bank sync twice produces the same result. The second run finds all transactions already exist by `external_id` and skips them.

---

## 7. Data Storage Layer

### 7.1 Overview

CashLens uses a single PostgreSQL database. For a personal finance app processing hundreds (not millions) of transactions per month, PostgreSQL handles everything — no need for Redis, TimescaleDB, or object storage in the initial build.

### 7.2 PostgreSQL Schema

18 tables total. All user data scoped by `user_id` (Clerk user ID). Amounts in cents (integer). Timestamps UTC. IDs are UUIDs as text.

```python
# ─── Accounts ───

class Account(Base):
    __tablename__ = "accounts"
    id: str                          # UUID
    user_id: str                     # Clerk user ID — SCOPING KEY
    provider: str                    # "simplefin", "teller", "csv", "plaid"
    provider_account_id: str         # External ID from provider
    institution_name: str            # "Chase"
    account_name: str                # "Sapphire Preferred"
    account_type: str                # "checking", "credit_card", "savings", "payment"
    mask: str | None                 # "4242"
    balance_cents: int | None
    access_token_encrypted: str | None  # AES-256-GCM encrypted
    is_active: bool = True
    last_sync_at: datetime | None
    created_at: datetime

# ─── Categories ───

class Category(Base):
    __tablename__ = "categories"
    id: str
    user_id: str
    name: str                        # unique per user
    parent_id: str | None            # subcategories
    icon: str | None                 # lucide icon name
    color: str | None                # hex
    is_system: bool = False          # prevent deletion of "Cash", "Transfers", etc.
    is_income: bool = False
    sort_order: int = 0

# ─── Transactions (the core table) ───

class Transaction(Base):
    __tablename__ = "transactions"
    id: str
    user_id: str
    external_id: str | None          # Provider's transaction ID
    account_id: str | None           # FK → Account (null for manual entries)
    source: str = "bank"             # "bank", "manual", "import"
    amount_cents: int                # negative = debit, positive = credit
    description: str                 # raw bank description
    clean_description: str | None    # LLM-cleaned merchant name
    merchant_name: str | None        # normalized by LLM
    category_id: str | None          # FK → Category
    type: str                        # "debit", "credit", "transfer"
    status: str                      # "pending_review", "categorized", "hidden", "split"
    date: datetime
    posted_date: datetime | None
    # Provider metadata (from Teller, if available)
    provider_type: str | None        # "card_payment", "atm", "ach", "transfer", "fee", "interest"
    provider_category: str | None
    # LLM classification results (populated during batch categorization)
    is_p2p_platform: bool = False    # Venmo, Zelle, CashApp, PayPal
    platform_name: str | None        # "Venmo"
    counterparty_name: str | None    # "John Smith" — extracted by LLM
    is_merchant_refund: bool = False
    original_merchant_name: str | None  # for refunds: merchant issuing refund
    # Reimbursement / refund tracking
    net_amount_cents: int | None     # after reimbursements/refunds
    reimbursement_group_id: str | None
    # Deduplication
    duplicate_of_id: str | None      # FK → Transaction (self-ref)
    dedupe_fingerprint: str | None
    # Receipt
    receipt_id: str | None           # FK → Receipt
    # Metadata
    notes: str | None
    tags: list[str] = []
    llm_confidence: float | None     # 0.0-1.0
    user_confirmed_at: datetime | None
    created_at: datetime

# ─── Transaction Splits ───

class TransactionSplit(Base):
    __tablename__ = "transaction_splits"
    id: str
    parent_transaction_id: str       # FK → Transaction
    category_id: str                 # FK → Category
    amount_cents: int
    description: str | None          # e.g., line item name from receipt

# ─── Receipts ───

class Receipt(Base):
    __tablename__ = "receipts"
    id: str
    user_id: str
    source: str                      # "camera", "email", "manual"
    source_email_id: str | None      # Gmail message ID
    image_path: str | None
    merchant_name: str | None
    receipt_date: datetime | None
    subtotal_cents: int | None
    tax_cents: int | None
    tip_cents: int | None
    total_cents: int | None
    order_number: str | None         # KEY for refund matching
    payment_method: str | None       # "Visa ending 4242"
    raw_llm_output: dict | None
    matched_transaction_id: str | None
    match_confidence: float | None
    is_processed: bool = False

class ReceiptLineItem(Base):
    __tablename__ = "receipt_line_items"
    id: str
    receipt_id: str                  # FK → Receipt
    name: str                        # "Organic Milk 1gal"
    quantity: float = 1
    unit_price_cents: int | None
    total_price_cents: int
    category_id: str | None          # FK → Category (suggested)

# ─── Events ───

class Event(Base):
    __tablename__ = "events"
    id: str
    user_id: str
    name: str                        # "Date — April 3", "Scooter tire blowout"
    emoji: str | None
    start_date: datetime
    end_date: datetime | None
    notes: str | None
    total_cost_cents: int | None     # computed
    is_active: bool = True

class TransactionEvent(Base):
    __tablename__ = "transaction_events"
    id: str
    transaction_id: str              # FK → Transaction
    event_id: str                    # FK → Event
    line_item_ids: list[str] | None  # specific receipt line items (null = whole txn)
    attributed_amount_cents: int | None  # null = full transaction amount

# ─── Learning / Pattern Tables ───

class MerchantCategoryCache(Base):
    """LLM-learned: merchant name → category. Keyed on LLM-cleaned name, not raw description."""
    __tablename__ = "merchant_category_cache"
    id: str
    user_id: str
    merchant_name: str               # LLM-cleaned, e.g. "Blue Bottle Coffee" (not "SQ *BLUE BOTTLE COF")
    category_id: str                 # FK → Category
    confidence: float = 1.0          # decays on user override
    hit_count: int = 1
    source: str                      # "llm", "user", "rule"

class PersonPaymentPattern(Base):
    """Learning for P2P: person + amount + timing → category."""
    __tablename__ = "person_payment_patterns"
    id: str
    user_id: str
    person_name: str                 # "Alex" — extracted from Venmo/Zelle by LLM
    platform: str                    # "venmo", "zelle", "cashapp"
    direction: str                   # "outgoing" or "incoming"
    category_id: str                 # FK → Category
    typical_amount_low: int | None   # cents
    typical_amount_high: int | None  # cents
    typical_day_of_month: int | None # 1-31
    times_confirmed: int = 0         # auto-apply after >= 2
    is_active: bool = True
    notes: str | None                # "rent to Alex"

class RecurringSplitPattern(Base):
    """Auto-detect: pay bill → get reimbursed by roommate."""
    __tablename__ = "recurring_split_patterns"
    id: str
    user_id: str
    name: str | None                 # "Electric split with Mike"
    expense_merchant_pattern: str    # "EVERSOURCE" (LLM-cleaned)
    reimbursement_platform: str      # "venmo"
    reimbursement_person: str        # "Mike"
    split_ratio: float               # 0.5 = half
    amount_tolerance: float = 0.2    # allow 20% variance
    max_days_gap: int = 10
    times_confirmed: int = 0
    is_active: bool = True

# ─── Review Queue ───

class ReviewQueue(Base):
    __tablename__ = "review_queue"
    id: str
    user_id: str
    type: str                        # "categorization", "duplicate", "reimbursement",
                                     # "receipt_match", "split", "merchant_refund",
                                     # "venmo_unknown", "event_suggestion",
                                     # "cash_allocation", "pattern_confirm"
    transaction_id: str | None
    receipt_id: str | None
    related_transaction_id: str | None
    suggestion: dict | None          # LLM's recommendation
    confidence: float | None
    is_resolved: bool = False
    resolved_action: str | None      # "accept", "reject", "modify"
    created_at: datetime
    resolved_at: datetime | None

# ─── Chat ───

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: str
    user_id: str
    context_type: str                # "transaction", "receipt", "event", "general"
    context_id: str | None
    role: str                        # "user", "assistant"
    content: str
    actions: list[dict] | None       # actions the LLM executed

# ─── Email Tracking ───

class ProcessedEmail(Base):
    __tablename__ = "processed_emails"
    id: str
    user_id: str
    gmail_message_id: str            # unique per user
    from_address: str | None
    subject: str | None
    was_receipt: bool = False
    receipt_id: str | None

# ─── Push Notifications ───

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: str
    user_id: str
    endpoint: str
    p256dh: str
    auth: str

# ─── LLM Cost Tracking ───

class LLMUsageLog(Base):
    __tablename__ = "llm_usage_log"
    id: str
    user_id: str
    model: str                       # "google/gemini-2.5-flash-lite"
    tier: str                        # "cheap", "mid", "smart"
    task: str                        # "categorize", "ocr", "chat", "email_parse", etc.
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    input_cost_cents: float          # fractional cents
    output_cost_cents: float
    total_cost_cents: float
    latency_ms: int
    success: bool
    error_message: str | None
    created_at: datetime

# ─── Audit Log ───

class AuditLog(Base):
    __tablename__ = "audit_log"
    id: str
    user_id: str
    action: str                      # "categorize", "dedupe", "reimburse", "refund", etc.
    entity_type: str
    entity_id: str
    previous_value: dict | None
    new_value: dict | None
    source: str                      # "llm", "user", "system", "pattern"
    created_at: datetime
```

### 7.3 Key Schema Design Decisions

**Money as cents (integer).** `-4732` = spent $47.32. `+3000` = received $30.00. Conversion to dollars happens in Pydantic schemas or frontend only. Never store money as float.

**user_id everywhere.** Every table that stores user data has a `user_id` column. Every query filters by it. Even for single-user deployments, this is the right architecture — it future-proofs for multi-user and matches how Clerk works.

**LLM results stored on Transaction.** The `is_p2p_platform`, `platform_name`, `counterparty_name`, `is_merchant_refund`, and `original_merchant_name` fields are populated during the single LLM batch categorization call. This eliminates separate regex passes — one LLM call produces clean merchant name, category, P2P detection, counterparty extraction, and refund detection simultaneously.

**MerchantCategoryCache keys on LLM-cleaned name.** Not raw description, not regex pattern. If the LLM cleans "SQ *BLUE BOTTLE COF" and "SQ *BLUE BOTTLE COFFEE SF" both to "Blue Bottle Coffee", they hit the same cache entry.

**PersonPaymentPattern learns from confirmations.** After `times_confirmed >= 2`, the pattern is auto-applied (but still shown in review with a "learned" badge and a "Not this time" button).

### 7.4 Backup Strategy

- **PostgreSQL:** Automated daily backups via `prodrigestivill/postgres-backup-local` Docker sidecar. Retains 7 daily, 4 weekly, 12 monthly backups.
- **Receipt images:** Stored on local filesystem (mounted Docker volume). Backed up with the regular system backup.

---

## 8. Intelligence Engine

### 8.1 Overview

The intelligence engine is the brain of CashLens. It takes raw bank transactions and produces categorized, deduplicated, reimbursement-matched, receipt-linked results — or routes uncertain decisions to the review queue for human confirmation.

**The cardinal rule: no regex, no keyword lists, no hardcoded string matching.** The LLM handles all fuzzy text interpretation. This is literally what LLMs are for.

### 8.2 LLM Client Architecture

```python
# app/services/llm_client.py

import litellm
import instructor

# Instructor wraps LiteLLM for Pydantic-validated structured output
client = instructor.from_litellm(litellm.acompletion)

# Model tier configuration
MODEL_TIERS = {
    "cheap": "openrouter/google/gemini-2.5-flash-lite",   # $0.10/$0.40 per M tokens
    "mid":   "openrouter/google/gemini-2.5-flash",        # $0.30/$2.50 per M tokens
    "smart": "openrouter/anthropic/claude-haiku-4.5",     # $1.00/$5.00 per M tokens
}

# Task → tier mapping
TASK_TIERS = {
    "categorize":         "cheap",   # batch classification, highest volume
    "clean_descriptions": "cheap",   # merchant name cleanup
    "email_parse":        "cheap",   # structured extraction from HTML
    "refund_detect":      "cheap",   # pattern matching
    "ocr":                "mid",     # needs vision model for images
    "reimbursement":      "mid",     # moderate reasoning about amounts/dates
    "dedup":              "mid",     # cross-referencing multiple transactions
    "event_suggest":      "mid",     # pattern detection across many transactions
    "chat":               "smart",   # user-facing, needs quality responses
    "nl_query":           "smart",   # natural language → SQL generation
}

async def call_llm(
    messages: list[dict],
    tier: Literal["cheap", "mid", "smart"] = "cheap",
    task: str = "unknown",
    response_model: type[BaseModel] | None = None,
    timeout: int = 30,
    max_tokens: int = 2000,
) -> BaseModel | str | None:
    model = MODEL_TIERS[tier]
    start = time.monotonic()
    
    try:
        if response_model:
            # Instructor: validated structured output with auto-retry
            result = await client.chat.completions.create(
                model=model,
                messages=messages,
                response_model=response_model,
                max_tokens=max_tokens,
                timeout=timeout,
            )
        else:
            # Plain text response
            result = await litellm.acompletion(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                timeout=timeout,
            )
        
        elapsed_ms = int((time.monotonic() - start) * 1000)
        
        # Log usage (LiteLLM provides cost tracking)
        await log_llm_usage(model, tier, task, result, elapsed_ms, success=True)
        
        return result
    
    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        await log_llm_usage(model, tier, task, None, elapsed_ms, success=False, error=str(e))
        return None  # NEVER raise to caller
```

### 8.3 LLM Cost Tracking

Every LLM call is logged to the `LLMUsageLog` table with model, tier, task, tokens, cost, latency, and success/failure. This powers the Settings → LLM Usage dashboard.

```python
MODEL_PRICING = {
    "google/gemini-2.5-flash-lite": {"input": 0.10, "output": 0.40},   # per million tokens
    "google/gemini-2.5-flash":     {"input": 0.30, "output": 2.50},
    "anthropic/claude-haiku-4.5":  {"input": 1.00, "output": 5.00},
}

# Estimated monthly cost at 100 transactions/month:
# Categorize:    ~$0.01  (cheap model, batch)
# Email parse:   ~$0.03  (cheap model, 50 receipts)
# Receipt OCR:   ~$0.02  (mid model, 10 scans)
# Reimbursement: ~$0.01  (mid model, 20 checks)
# Chat:          ~$0.21  (smart model, 30 messages)
# ─────────────────────
# Monthly total: ~$0.28
# Annual total:  ~$3.36
```

### 8.4 Categorization Pipeline

The categorization pipeline is the most important intelligence flow. It runs for every batch of new transactions after bank sync.

```
Transaction arrives from bank sync
│
├─► PRE-CATEGORIZE (structured metadata, no LLM)
│   ├─ provider_type == "atm"?       → Cash + cash_allocation review. DONE.
│   ├─ provider_type == "transfer"?  → mark as transfer. DONE.
│   ├─ provider_type == "fee"?       → auto-categorize as Fees. DONE.
│   ├─ provider_type == "interest"?  → auto-categorize as Interest. DONE.
│   └─ anything else?               → continue to LLM batch
│
├─► MERCHANT CACHE LOOKUP
│   ├─ merchant_name in MerchantCategoryCache?
│   │   ├─ confidence >= 0.8?  → auto-apply, show in review as "learned". DONE.
│   │   └─ confidence < 0.8?   → include in LLM batch for re-evaluation.
│   └─ not in cache?            → include in LLM batch.
│
├─► P2P PATTERN LOOKUP (for Venmo/Zelle/CashApp transactions)
│   ├─ PersonPaymentPattern match with times_confirmed >= 2?
│   │   → auto-apply, show in review with "learned" badge. DONE.
│   ├─ PersonPaymentPattern match with times_confirmed == 1?
│   │   → suggest but require confirmation.
│   └─ no pattern?
│       → if incoming credit, try reimbursement match.
│       → if no match, create "venmo_unknown" review item with quick-picks.
│
├─► LLM BATCH CATEGORIZATION (for everything not yet resolved)
│   │
│   │  Send up to 50 transactions in one LLM call.
│   │  The prompt asks for ALL of these fields per transaction:
│   │
│   │  {
│   │    "id": "txn_123",
│   │    "categoryId": "cat_dining",
│   │    "merchantName": "Blue Bottle Coffee",      ← LLM-cleaned name
│   │    "confidence": 0.92,
│   │    "is_p2p_platform": false,                   ← replaces regex keyword check
│   │    "platform_name": null,
│   │    "counterparty_name": null,                   ← replaces regex name extraction
│   │    "is_merchant_refund": false,                 ← replaces regex refund detection
│   │    "original_merchant_name": null               ← replaces regex prefix stripping
│   │  }
│   │
│   │  One LLM call produces: clean merchant name, category,
│   │  P2P detection, counterparty extraction, refund detection.
│   │  No separate regex passes needed.
│   │
│
├─► POST-CATEGORIZE (catch edge cases the pre-categorize missed)
│   ├─ LLM returned category "Cash"?  → create cash_allocation review item.
│   ├─ LLM returned is_p2p_platform?  → route to P2P handling.
│   ├─ LLM returned is_merchant_refund? → route to refund matching.
│   └─ Normal category? → apply. If confidence < 0.7, create review item.
│
└─► UPDATE CACHE
    └─ Update MerchantCategoryCache with LLM's merchant_name → category_id mapping.
```

### 8.5 The Venmo Problem

This is the hardest problem in the app. The system CANNOT auto-categorize "haha thanks bro 🍕" or "april fool lol". Instead, it uses person + amount + timing patterns and gracefully asks when it can't determine purpose.

**What the user sees in the review queue:**

Known pattern (auto-applied):
```
Venmo to Alex — -$1,200 · Apr 1 · memo: "april fool lol"
Auto-matched: Rent (paid 5x before to Alex ~$1,200)
[✓ Rent]  [Not this time]
```

Known person, unknown amount:
```
Venmo to Mike — -$15.00 · Apr 4 · memo: "🤪"
You usually pay Mike for Utilities (~$30). This amount is different.
[Shopping]  [Gift]  [Utilities]  [Other...]  [Chat]
```

Complete unknown:
```
Venmo from Mike — +$30.00 · Apr 3 · memo: "haha thanks bro"
Can't determine purpose. What was this for?
[Electric split]  [Belt reimbursement]  [Other...]  [Chat]
```

### 8.6 Smart Merchant Refund Matching

The key insight: email receipts have order numbers that bank statements don't. Use email data to disambiguate which purchase a refund is for.

```
Credit arrives (positive amount, merchant name detected by LLM)
│
├─► LLM flagged is_merchant_refund = true?
│   │
│   ├─► Check email receipts for matching order number
│   │   └─ Found? → match with 95% confidence via order_number. DONE.
│   │
│   ├─► Find candidate debits: same merchant, older, within 120 days
│   │   ├─ Exactly 1 match with exact amount? → match at 85% confidence. DONE.
│   │   ├─ Multiple candidates? → send to review with all options.
│   │   └─ No candidates? → send to review.
│   │
│   └─► Partial refund? → send to review.
│
└─► LLM flagged is_p2p_platform = true?
    └─► Route to reimbursement matching instead.
```

### 8.7 Cross-Account Deduplication

The same money movement often appears on two accounts. Example: you pay rent via Venmo — "-$1,200 VENMO PAYMENT" on your Chase checking AND the corresponding entry on your Venmo account.

Detection signals (no hardcoded platform keywords):
1. **Account-based:** If the transaction comes from an account that IS a P2P platform (Venmo account connected via Teller), it's a P2P transaction by definition — check `account.account_type == "payment"`.
2. **LLM-based:** The `is_p2p_platform` field from LLM categorization identifies bank-side entries referencing P2P platforms.

Matching: same absolute amount, within ±5 days, one from a P2P account and one from a bank account → likely duplicate. Send to review with "Hide duplicate" / "Keep both" actions.

### 8.8 Contextual Chat

The chat interface (powered by assistant-ui on the frontend, smart-tier LLM on the backend) lets the user ask questions about their finances:

- **Transaction context:** "What was this Venmo to Mike for?" → cross-references transaction history with Mike.
- **Reporting queries:** "How much did I spend on dining this month?" → generates SQL query, executes safely, returns formatted answer.
- **Action execution:** Chat can execute actions — recategorize transactions, create events, mark duplicates.

The chat uses the smart tier (Claude Haiku 4.5) because it's user-facing and needs quality responses. It's also the lowest volume task (only when you tap "Chat"), so the cost is manageable.

---

## 9. API Layer

### 9.1 Overview

The API layer is the contract between the FastAPI backend and the Next.js frontend. It auto-generates an OpenAPI spec that produces a typed TypeScript client for the frontend — zero manual fetch calls.

### 9.2 Technology

- **Framework:** FastAPI (Python). Auto-generates OpenAPI spec. Pydantic for all request/response validation.
- **Auth:** Every endpoint is protected by Clerk JWT validation via `fastapi-clerk-auth`. The `user_id` is extracted from JWT claims and used to scope all data access.
- **Client generation:** `openapi-typescript` generates typed TypeScript types, `openapi-fetch` consumes them.

### 9.3 Core Endpoints

```
# ─── Auth (handled by Clerk, but we need these) ───
GET  /api/auth/gmail              → redirect to Google OAuth
GET  /api/auth/gmail/callback     → store tokens, redirect to /settings

# ─── Accounts ───
GET    /api/accounts              → list all with balances
POST   /api/accounts/sync         → trigger sync for all accounts
POST   /api/accounts/sync/{id}    → trigger sync for one account
DELETE /api/accounts/{id}         → deactivate
POST   /api/accounts/simplefin/setup → store SimpleFIN access URL
POST   /api/accounts/csv/upload   → upload CSV/OFX file for import
POST   /api/accounts/csv/preview  → preview parsed transactions before import
POST   /api/accounts/csv/confirm  → confirm and import previewed transactions

# ─── Transactions ───
GET    /api/transactions          → paginated list with filters
                                    Query: date_start, date_end, category_id, account_id,
                                    amount_min, amount_max, type, status, search, page, per_page
GET    /api/transactions/{id}     → full detail with receipt, splits, events, audit log
POST   /api/transactions/manual   → create manual entry
                                    Body: { amount_cents, category_id, date, merchant_name?, notes? }
PATCH  /api/transactions/{id}/category    → update category + update cache
POST   /api/transactions/{id}/split       → split into multiple categories
                                    Body: { splits: [{category_id, amount_cents, description?}] }
POST   /api/transactions/{id}/hide        → hide (with reason)
POST   /api/transactions/{id}/unhide
POST   /api/transactions/bulk-categorize  → bulk update
                                    Body: { ids: [], category_id }
GET    /api/transactions/cash-flow → income, expenses, net for date range

# ─── Categories ───
GET    /api/categories            → list all (for current user)
POST   /api/categories            → create
PATCH  /api/categories/{id}       → update
DELETE /api/categories/{id}       → delete (reassign transactions first)
POST   /api/categories/merge      → merge source into target

# ─── Receipts ───
GET    /api/receipts              → paginated, filter by matched/unmatched
GET    /api/receipts/{id}         → full with line items
POST   /api/receipts/upload       → upload image → OCR → match
                                    Body: multipart { image }
POST   /api/receipts/{id}/retry-match → retry matching to transactions
DELETE /api/receipts/{id}

# ─── Events ───
GET    /api/events                → paginated
POST   /api/events                → create
GET    /api/events/{id}           → full with transactions, cost breakdown
POST   /api/events/{id}/add-transactions
DELETE /api/events/{id}/transactions/{txn_id}
GET    /api/events/{id}/suggest-transactions → candidates from date range
POST   /api/events/suggest        → LLM suggests events from recent activity
DELETE /api/events/{id}

# ─── Intelligence ───
POST   /api/intelligence/categorize       → categorize pending transactions
POST   /api/intelligence/check-duplicates → check for cross-account dupes
POST   /api/intelligence/match-reimbursement → match a credit to an expense

# ─── Review Queue ───
GET    /api/review                → paginated, filter by type
                                    Query: type, is_resolved, page, per_page
POST   /api/review/{id}/resolve   → resolve a review item
                                    Body: { action: "accept"|"reject"|"modify", modification? }
POST   /api/review/batch-accept   → accept all listed items
                                    Body: { ids: [] }

# ─── Chat ───
POST   /api/chat/message          → send message, get reply
                                    Body: { context_type, context_id?, message }
                                    Response: { reply, actions?, suggestions? }
GET    /api/chat/history          → get chat history for a context

# ─── Email ───
GET    /api/email/status          → last scrape time, connection status
POST   /api/email/scrape          → trigger manual scrape
POST   /api/email/disconnect      → revoke Gmail tokens

# ─── Reports ───
GET    /api/reports/spending-by-category  → { start_date, end_date }
GET    /api/reports/spending-by-merchant  → { start_date, end_date, limit? }
GET    /api/reports/monthly-trend         → { months? }
GET    /api/reports/complete-breakdown    → "where every dollar went"
  Response:
  {
    income: { total_cents, by_category: [...] },
    expenses: {
      total_gross_cents,              # before reimbursements/refunds
      total_net_cents,                # after reimbursements/refunds
      by_category: [...],
      events: [{ name, emoji, total_cents }]
    },
    reimbursements_received_cents,
    refunds_received_cents,
    transfers_excluded_cents,
    duplicates_hidden: 3,
    unallocated_cents: 0,             # THE KEY NUMBER — drive toward $0
    unallocated_count: 0,
    net_savings_cents
  }

# ─── Settings ───
GET    /api/settings
PATCH  /api/settings
GET    /api/settings/patterns     → PersonPaymentPatterns + RecurringSplitPatterns
PATCH  /api/settings/patterns/{id} → edit/deactivate a learned pattern
GET    /api/settings/llm-usage    → LLM cost tracking dashboard data
                                    Query: period ("day"|"week"|"month"|"year"|"all")
  Response:
  {
    period, total_cost_cents, total_calls, total_tokens, avg_latency_ms, error_rate,
    by_task: [{ task, calls, cost_cents, tokens }],
    by_model: [{ model, calls, cost_cents }],
    by_day: [{ date, cost_cents, calls }],
    projected_monthly_cents, projected_annual_dollars
  }
POST   /api/settings/export       → JSON data dump
POST   /api/settings/push/register → register push subscription
POST   /api/settings/push/test    → send test notification

# ─── Cron (protected by CRON_SECRET header, for external cron if needed) ───
POST   /api/cron/sync-bank
POST   /api/cron/scrape-email
POST   /api/cron/process-queue

# ─── Webhooks ───
POST   /api/webhooks/teller       → Teller webhook receiver (if using Teller)
POST   /api/webhooks/clerk        → Clerk webhook (user created/deleted)
```

### 9.4 Error Response Format

Consistent across all endpoints:

```json
{
  "error": {
    "code": "SPLIT_AMOUNTS_MISMATCH",
    "message": "Split amounts must sum to the transaction amount.",
    "details": {
      "transaction_amount_cents": 4732,
      "splits_sum_cents": 4500
    },
    "request_id": "req-uuid"
  }
}
```

---

## 10. Frontend Dashboard

### 10.1 Starter Template

Bootstrap from **Kiranism/next-shadcn-dashboard-starter** (5.9K stars, MIT). It ships with Next.js 16, React 19, shadcn/ui, Tailwind v4, Clerk auth, TanStack Tables, charts, a collapsible sidebar, and 6+ themes. Replace Clerk configuration with your Clerk project keys and strip features you don't need (Kanban board, etc.).

### 10.2 Key Screens

#### 10.2.1 Dashboard (/)

The first thing you see after login. At a glance:

- **Net cash flow this month:** Big number + trend delta vs. last month.
- **Account balance cards:** Each connected account with name, balance, type icon, last sync time.
- **Spending by category:** Donut chart (shadcn Charts) + top 5 merchants bar list (Tremor BarList).
- **Monthly income vs. expenses:** 6-month area chart (shadcn Charts AreaChart).
- **Unallocated banner:** If `unallocated_cents > 0`, yellow banner: "$X unallocated across N transactions. [Review now →]". If $0: green checkmark "Every dollar accounted for ✓".
- **Pending review count:** Badge linking to /review. "5 items need your attention."
- **Floating "Ask CashLens" button:** Opens chat panel (assistant-ui).

#### 10.2.2 Review Queue (/review) — THE KEY SCREEN

This is where robustness lives. Every uncertain AI decision surfaces here. The UI must be fast to use on mobile — optimized for one-tap or two-tap resolution.

**Design principles (from Inbox Zero's patterns):**
- Mobile-first: this is the screen you use on your phone while waiting for coffee.
- One-tap for high-confidence items (green "accept" button pre-selected).
- Two-tap for medium-confidence (pick from suggestions).
- Chat button for everything ambiguous.
- Never more than 5 seconds to resolve an item.
- Color-coded confidence: green (learned/high), amber (suggested), red (unknown).
- Batch actions: "Accept all high-confidence" button at top.

**Built from shadcn.io CRUD blocks:**
- "Approval Queue Manager" → base card with accept/reject actions.
- "Status Workflow" → pending → approved → resolved transitions.
- "Activity Feed" → audit timeline on transaction detail.
- "Category Tree Manager" → category picker in review cards.

**Swipe gestures (Framer Motion):** Swipe right = accept, swipe left = reject. Springy animation.

**Review item types:**

| Type | What It Shows | Actions |
|---|---|---|
| `categorization` | Transaction + suggested category + confidence badge | [Accept] [Change] [Chat] |
| `pattern_confirm` | Transaction + pattern explanation + "learned" badge | [✓ Category] [Not this time] |
| `venmo_unknown` | Transaction + memo + category quick-picks | [Pick category] [Chat] |
| `duplicate` | Two transactions side by side | [Hide duplicate] [Keep both] |
| `reimbursement` | Credit + matched expense + net cost calculation | [Yes, split] [No, it's for...] [Chat] |
| `merchant_refund` | Credit + original purchase + net cost | [Link refund] [Different purchase] [Not a refund] |
| `receipt_match` | Transaction + receipt summary + line items | [Confirm match] [Wrong transaction] |
| `split` | Transaction + receipt items + category per item | [Accept split] [Modify] |
| `cash_allocation` | ATM withdrawal + allocation options | [Single category] [Split it] [Leave as Cash] |
| `event_suggestion` | Related transactions + suggested event name | [Create event] [Dismiss] |

**After resolving all items:** Celebration state ("All caught up! 🎉").

#### 10.2.3 Transactions (/transactions)

- **Filter bar:** Date range, category, account, amount range, type, status, search text.
- **Virtual-scrolled list** (react-window): Each row shows date, merchant (clean), category pill, amount, account icon.
- **Click → detail view** with category dropdown, linked receipt, reimbursements/refunds, events, chat button, audit log.
- **Bulk select → bulk categorize, bulk hide.**
- **Floating "+" button** on mobile: Quick-add manual expense (amount, category, date, note).

#### 10.2.4 Receipt Scanner (/receipts/scan)

- Mobile-optimized camera capture (react-webcam or native input).
- File upload alternative (react-dropzone).
- After capture: loading → extracted line items table → match to transaction.
- "Save & Match" button.

#### 10.2.5 Events (/events)

- Card grid with emoji, name, date range, total cost.
- Detail page: timeline of linked transactions, category breakdown, net cost after reimbursements.
- "Suggest events" button → LLM analyzes recent transactions for spending clusters.

#### 10.2.6 Reports (/reports)

- Tabs: Spending | Cash Flow | Events | Complete Breakdown.
- "Where every dollar went" — complete accounting with transfers excluded, reimbursements netted, unallocated line highlighted.
- All charts use shadcn Charts (AreaChart, BarChart, DonutChart) + Tremor (BarList, KPI cards).

#### 10.2.7 Ask (/ask)

- Full-page chat interface (assistant-ui).
- "How much did I spend on dining this month?" → SQL query → formatted answer.
- Suggestion pills for common questions.
- Chat can execute actions (recategorize, create events).

#### 10.2.8 Settings (/settings)

- **Bank Connections:** SimpleFIN status + connected accounts. CSV upload. Teller/Plaid connect buttons.
- **Categories:** Reorder, create, edit, merge.
- **Email scraping:** Gmail OAuth status, last scrape, test button.
- **Notifications:** Enable/disable push, test notification.
- **Learned patterns:** View and manage PersonPaymentPatterns and RecurringSplitPatterns.
- **LLM Usage:** This month's cost, projected annual, daily cost chart, cost by task/model breakdown, latency, error rate. Period selector (day/week/month/year).
- **Data export:** JSON dump of everything.

### 10.3 PWA and Push Notifications

**Service worker:** Serwist (@serwist/next) handles precaching, offline fallback, and push event handling.

**Push triggers:**
- Bank sync completed with new transactions: "5 new transactions to review."
- High-confidence reimbursement detected: "Mike sent you $30 — for electric bill?"
- Email receipt matched: "DoorDash receipt matched — Domino's Pizza $47.32."
- Bank connection disconnected: "Chase connection lost — reconnect in settings."
- Weekly summary: "Last week: $342 spent, $1,353 saved. 0 unallocated ✓" or "2 items still unallocated — tap to review."

---

## 11. Authentication and Security

### 11.1 Authentication (Clerk)

Clerk handles all authentication. No custom auth code, no password hashing, no TOTP implementation, no session management.

**Why Clerk over custom auth:**
- Free tier: 50,000 monthly users (absurd overkill for personal use, permanently free).
- Official Python SDK (`clerk-backend-api`) and FastAPI middleware (`fastapi-clerk-auth`) on PyPI.
- Pre-built React components (`<SignIn/>`, `<UserButton/>`, `<UserProfile/>`).
- Handles MFA, breach detection, bot protection, device tracking automatically.
- The Kiranism/next-shadcn-dashboard-starter already ships with Clerk wired up.

**Frontend integration:**
```tsx
// app/layout.tsx
<ClerkProvider>
  <html><body>{children}</body></html>
</ClerkProvider>

// Any protected page
import { auth } from '@clerk/nextjs/server'
const { userId } = await auth()
if (!userId) redirect('/sign-in')

// API calls — Clerk auto-attaches JWT
const { getToken } = useAuth()
const token = await getToken()
fetch('/api/transactions', { headers: { Authorization: `Bearer ${token}` } })
```

**Backend integration:**
```python
from fastapi_clerk_auth import ClerkConfig, ClerkHTTPBearer

clerk_config = ClerkConfig(jwks_url=settings.CLERK_JWKS_URL)
clerk_auth = ClerkHTTPBearer(config=clerk_config)

async def get_current_user_id(credentials=Depends(clerk_auth)) -> str:
    return credentials.decoded["sub"]  # Clerk user ID

# Every route:
@router.get("/api/transactions")
async def list_transactions(user_id: str = Depends(get_current_user_id)):
    # ALL queries scoped by user_id
    ...
```

### 11.2 Data Scoping (Multi-Tenancy by Default)

Even for a single-user deployment, all data is scoped by `user_id`:

- Every table has a `user_id` column.
- Every database query includes `WHERE user_id = :user_id`.
- The `user_id` comes from the validated Clerk JWT — it cannot be spoofed.
- If you ever want a partner/roommate to have their own login with separate data, it just works.

### 11.3 Encryption

- **In transit:** HTTPS enforced via Traefik. TLS 1.3.
- **At rest:** Bank access tokens (SimpleFIN URL, Teller token, Plaid token) encrypted with AES-256-GCM before database storage. Decrypted only in memory for API calls.
- **Encryption key:** Stored as `ENCRYPTION_KEY` environment variable. Generated with `openssl rand -hex 32`.
- **Gmail tokens:** OAuth refresh token encrypted at rest.

### 11.4 Secret Management

- All secrets stored as environment variables in `.env` (local dev) or Railway/Coolify environment settings (production).
- Secrets never committed to source code. `.env` is in `.gitignore`.
- For Hetzner VPS deployments, Coolify manages secrets with encrypted storage.

---

## 12. Infrastructure and Deployment

### 12.1 Docker Compose (Local Development)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: cashlens
      POSTGRES_USER: cashlens
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  db-backup:
    image: prodrigestivill/postgres-backup-local
    environment:
      POSTGRES_HOST: db
      POSTGRES_DB: cashlens
      POSTGRES_USER: cashlens
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      SCHEDULE: "@daily"
      BACKUP_NUM_KEEP: 7
      BACKUP_DIR: /backups
    volumes:
      - ./backups:/backups
    depends_on:
      - db

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql+asyncpg://cashlens:${DB_PASSWORD}@db:5432/cashlens
      # ... all other env vars from .env
    depends_on:
      - db
    ports:
      - "8000:8000"

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    environment:
      NEXT_PUBLIC_API_URL: http://backend:8000
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${CLERK_PUBLISHABLE_KEY}
    depends_on:
      - backend
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

### 12.2 Production Deployment Options

**Option A: Vercel (frontend) + Railway (backend) — easiest**
- Backend on Railway: connect GitHub repo, set root to /backend, add PostgreSQL addon, set env vars. Start command: `uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Frontend on Vercel: connect GitHub repo, set root to /frontend. Set `NEXT_PUBLIC_API_URL` to Railway backend URL.
- Cron: Railway supports cron jobs natively.

**Option B: Single VPS with Docker Compose — cheapest**
- Hetzner CX22: €4.35/month (~$4.60). 2 vCPU, 4GB RAM, 40GB disk.
- Coolify for git-push deploys, auto SSL, and cron.
- Same Docker Compose as development but with Traefik for reverse proxy and auto Let's Encrypt.

**Option C: Hybrid — most pragmatic**
- Frontend on Vercel (free, zero ops).
- Backend on Railway free tier or Hetzner VPS.

### 12.3 CI/CD Pipeline

```
Developer pushes code to GitHub
         │
         ▼
┌──────────────────────┐
│  GitHub Actions       │
│                       │
│  1. Lint (ruff)       │  ← Python style
│  2. Type check        │  ← mypy
│  3. Backend tests     │  ← pytest with async fixtures
│  4. Frontend tests    │  ← vitest
│  5. Build Docker      │  ← Multi-stage build
│  6. Deploy            │  ← Railway auto-deploy on main
└──────────────────────┘
```

### 12.4 Scheduled Tasks (APScheduler)

```python
# In app/main.py lifespan
from apscheduler.schedulers.asyncio import AsyncIOScheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = AsyncIOScheduler()
    scheduler.add_job(sync_all_banks, "interval", hours=6)
    scheduler.add_job(scrape_email_receipts, "interval", minutes=15)
    scheduler.add_job(process_review_queue, "interval", minutes=30)
    scheduler.start()
    yield
    scheduler.shutdown()
```

**Critical note:** Run uvicorn with a single worker for CashLens. With multiple workers, each spawns its own scheduler, causing duplicate job execution.

---

## 13. Monitoring and Observability

For a self-hosted personal app, heavy observability infrastructure (Datadog, Prometheus, Grafana) is overkill. Keep it simple:

### 13.1 Logging

- **Structured JSON logs** from FastAPI using `structlog` or Python's built-in logging with JSON formatter.
- Every log entry includes: timestamp, service, level, user_id (if available), request_id, message.
- Logs go to stdout (Docker captures them). For VPS, use `docker compose logs --tail=100`.

### 13.2 Key Health Checks

| Check | How to Monitor | Alert If |
|---|---|---|
| Bank sync freshness | `last_sync_at` per account | > 24 hours since last successful sync |
| Email scrape freshness | Last ProcessedEmail timestamp | > 2 hours since last successful scrape |
| LLM availability | `success` rate in LLMUsageLog | Error rate > 10% over 1 hour |
| Database health | FastAPI health endpoint with DB ping | Health check fails |
| Unresolved reviews | Count of `is_resolved=False` | > 50 pending items (suggests something broke) |

### 13.3 Built-in Dashboards

The Settings → LLM Usage page IS the monitoring dashboard for LLM costs. It shows:
- Daily cost chart for the past 30 days.
- Cost by task (categorize, chat, OCR, etc.).
- Cost by model (which tier is costing the most).
- Average latency and error rate.
- Projected monthly and annual cost.

---

## 14. Build Sequence and Phasing

### Phase 1: Walking Skeleton (Weeks 1–4)

**Goal:** End-to-end flow working with one bank account and basic categorization.

| Week | Milestone | Deliverable |
|---|---|---|
| 1 | Project scaffold | Monorepo from Kiranism starter. Clerk auth working. FastAPI with fastapi-clerk-auth. Docker Compose with PostgreSQL. Alembic migrations. OpenAPI client generation pipeline. |
| 2 | Bank sync + schema | All DB models created. SimpleFIN integration via simplefin4py. Transactions flowing into DB. Account list in frontend. |
| 3 | Categorization MVP | LiteLLM + Instructor wired up. LLM batch categorization working. MerchantCategoryCache populated. Basic review queue with accept/reject. |
| 4 | Integration | Transaction list page with filters. Review queue functional on mobile. Category management. Basic dashboard with balance cards and spending donut. |

**What it looks like:** You can log in, see transactions from your bank, review AI categorizations with one tap, and see a basic spending breakdown.

### Phase 2: Intelligence (Weeks 5–10)

| Week | Milestone | Deliverable |
|---|---|---|
| 5 | Pre/post categorization | Provider type fast-path (ATM → Cash). Cash allocation review. Transfer detection. |
| 6 | P2P patterns | PersonPaymentPattern learning. Venmo/Zelle auto-apply after 2 confirmations. venmo_unknown review type with quick-picks. |
| 7 | Dedup + reimbursement | Cross-account duplicate detection. Reimbursement matching. Net cost calculation. |
| 8 | Email receipts | Gmail OAuth setup. Email scraper with broad search. LLM receipt extraction. Receipt ↔ transaction matching. |
| 9 | Refunds + events | Merchant refund matching (with order number from email). Event creation and suggestion. |
| 10 | Reports | Complete breakdown report. Monthly trends. "Where every dollar went" with unallocated line. |

### Phase 3: Polish (Weeks 11–14)

| Week | Milestone | Deliverable |
|---|---|---|
| 11 | Chat | assistant-ui integration. Contextual chat on transactions. Natural language queries. |
| 12 | Receipt scanner | Camera capture on mobile. LLM vision OCR. Line-item splits. |
| 13 | Notifications | Serwist PWA service worker. Push notifications. Weekly summary. |
| 14 | Settings + LLM tracking | LLM usage dashboard. Learned patterns management. CSV import. Data export. |

### Phase 4: Hardening (Weeks 15–16)

| Focus | Details |
|---|---|
| Testing | Full test suite: 141 backend tests, 15 frontend unit tests, 12 E2E tests. |
| Performance | react-window for large lists. LLM response caching. Query optimization. |
| Documentation | CLAUDE.md finalized. README with setup guide. |
| Production deploy | Railway or Hetzner VPS. Traefik HTTPS. Backup verification. |

---

## 15. Test Plan

### 15.1 Backend Tests (pytest): ~141 tests

```
test_categorizer.py (8):
  cache hit, cache miss, high/low confidence, venmo parsing,
  batch limit, failure graceful, user override, LLM cleans unknown format

test_pre_categorizer.py (6):
  teller_type atm → Cash, transfer → transfer, fee → Fees,
  interest → Interest, card_payment → None (goes to LLM), cashback → LLM catches

test_deduplicator.py (6):
  exact fingerprint, cross-account, transfer detection,
  different amounts, LLM ambiguous, primary selection

test_reimbursement.py (7):
  exact match, partial, payroll skip, merchant refund skip,
  old expense, multiple candidates, net calculation

test_merchant_refund.py (6):
  exact refund, partial, order number match,
  multiple purchases, already refunded, different merchant

test_receipt_matcher.py (5):
  exact, tip adjustment, date offset, no match, split suggestion

test_recurring_patterns.py (6):
  pattern created, activated, auto-match, ratio tolerance,
  different sender, deactivated

test_email_scraper.py (8):
  skip non-receipt, amazon order, uber receipt, match to txn,
  pdf attachment, skip processed, incremental, token refresh

test_receipt_ocr.py (5):
  grocery, restaurant with tip, pharmacy mixed, blurry graceful,
  amount consistency

test_llm_client.py (8):
  successful call, schema validation, timeout, retry 429,
  retry 500, null on failure, model mapping, cost tracking

test_bank_sync.py (5):
  new txns inserted, existing skipped, balance updated,
  intelligence pipeline runs, disconnected skipped

test_bank_providers.py (10):
  simplefin lists accounts, simplefin lists transactions,
  csv parses chase, csv parses generic, csv auto-detect format,
  provider-agnostic sync, cheap model for categorize,
  mid model for ocr, smart model for chat, free model fallback

test_llm_no_hardcoding.py (10):
  LLM cleans SQ prefix, LLM cleans unknown format,
  LLM detects P2P, LLM detects unknown P2P platform,
  LLM extracts counterparty, LLM detects refund,
  LLM extracts refund merchant, broad email search catches unknown merchant,
  LLM filters non-receipt email, account-based P2P detection

test_api_transactions.py (10):
  list filters, exclude hidden, update category, split,
  split validation, bulk update, mark transfer, cash flow,
  search, pagination

test_api_intelligence.py (5):
  categorize new, check dupes, match reimbursement,
  ask question, SQL injection blocked

test_api_chat.py (3):
  context loading, action execution, history retrieval

test_api_events.py (4):
  create, add transactions with partial attribution, suggest, delete

test_manual_entry.py (4):
  manual entry created, atm creates review, manual no dedup, split cash

test_unallocated.py (5):
  counts pending debits, excludes hidden, excludes credits,
  zero when all categorized, complete breakdown sums balance

test_llm_usage.py (7):
  logged on success, logged on failure, cost calculation correct,
  unknown model safe default, API returns aggregates,
  filters by period, task parameter passed

test_auth.py (3):
  valid Clerk JWT → user_id extracted, invalid JWT → 401,
  all queries scoped by user_id
```

### 15.2 Frontend Tests (vitest): ~15 tests

```
Review card renders correctly, chat panel sends messages,
category select updates, filter bar builds query params,
push subscription registers, transaction list renders,
manual entry form validates, receipt upload triggers OCR,
event card shows total, dashboard renders KPIs,
unallocated banner shows/hides, batch accept works,
swipe gesture triggers action, dark mode toggles, auth redirect works
```

### 15.3 E2E Tests (Playwright): ~12 tests

```
login, view transactions, filter by category, change category,
review queue accept, review queue chat, scan receipt,
create event, reports render, ask question,
push notification permission, PWA install prompt
```

**Total: ~168 tests**

---

## 16. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SimpleFIN doesn't support user's bank | Medium | High | CSV/OFX import as universal fallback. Teller and Plaid as alternatives. Provider abstraction means swapping is painless. |
| LLM produces wrong categorizations | High (initially) | Medium | Every uncertain decision goes to review queue. System learns from corrections. MerchantCategoryCache improves over time. Human is always in the loop. |
| LLM costs higher than estimated | Low | Low | Cheap tier handles 80% of tasks. Cost tracking dashboard surfaces unexpected spending. Free model fallback available. Even 10x the estimate is only $35/year. |
| OpenRouter goes down or changes pricing | Low | Medium | LiteLLM supports 100+ providers. Switch to direct API (Google, Anthropic) with a config change. |
| Gmail API access revoked or rate limited | Medium | Medium | Email receipts are a nice-to-have, not critical. App works fine without them. Manual receipt scan as fallback. |
| Clerk changes free tier limits | Low | Medium | 50K users is absurd overkill. Even if reduced to 1K, still fine. Worst case: switch to custom auth (the original plan). |
| Bank sync misses transactions | Low | High | Dedup by external_id ensures no duplicates. Unallocated tracking surfaces missing transactions. Manual entry as catch-all. |
| Single point of failure (one server) | High | High | For a personal app, this is acceptable. Automated backups with 7-day daily retention. 5-minute recovery from backup. |
| P2P pattern learning makes wrong associations | Medium | Low | Patterns require 2+ confirmations before auto-apply. "Not this time" button always available. Pattern can be deactivated in settings. |

---

## 17. Glossary

| Term | Definition |
|---|---|
| **ATM Allocation** | The process of assigning a category to an ATM cash withdrawal, since the bank only knows you withdrew cash — not what you spent it on. |
| **Bank Provider** | An abstraction over different bank connection services (SimpleFIN, Teller, Plaid, CSV import). All implement the same interface. |
| **Clerk** | A managed authentication service that handles login, signup, MFA, and session management. CashLens uses it for all auth instead of building custom. |
| **Confidence Score** | A 0.0–1.0 number indicating how confident the LLM is in its categorization. Scores below 0.7 create review items. |
| **Cross-Account Duplicate** | When the same money movement appears on two accounts (e.g., Venmo payment shows on your bank AND your Venmo account). One should be hidden. |
| **Instructor** | A Python library that wraps LLM calls with Pydantic model validation. You define the response schema, and it auto-retries until the LLM produces valid output. |
| **LiteLLM** | A Python library providing a unified interface for 100+ LLM providers. Handles retry, fallback, cost tracking, and model routing. |
| **LLM Tier** | One of three model quality/cost levels: cheap (Gemini Flash Lite, $0.10/M tokens), mid (Gemini Flash, $0.30/M), smart (Claude Haiku 4.5, $1.00/M). Tasks are assigned to the cheapest tier that can handle them. |
| **Merchant Category Cache** | A lookup table mapping LLM-cleaned merchant names to categories. Prevents re-calling the LLM for merchants seen before. |
| **Net Amount** | The true cost of a transaction after reimbursements and refunds. If you paid $200 for dinner and 3 friends Venmo'd you $150, the net amount is $50. |
| **OpenRouter** | A unified API gateway for multiple LLM providers. Send requests to one endpoint, choose any model. LiteLLM talks to OpenRouter. |
| **PersonPaymentPattern** | A learned association between a P2P payment counterparty (person name + amount range + timing) and a category. Auto-applies after 2+ confirmations. |
| **Pre-Categorize** | The first step in the categorization pipeline. Uses structured metadata (bank's transaction type field) to categorize without calling the LLM. Catches ATM, transfer, fee, and interest transactions. |
| **PWA** | Progressive Web App. A website that can be installed to your phone's home screen and behaves like a native app, including push notifications and offline access. |
| **Review Queue** | The screen where every uncertain AI decision surfaces for human confirmation. Optimized for one-tap resolution on mobile. |
| **Serwist** | The official Next.js-recommended service worker toolkit (successor to next-pwa). Handles precaching, push notifications, and offline fallback. |
| **shadcn/ui** | A component library for React that provides copy-paste components (not npm dependencies). You own the code. Built on Radix primitives + Tailwind CSS. |
| **SimpleFIN** | A bank connection service that provides access to 16,000+ banks for $15/year. The recommended primary bank provider for CashLens. |
| **Structured Output** | When an LLM returns data in a predefined schema (JSON matching a Pydantic model) rather than free-form text. Instructor enforces this. |
| **Tremor** | A React component library for dashboard data visualization. KPI cards, sparklines, bar lists, progress trackers. |
| **Unallocated** | Money that left your accounts but hasn't been categorized yet. CashLens tracks this number and actively drives it toward $0. |

---

*This document is the single source of truth for CashLens's architecture. It consolidates the original v3-final spec and addenda v3.1 (cash entry), v3.2 (cash detection), v3.3 (kill hardcoding), v3.4 (pluggable providers + cheap LLM routing), and v3.5 (LLM cost tracking), plus the open-source assembly strategy. All significant deviations should be discussed and documented before implementation.*
