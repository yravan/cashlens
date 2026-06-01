# Cash Lens — Feature Tree (canonical)

Version: **v0 (baseline)** · See [00-README.md](00-README.md) for vision, conventions, legend, and the iteration protocol.
Leaf format: `**ID — Title** [status] size layer — scope. _deps:_ … · _skill:_ …`
Status `[built]`/`[partial]`/`[new]` · size `S`/`M`/`L` · layer `api·web·ios·infra·data·shared·research`.

---

## PLT — Platform, Environments & Delivery

### PLT-1 Local dev & demo
- **PLT-1.1 — One-command local stack** `[partial]` `M` `infra` — `make dev` boots api + web + db in demo mode.
- **PLT-1.2 — Idempotent demo workspace seed/reset** `[built]` `S` `api` — reseed without duplicating rows. _skill:_ db-evolution
- **PLT-1.3 — Local Postgres parity (docker-compose)** `[partial]` `S` `infra` — match Neon locally, not just SQLite.

### PLT-2 Migrations & schema management
- **PLT-2.1 — Introduce Alembic migration framework** `[new]` `M` `infra` — replace `create_all`; baseline migration of current models. _skill:_ db-evolution
- **PLT-2.2 — Migration CI check (upgrade+downgrade on ephemeral db)** `[new]` `S` `infra` — _deps:_ PLT-2.1
- **PLT-2.3 — Idempotent migration/backfill test harness** `[new]` `M` `data` — re-run safety asserts. _skill:_ db-evolution
- **PLT-2.4 — Seed data decoupled from app startup** `[new]` `S` `data` — fixtures runnable independently.

### PLT-3 Background jobs & scheduling
- **PLT-3.1 — Task runner abstraction (enqueue interface)** `[new]` `M` `api` — local in-proc + Cloud Tasks behind one interface.
- **PLT-3.2 — Cloud Tasks queue + secured handler endpoint** `[new]` `M` `infra` — _deps:_ PLT-3.1, SEC-4.3
- **PLT-3.3 — Cloud Scheduler periodic sync trigger** `[new]` `S` `infra` — _deps:_ PLT-3.2
- **PLT-3.4 — Job status surfacing API (from sync_runs)** `[partial]` `S` `api`
- **PLT-3.5 — Dead-letter + retry/backoff policy** `[new]` `M` `api` — _deps:_ PLT-3.1

### PLT-4 Observability & error tracking
- **PLT-4.1 — Structured JSON logging + request IDs** `[new]` `S` `api`
- **PLT-4.2 — Error tracking (Sentry) — backend** `[new]` `S` `api`
- **PLT-4.3 — Error tracking (Sentry) — web** `[new]` `S` `web`
- **PLT-4.4 — Health + readiness probes** `[built]` `S` `api`
- **PLT-4.5 — Core metrics (sync latency, job counts, error rate)** `[new]` `M` `api`

### PLT-5 Config, secrets & feature flags
- **PLT-5.1 — Typed settings/config module** `[built]` `S` `api`
- **PLT-5.2 — Secret Manager wiring for prod secrets** `[partial]` `M` `infra` — _skill:_ platform-ops
- **PLT-5.3 — Feature flag module (server + client)** `[new]` `M` `shared`
- **PLT-5.4 — Per-env config matrix + startup validation** `[partial]` `S` `infra` — _skill:_ env-vars

### PLT-6 CI/CD & environments
- **PLT-6.1 — CI checks: api/web/e2e/docs** `[built]` `S` `infra`
- **PLT-6.2 — Per-PR preview deploys (web)** `[partial]` `S` `infra` — _skill:_ deployments-cicd
- **PLT-6.3 — Staging auto-deploy** `[built]` `S` `infra`
- **PLT-6.4 — Production deploy workflows (api + web)** `[partial]` `M` `infra`
- **PLT-6.5 — DB migration step in deploy pipeline** `[new]` `M` `infra` — _deps:_ PLT-2.1

### PLT-7 Release & versioning
- **PLT-7.1 — Version sync script + check** `[built]` `S` `infra` — _skill:_ release-hygiene
- **PLT-7.2 — Changelog "Unreleased" flow** `[partial]` `S` `infra` — _skill:_ release-hygiene
- **PLT-7.3 — Release tagging + GitHub release** `[new]` `S` `infra`

---

## SEC — Security, Privacy, Data & Compliance

### SEC-1 Identity & token security
- **SEC-1.1 — Enforce server-verified identity (no spoofable headers)** `[partial]` `M` `api` — verify Clerk JWT server-side every request. _skill:_ clerk-cli
- **SEC-1.2 — Per-user row-scoping guard** `[partial]` `M` `api` — all queries scoped to `user_id`.
- **SEC-1.3 — Encrypted provider-token storage (KMS/Fernet)** `[partial]` `M` `api` — real crypto for `encrypted_access_token`.
- **SEC-1.4 — Token rotation + revoke on disconnect** `[new]` `M` `api` — _deps:_ SEC-1.3

### SEC-2 Data encryption
- **SEC-2.1 — Field-level encryption for sensitive PII** `[new]` `M` `data`
- **SEC-2.2 — Secret rotation runbook + automation** `[new]` `S` `infra`
- **SEC-2.3 — Verify Neon at-rest encryption posture** `[new]` `S` `research`

### SEC-3 Privacy & data rights
- **SEC-3.1 — Account deletion (hard delete + provider disconnect)** `[new]` `L` `api` — _deps:_ SRC-2.5
- **SEC-3.2 — Full data export (JSON/CSV)** `[new]` `M` `api`
- **SEC-3.3 — Consent records per data source** `[new]` `M` `data`
- **SEC-3.4 — Data retention config + privacy policy page** `[new]` `S` `infra`

### SEC-4 Audit & abuse
- **SEC-4.1 — Audit log of sensitive actions** `[new]` `M` `data`
- **SEC-4.2 — Rate limiting (auth, sync, LLM endpoints)** `[new]` `M` `api`
- **SEC-4.3 — Webhook signature verification** `[partial]` `S` `api`
- **SEC-4.4 — PII redaction in logs** `[new]` `S` `api`

### SEC-5 Compliance posture
- **SEC-5.1 — SOC2-readiness checklist (doc)** `[new]` `S` `research`
- **SEC-5.2 — LLM data-handling policy (no-train, redaction)** `[new]` `S` `research`

---

## AUT — Identity, Auth & Sessions

### AUT-1 Auth providers
- **AUT-1.1 — Clerk sign-in/sign-up (web)** `[partial]` `M` `web` — _skill:_ clerk-cli, auth
- **AUT-1.2 — Sign in with Google (Clerk OAuth)** `[new]` `S` `web`
- **AUT-1.3 — Clerk production instance setup** `[new]` `S` `infra` — _skill:_ clerk-cli
- **AUT-1.4 — Local auth toggle / demo bypass** `[built]` `S` `web`

### AUT-2 Session lifecycle
- **AUT-2.1 — Server session verification + `/me`** `[built]` `S` `api`
- **AUT-2.2 — Sign-out + session revoke** `[partial]` `S` `web`
- **AUT-2.3 — Protected route middleware (web)** `[partial]` `S` `web`
- **AUT-2.4 — Token refresh handling** `[new]` `S` `web`

### AUT-3 User record & preferences
- **AUT-3.1 — User provisioning on first login (upsert by external id)** `[partial]` `M` `api`
- **AUT-3.2 — Profile fields (name, email, avatar, timezone, currency)** `[partial]` `M` `api`
- **AUT-3.3 — User settings/preferences store** `[new]` `M` `data`

### AUT-4 Multi-device & step-up
- **AUT-4.1 — Active sessions list + revoke** `[new]` `M` `web`
- **AUT-4.2 — Step-up auth for sensitive actions** `[new]` `M` `web` — _deps:_ AUT-2.1

---

## ONB — Onboarding & Registration

### ONB-1 First-run flow
- **ONB-1.1 — Welcome / value-prop screen** `[new]` `S` `web` — _skill:_ frontend-design
- **ONB-1.2 — Onboarding progress checklist** `[new]` `M` `web`
- **ONB-1.3 — Onboarding state persistence** `[new]` `S` `api`

### ONB-2 Connect-first-account wizard
- **ONB-2.1 — Guided "connect your first bank" step** `[new]` `M` `web` — _deps:_ SRC-2.3
- **ONB-2.2 — "We're importing…" status step** `[new]` `S` `web` — _deps:_ ING-1.2
- **ONB-2.3 — Skip / connect-later path** `[new]` `S` `web`

### ONB-3 Personalization
- **ONB-3.1 — Choose primary currency + timezone** `[new]` `S` `web` — _deps:_ AUT-3.2
- **ONB-3.2 — Pick categories of interest** `[new]` `S` `web` — _deps:_ CAT-1.1
- **ONB-3.3 — Push opt-in step** `[new]` `S` `web` — _deps:_ NTF-3.1

### ONB-4 Demo→real transition
- **ONB-4.1 — Demo workspace → real account migration** `[new]` `M` `api`
- **ONB-4.2 — Empty states across app pre-connection** `[new]` `M` `web`

---

## SRC — Source Connections

### SRC-1 Provider-agnostic framework
- **SRC-1.1 — Provider abstraction interface (connect/sync/disconnect)** `[new]` `L` `api` — common contract over providers.
- **SRC-1.2 — Generalize `plaid_items` → `connections`** `[partial]` `M` `data` — _skill:_ db-evolution · _deps:_ PLT-2.1
- **SRC-1.3 — Provider capability metadata** `[new]` `S` `api` — what each source can fetch.
- **SRC-1.4 — Connection health status model** `[partial]` `S` `data`
- **SRC-1.5 — SPIKE: bank provider choice (Plaid vs Teller vs SimpleFIN)** `[new]` `S` `research`

### SRC-2 Bank & card (Plaid today)
- **SRC-2.1 — Plaid Link token create** `[built]` `S` `api`
- **SRC-2.2 — Public-token exchange + item store** `[built]` `M` `api`
- **SRC-2.3 — Plaid Link UI button + flow** `[built]` `M` `web`
- **SRC-2.4 — Reconnect / Link update mode** `[new]` `M` `web` — re-auth without losing history.
- **SRC-2.5 — Disconnect item (+ token revoke)** `[new]` `M` `api` — _deps:_ SEC-1.4
- **SRC-2.6 — Multiple institutions support** `[partial]` `M` `api`
- **SRC-2.7 — Institution metadata + logos** `[new]` `S` `web`

### SRC-3 Venmo
- **SRC-3.1 — SPIKE: Venmo data access (API vs statement export)** `[new]` `S` `research`
- **SRC-3.2 — Venmo statement/CSV parser** `[new]` `M` `data` — _deps:_ SRC-3.1
- **SRC-3.3 — Venmo → raw events ingestion** `[new]` `M` `data` — _deps:_ SRC-3.2

### SRC-4 PayPal
- **SRC-4.1 — SPIKE: PayPal API access** `[new]` `S` `research`
- **SRC-4.2 — PayPal data import → raw events** `[new]` `M` `data` — _deps:_ SRC-4.1

### SRC-5 Investments (Fidelity / Robinhood / Kalshi)
- **SRC-5.1 — SPIKE: investments access (Plaid Investments vs direct)** `[new]` `S` `research`
- **SRC-5.2 — Investment accounts + holdings model** `[new]` `M` `data`
- **SRC-5.3 — Investment balance/holdings ingestion** `[new]` `M` `data` — _deps:_ SRC-5.1
- **SRC-5.4 — Manual investment account entry** `[new]` `S` `web`

### SRC-6 Gmail (receipts/invoices)
- **SRC-6.1 — Gmail OAuth connection** `[new]` `M` `api` — _skill:_ env-vars
- **SRC-6.2 — Gmail token storage + scopes** `[new]` `M` `api` — _deps:_ SEC-1.3
- **SRC-6.3 — Receipt/invoice email search + fetch** `[new]` `L` `api` — _deps:_ SRC-6.1
- **SRC-6.4 — Incremental Gmail history sync** `[new]` `M` `api` — _deps:_ SRC-6.3

### SRC-7 SMS / iMessage (receipts)
- **SRC-7.1 — SPIKE: SMS/iMessage receipt ingestion** `[new]` `S` `research` — _skill:_ imessage
- **SRC-7.2 — Forward-to-email receipt inbox (fallback path)** `[new]` `M` `api`

### SRC-8 Manual & file import
- **SRC-8.1 — CSV/OFX/QFX file import** `[new]` `L` `data`
- **SRC-8.2 — Manual transaction entry** `[new]` `M` `web`
- **SRC-8.3 — Manual account (cash/asset/liability) entry** `[new]` `M` `web`

### SRC-9 Connection management UI
- **SRC-9.1 — Connections management page** `[partial]` `M` `web`
- **SRC-9.2 — Per-connection "sync now" + status** `[built]` `S` `web`
- **SRC-9.3 — Reconnect prompts on error status** `[new]` `M` `web` — _deps:_ SRC-2.4

---

## ING — Ingestion & Sync Engine

### ING-1 Initial backfill
- **ING-1.1 — Paged initial transactions backfill** `[partial]` `M` `api` — _skill:_ db-evolution
- **ING-1.2 — Backfill progress + resumability** `[new]` `M` `api` — _deps:_ PLT-3.1
- **ING-1.3 — Historical date-range backfill control** `[new]` `M` `web`
- **ING-1.4 — Account balance snapshot on connect** `[partial]` `S` `api`

### ING-2 Incremental sync
- **ING-2.1 — Cursor-based incremental sync** `[partial]` `M` `api`
- **ING-2.2 — Safe cursor persistence/advance** `[partial]` `S` `data` — _skill:_ db-evolution
- **ING-2.3 — Pending→posted transition handling** `[new]` `M` `data`
- **ING-2.4 — Removed-transaction handling** `[partial]` `S` `data`

### ING-3 Webhooks
- **ING-3.1 — Webhook receiver + verification** `[built]` `M` `api`
- **ING-3.2 — Webhook → enqueue sync job** `[new]` `M` `api` — _deps:_ PLT-3.1
- **ING-3.3 — Webhook event log + replay** `[new]` `M` `data`

### ING-4 Raw storage & dedup
- **ING-4.1 — Idempotent raw upsert (by provider txn id)** `[built]` `M` `data`
- **ING-4.2 — Raw dedup (pending vs posted)** `[new]` `M` `data`
- **ING-4.3 — Raw JSON preservation** `[built]` `S` `data`

### ING-5 Orchestration & reliability
- **ING-5.1 — Sync run records + outcomes** `[built]` `S` `data`
- **ING-5.2 — Per-item rate limiting + backoff** `[new]` `M` `api`
- **ING-5.3 — Partial failure isolation** `[new]` `M` `api` — one account failing doesn't fail the run.
- **ING-5.4 — Manual full re-sync action** `[built]` `S` `api`
- **ING-5.5 — Sync result notifications (new txns, errors)** `[partial]` `M` `api` — _deps:_ NTF-5.3

---

## LDG — Ledger Core & Normalization

### LDG-1 Normalization pipeline
- **LDG-1.1 — Raw→ledger normalization service** `[built]` `M` `api`
- **LDG-1.2 — Idempotent ledger derivation (no dup events)** `[partial]` `M` `data` — _skill:_ db-evolution
- **LDG-1.3 — Ledger re-derivation/replay command** `[new]` `M` `data`
- **LDG-1.4 — Sign/direction normalization** `[built]` `S` `data`

### LDG-2 Money-flow semantics
- **LDG-2.1 — Event-type taxonomy (purchase/income/fee/transfer/payment/refund)** `[partial]` `M` `data`
- **LDG-2.2 — Transfer detection (paired in/out across accounts)** `[new]` `L` `data`
- **LDG-2.3 — Card-payment detection + exclusion** `[partial]` `M` `data`
- **LDG-2.4 — True-spend computation** `[built]` `M` `api`
- **LDG-2.5 — Manual exclude-from-spend override** `[built]` `S` `web`

### LDG-3 Balances & net worth
- **LDG-3.1 — Account balance store + history** `[partial]` `M` `data`
- **LDG-3.2 — Net worth computation (assets − liabilities)** `[new]` `M` `api`
- **LDG-3.3 — Net worth over-time snapshots** `[new]` `M` `data`
- **LDG-3.4 — Credit utilization + total owed** `[new]` `M` `api`

### LDG-4 Currency & amounts
- **LDG-4.1 — Multi-currency amount model** `[new]` `M` `data`
- **LDG-4.2 — FX rate fetch + conversion** `[new]` `M` `api`
- **LDG-4.3 — Migrate money Float→integer minor units** `[new]` `L` `data` — current `Float` risks rounding. _skill:_ db-evolution

---

## ENR — Enrichment, Matching & Dedup

### ENR-1 Merchant enrichment
- **ENR-1.1 — Merchant name normalization** `[new]` `M` `data`
- **ENR-1.2 — Merchant logo/domain enrichment** `[new]` `S` `api`
- **ENR-1.3 — Canonical merchant entity table** `[new]` `M` `data`

### ENR-2 Cross-source matching
- **ENR-2.1 — Matching framework (amount+date+merchant candidates)** `[new]` `L` `data`
- **ENR-2.2 — Bank ↔ Venmo match** `[new]` `M` `data` — _deps:_ SRC-3.3, ENR-2.1
- **ENR-2.3 — Bank ↔ PayPal match** `[new]` `M` `data` — _deps:_ SRC-4.2, ENR-2.1
- **ENR-2.4 — Transaction ↔ receipt match** `[new]` `M` `data` — _deps:_ RCP-1.3, ENR-2.1
- **ENR-2.5 — Match confidence + manual confirm UI** `[new]` `M` `web`

### ENR-3 Dedup across sources
- **ENR-3.1 — Cross-source dedup rules (one purchase, N sources)** `[new]` `L` `data` — _skill:_ db-evolution
- **ENR-3.2 — Dedup review/merge UI** `[new]` `M` `web`
- **ENR-3.3 — Unmerge / split-back action** `[new]` `S` `api`

### ENR-4 Splitting
- **ENR-4.1 — Split transaction into line items** `[new]` `L` `data`
- **ENR-4.2 — Split across categories** `[new]` `M` `web`
- **ENR-4.3 — Split for reimbursement (mark portion owed)** `[new]` `M` `api` — _deps:_ OWE-1.1

---

## RCP — Receipts, Invoices & Line Items

### RCP-1 Capture
- **RCP-1.1 — Receipt image upload (web)** `[new]` `M` `web`
- **RCP-1.2 — Receipt blob storage** `[new]` `M` `infra` — _skill:_ vercel-storage
- **RCP-1.3 — Gmail receipt fetch → receipt record** `[new]` `M` `api` — _deps:_ SRC-6.3
- **RCP-1.4 — Email receipt HTML parser** `[new]` `L` `data`

### RCP-2 Parsing / OCR
- **RCP-2.1 — SPIKE: OCR vendor (Textract vs GPT-4o vision vs Tesseract)** `[new]` `S` `research`
- **RCP-2.2 — Receipt OCR → structured fields** `[new]` `L` `api` — _deps:_ RCP-2.1 · _skill:_ ai-sdk
- **RCP-2.3 — LLM line-item extraction** `[new]` `L` `api` — _skill:_ ai-sdk
- **RCP-2.4 — Parser confidence + review** `[new]` `M` `web`

### RCP-3 Line items
- **RCP-3.1 — Line item model (product/service, qty, unit price)** `[new]` `M` `data`
- **RCP-3.2 — Line items ↔ ledger linkage** `[new]` `M` `data` — _deps:_ ENR-4.1
- **RCP-3.3 — Per-line-item category assignment** `[new]` `M` `web` — _deps:_ CAT-1.1

### RCP-4 Invoice tracking
- **RCP-4.1 — Invoice model + lifecycle (received/paid/overdue)** `[new]` `M` `data`
- **RCP-4.2 — Invoice extraction from Gmail** `[new]` `L` `api` — _deps:_ SRC-6.3
- **RCP-4.3 — Invoice → upcoming obligation linkage** `[new]` `M` `api` — _deps:_ OWE-5.1

---

## CAT — Categorization & Rules

### CAT-1 Taxonomy
- **CAT-1.1 — Two-level taxonomy (groups → categories)** `[new]` `M` `data`
- **CAT-1.2 — Default category seed set (+ icon/emoji)** `[new]` `S` `data`
- **CAT-1.3 — Custom user categories CRUD** `[new]` `M` `api`
- **CAT-1.4 — Category merge / rename / archive** `[new]` `M` `api`

### CAT-2 Manual categorization
- **CAT-2.1 — Inline category edit on transaction** `[built]` `S` `web`
- **CAT-2.2 — Bulk categorize selection** `[new]` `M` `web`
- **CAT-2.3 — Category picker with search** `[new]` `S` `web`

### CAT-3 Rules engine
- **CAT-3.1 — Rule model (match → set category/flags)** `[new]` `M` `data`
- **CAT-3.2 — Rule evaluation on ingest** `[new]` `M` `api`
- **CAT-3.3 — "Apply to all future/past matching" on edit** `[new]` `M` `api`
- **CAT-3.4 — Rules management page** `[new]` `M` `web`
- **CAT-3.5 — Rule priority/conflict resolution** `[new]` `M` `api`

### CAT-4 LLM categorization
- **CAT-4.1 — LLM categorization service (structured output)** `[new]` `L` `api` — _skill:_ ai-sdk, ai-gateway
- **CAT-4.2 — Batch categorize uncategorized** `[new]` `M` `api` — _deps:_ CAT-4.1
- **CAT-4.3 — Confidence threshold to auto-apply vs queue** `[new]` `M` `api`
- **CAT-4.4 — Prompt + taxonomy grounding** `[new]` `M` `api` — _skill:_ ai-sdk
- **CAT-4.5 — LLM cost controls + caching** `[new]` `M` `api` — _skill:_ ai-gateway

### CAT-5 Learning
- **CAT-5.1 — Learn-from-corrections feedback store** `[new]` `M` `data`
- **CAT-5.2 — Auto-suggest rule from repeated corrections** `[new]` `M` `api` — _deps:_ CAT-3.1, CAT-5.1
- **CAT-5.3 — Per-merchant remembered category** `[new]` `M` `data`

---

## OWE — Receivables, Returns & Obligations

### OWE-1 Reimbursements (owed to me)
- **OWE-1.1 — Reimbursement claim model (amount, by whom, status)** `[new]` `M` `data`
- **OWE-1.2 — Mark transaction/split as reimbursable** `[new]` `M` `web` — _deps:_ ENR-4.3
- **OWE-1.3 — Settle reimbursement (match incoming payment)** `[new]` `M` `api` — _deps:_ ENR-2.1
- **OWE-1.4 — Outstanding receivables view** `[new]` `M` `web`

### OWE-2 Group pay / split (Venmo-back)
- **OWE-2.1 — Group expense model (I paid, owed by N)** `[new]` `M` `data`
- **OWE-2.2 — Split calculator UI** `[new]` `M` `web`
- **OWE-2.3 — Venmo-back matching (incoming → settle split)** `[new]` `M` `api` — _deps:_ ENR-2.2

### OWE-3 Returns
- **OWE-3.1 — Return-intent model (item, expected refund)** `[new]` `M` `data`
- **OWE-3.2 — Mark purchase "to return"** `[new]` `S` `web`
- **OWE-3.3 — Refund matching (credit → close return)** `[new]` `M` `api` — _deps:_ ENR-2.1
- **OWE-3.4 — Pending returns view** `[new]` `S` `web`

### OWE-4 Scheduled / future transactions
- **OWE-4.1 — Scheduled/future transaction model** `[new]` `M` `data`
- **OWE-4.2 — Manual upcoming-transaction entry** `[new]` `S` `web`
- **OWE-4.3 — Future cash-position projection** `[new]` `M` `api` — _deps:_ INT-3.1

### OWE-5 Bills & recurring obligations
- **OWE-5.1 — Bill model (payee, amount, cadence, due)** `[new]` `M` `data`
- **OWE-5.2 — Bill calendar view** `[new]` `M` `web`
- **OWE-5.3 — Bill due reminders** `[new]` `M` `api` — _deps:_ NTF-5.3
- **OWE-5.4 — Bill ↔ recurring stream linkage** `[new]` `M` `api` — _deps:_ INT-1.2

---

## INT — Intelligence: Recurring, Prediction & Anomaly

### INT-1 Recurring detection
- **INT-1.1 — Recurring stream detection algorithm** `[new]` `L` `api` — _skill:_ db-evolution
- **INT-1.2 — Recurring stream model + cadence** `[new]` `M` `data`
- **INT-1.3 — Recurring list + calendar view** `[new]` `M` `web`
- **INT-1.4 — Confirm/dismiss detected recurring** `[new]` `S` `web`

### INT-2 Subscriptions
- **INT-2.1 — Subscription candidate detection** `[new]` `M` `api` — _deps:_ INT-1.1
- **INT-2.2 — Subscription cost rollup (monthly/annual)** `[new]` `M` `api`
- **INT-2.3 — Forgotten/unused subscription flag** `[new]` `M` `api`

### INT-3 Forecasting
- **INT-3.1 — Cash-flow forecast (30/60/90d)** `[new]` `L` `api` — _deps:_ OWE-4.1, INT-1.1
- **INT-3.2 — Month-end balance projection** `[new]` `M` `api`
- **INT-3.3 — Forecast vs actual tracking** `[new]` `M` `api`

### INT-4 Anomaly / overcharge
- **INT-4.1 — Anomaly detection (amount/merchant/frequency)** `[new]` `L` `api`
- **INT-4.2 — Duplicate-charge detection** `[new]` `M` `api` — _deps:_ ENR-3.1
- **INT-4.3 — Price-change detection on recurring** `[new]` `M` `api` — _deps:_ INT-1.2
- **INT-4.4 — Overcharge/unexpected-fee flag** `[new]` `M` `api`

### INT-5 Predicted / forgotten charges
- **INT-5.1 — Predict upcoming charges (from recurring)** `[new]` `M` `api` — _deps:_ INT-1.2
- **INT-5.2 — "Charge you may have forgotten" surfacing** `[new]` `M` `api`
- **INT-5.3 — Anomaly/prediction notification feed** `[new]` `M` `api` — _deps:_ NTF-5.3

---

## RPT — Analytics, Reports & Insights

### RPT-1 Dashboard
- **RPT-1.1 — Summary cards (cash/credit/in/out/true-spend)** `[built]` `M` `web`
- **RPT-1.2 — Widget dashboard (drag-reorder + visibility)** `[new]` `L` `web` — _skill:_ shadcn
- **RPT-1.3 — Recent activity feed widget** `[built]` `S` `web`
- **RPT-1.4 — Net worth widget** `[new]` `M` `web` — _deps:_ LDG-3.2

### RPT-2 Cash flow
- **RPT-2.1 — Cash-flow report (in vs out over time)** `[new]` `M` `web`
- **RPT-2.2 — Sankey income→category flow** `[new]` `L` `web`
- **RPT-2.3 — Click-to-filter from chart → transactions** `[new]` `M` `web`

### RPT-3 Category analytics
- **RPT-3.1 — Spending by category (donut/bar)** `[new]` `M` `web`
- **RPT-3.2 — Category drilldown (e.g., groceries detail)** `[new]` `M` `web`
- **RPT-3.3 — Health spend breakdown (derm/psych/glasses)** `[new]` `S` `web`
- **RPT-3.4 — Merchant leaderboard** `[new]` `S` `web`

### RPT-4 Trends & net worth
- **RPT-4.1 — Spending trends (MoM/YoY)** `[new]` `M` `web`
- **RPT-4.2 — Net worth over-time chart** `[new]` `M` `web` — _deps:_ LDG-3.3
- **RPT-4.3 — Income vs expense trend** `[new]` `S` `web`

### RPT-5 Tax
- **RPT-5.1 — Tax-relevant tags** `[new]` `M` `data`
- **RPT-5.2 — Estimated tax-payment tracker** `[new]` `M` `api`
- **RPT-5.3 — Surplus/deficit (savings rate) report** `[new]` `M` `api`

### RPT-6 Budgets / targets
- **RPT-6.1 — Budget/target model per category** `[new]` `M` `data`
- **RPT-6.2 — Budget vs actual report** `[new]` `M` `web`
- **RPT-6.3 — Macro percentages (50/30/20) view** `[new]` `M` `web`

### RPT-7 Saved & export
- **RPT-7.1 — Saved/bookmarked report views** `[new]` `M` `web`
- **RPT-7.2 — Export report (CSV/PDF)** `[new]` `M` `web`

---

## REV — Review Queue (Tinder UI)

### REV-1 Queue construction
- **REV-1.1 — Queue builder (uncategorized/low-confidence/anomalies)** `[new]` `M` `api`
- **REV-1.2 — Queue prioritization (confidence, recency, amount)** `[new]` `M` `api`
- **REV-1.3 — Queue API + pagination** `[new]` `S` `api`

### REV-2 Swipe / keyboard review
- **REV-2.1 — Swipe card UI (mobile-friendly)** `[new]` `L` `web` — _skill:_ frontend-design
- **REV-2.2 — Keyboard shortcuts for review** `[new]` `S` `web`
- **REV-2.3 — Undo last action** `[new]` `S` `web`
- **REV-2.4 — Progress + empty state** `[new]` `S` `web`

### REV-3 Card actions
- **REV-3.1 — Quick-categorize action** `[new]` `S` `web` — _deps:_ CAT-2.3
- **REV-3.2 — Mark reimbursable/return/transfer** `[new]` `M` `web` — _deps:_ OWE-1.2, LDG-2.2
- **REV-3.3 — Split action from card** `[new]` `M` `web` — _deps:_ ENR-4.1
- **REV-3.4 — Add note/receipt from card** `[new]` `S` `web` — _deps:_ RCP-1.1

### REV-4 Prioritization & nudges
- **REV-4.1 — Bulk review (apply to similar)** `[new]` `M` `web` — _deps:_ CAT-3.3
- **REV-4.2 — Daily review reminder** `[new]` `S` `api` — _deps:_ NTF-5.3

---

## NAV — App Shell, Search & Navigation

### NAV-1 Shell
- **NAV-1.1 — App shell + collapsible sidebar** `[built]` `M` `web`
- **NAV-1.2 — Responsive layout (mobile web)** `[partial]` `M` `web`
- **NAV-1.3 — Nav structure for all screens** `[partial]` `S` `web`

### NAV-2 Command-K
- **NAV-2.1 — Command-K palette (cmdk/kbar)** `[new]` `M` `web` — _skill:_ shadcn
- **NAV-2.2 — Search index (txns/accounts/categories)** `[new]` `M` `api`
- **NAV-2.3 — Quick actions in palette** `[new]` `S` `web`

### NAV-3 Search & filters
- **NAV-3.1 — Transaction filters (15+ dimensions)** `[partial]` `L` `web`
- **NAV-3.2 — Saved filter views (URL state via nuqs)** `[new]` `M` `web`
- **NAV-3.3 — Full-text transaction search** `[new]` `M` `api`

### NAV-4 Theming
- **NAV-4.1 — Light/dark theme (next-themes)** `[new]` `S` `web`
- **NAV-4.2 — Design tokens + shadcn theme** `[partial]` `M` `web` — _skill:_ shadcn, frontend-design

---

## NTF — Notifications & Push

### NTF-1 In-app
- **NTF-1.1 — In-app notification center** `[built]` `M` `web`
- **NTF-1.2 — Mark read / read-all** `[built]` `S` `web`
- **NTF-1.3 — Notification types + entity deep-links** `[partial]` `M` `data`
- **NTF-1.4 — Unread badge + polling** `[partial]` `S` `web`

### NTF-2 Preferences
- **NTF-2.1 — Per-type notification preferences** `[new]` `M` `api`
- **NTF-2.2 — Quiet hours / digest settings** `[new]` `M` `api`

### NTF-3 Web push
- **NTF-3.1 — Web push subscription (service worker, VAPID)** `[new]` `L` `web`
- **NTF-3.2 — Web push send pipeline** `[new]` `M` `api` — _deps:_ PLT-3.1

### NTF-4 iOS push
- **NTF-4.1 — iOS push (APNs) registration** `[new]` `M` `ios` — _deps:_ IOS-1.2
- **NTF-4.2 — iOS push send pipeline** `[new]` `M` `api`

### NTF-5 Delivery pipeline
- **NTF-5.1 — Multi-channel dispatch service** `[new]` `M` `api`
- **NTF-5.2 — Digest builder (daily/weekly)** `[new]` `M` `api`
- **NTF-5.3 — Event triggers (new txn, anomaly, bill due)** `[partial]` `M` `api`

---

## IOS — iOS App

### IOS-1 Shell & auth
- **IOS-1.1 — SPIKE: iOS approach (React Native/Expo vs Swift vs PWA)** `[new]` `S` `research`
- **IOS-1.2 — App shell + navigation** `[new]` `L` `ios` — _deps:_ IOS-1.1
- **IOS-1.3 — Clerk auth on iOS** `[new]` `M` `ios` — _skill:_ clerk-cli
- **IOS-1.4 — API client + session** `[new]` `M` `ios`

### IOS-2 Parity screens
- **IOS-2.1 — Dashboard screen** `[new]` `M` `ios`
- **IOS-2.2 — Transactions list + detail** `[new]` `L` `ios`
- **IOS-2.3 — Review queue (native swipe)** `[new]` `L` `ios`
- **IOS-2.4 — Accounts screen** `[new]` `M` `ios`
- **IOS-2.5 — Settings screen** `[new]` `M` `ios`

### IOS-3 Native capabilities
- **IOS-3.1 — Push notifications (APNs)** `[new]` `M` `ios` — _deps:_ NTF-4.1
- **IOS-3.2 — Biometric app lock (FaceID)** `[new]` `M` `ios`
- **IOS-3.3 — Share extension (save receipt to app)** `[new]` `M` `ios` — _deps:_ RCP-1.1
- **IOS-3.4 — Offline read-only cache** `[new]` `L` `ios`

### IOS-4 Distribution
- **IOS-4.1 — TestFlight build + CI** `[new]` `M` `infra`
- **IOS-4.2 — App Store submission prep** `[new]` `S` `infra`

---

_End of v0 baseline. ~300 leaves across 17 epics. Subsequent passes (v1–v8) refine the whole tree per the quality bar in 00-README.md §4._
