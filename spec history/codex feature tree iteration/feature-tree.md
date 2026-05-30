# Cash Lens — Canonical Feature Tree

## 1. North-star product statement

Cash Lens should become a **personal financial operating system**:

- see **net inflow and outflow**
- understand **where every dollar came from and went**
- capture the **reason/tag/context** for each movement
- unify fragmented sources into a **single source of truth**
- enable **true spend**, reimbursements, returns, future obligations, bill tracking, tax context, and smart categorization

The most important product principle is:

> **A transaction is not the same thing as a purchase.**

The bank/card rail tells us that money moved. The app must learn the real-world economic event by joining that movement with receipts, item-level data, reimbursements, returns, bills, invoices, and later corrections.

## 2. Current repo grounding

Verified in the current repo:

- Web app exists with:
  - dashboard
  - accounts
  - transactions
  - settings
  - login / sign-in
- FastAPI backend exists with:
  - `/me`
  - `/dashboard`
  - `/accounts`
  - `/transactions`
  - `/notifications`
  - `/plaid/create-link-token`
  - `/plaid/exchange-public-token`
  - `/plaid/sync-item/{id}`
  - `/plaid/webhook`
- Current core tables exist:
  - `users`
  - `plaid_items`
  - `financial_accounts`
  - `raw_transactions`
  - `ledger_events`
  - `notification_events`
  - `sync_runs`
- Important gaps still exist:
  - no Alembic migrations yet
  - money is still stored as `Float`
  - Plaid is the only provider today
  - no receipt/document ingestion yet
  - no reimbursements / returns / claims / obligations models yet
  - no true production iOS app yet

## 3. Feature tree

## PLT — Platform, environments, jobs, and delivery

### PLT-1. Shared contracts and repo foundation

- **PLT-1.1 — Generate TypeScript API types from FastAPI OpenAPI** [partial] M shared — Make the shared contract generated instead of manually drifting. _deps:_ none. _acceptance:_ A single command regenerates frontend types from backend OpenAPI and CI fails if generated output is stale.
- **PLT-1.2 — Add schema drift check to CI** [new] S shared — Catch backend/frontend contract mismatches before merge. _deps:_ PLT-1.1. _acceptance:_ A backend schema change without regenerated shared types fails CI.
- **PLT-1.3 — Add app-wide feature flag/config registry** [new] M shared — Centralize runtime toggles for staged rollout of risky features. _deps:_ none. _acceptance:_ Web and API both read a typed config surface for environment-specific feature gates.

### PLT-2. Database migrations and data safety

- **PLT-2.1 — Add Alembic baseline for existing schema** [new] L data — Replace ad hoc `create_all` startup behavior with explicit migrations. _deps:_ none. _acceptance:_ A clean database can be created entirely through Alembic upgrade steps.
- **PLT-2.2 — Remove implicit schema creation from app startup** [new] M api — Prevent production schema drift hidden behind app boot. _deps:_ PLT-2.1. _acceptance:_ App startup no longer mutates schema and docs/runbooks point to migrations as the only schema path.
- **PLT-2.3 — Add migration smoke test in CI** [new] S data — Prove upgrades run on a fresh database every PR. _deps:_ PLT-2.1. _acceptance:_ CI boots a temporary database, runs migrations, and fails on broken revisions.

### PLT-3. Async jobs, backfills, and schedulers

- **PLT-3.1 — Define job-dispatch abstraction** [new] M api — Create a provider-neutral job interface for syncs, parsing, and notifications. _deps:_ none. _acceptance:_ API code enqueues work through one local abstraction instead of calling background providers directly.
- **PLT-3.2 — Add inline/local job adapter** [new] S api — Make local dev and tests deterministic without cloud queues. _deps:_ PLT-3.1. _acceptance:_ Local environment can execute enqueued jobs synchronously for tests and smoke flows.
- **PLT-3.3 — Add Cloud Tasks production adapter** [new] M infra — Move deployed async work onto a serverless queue. _deps:_ PLT-3.1. _acceptance:_ A deployed environment can enqueue and execute HTTP task handlers without always-on workers.
- **PLT-3.4 — Add scheduled maintenance endpoints** [new] M api — Expose explicit internal endpoints for nightly syncs, anomaly recompute, and stale-claim sweeps. _deps:_ PLT-3.3. _acceptance:_ Scheduler endpoints exist with authenticated invocation paths and idempotent handlers.

### PLT-4. Environments and release flow

- **PLT-4.1 — Keep staging and production as separate hosted stacks** [partial] M infra — Maintain separate services, secrets, databases, and frontend projects. _deps:_ none. _acceptance:_ Repo docs and workflows describe staging and production as independent environments, not one mutable deploy.
- **PLT-4.2 — Add manual production backend deployment workflow** [partial] M infra — Promote production deliberately rather than automatically from `main`. _deps:_ PLT-4.1. _acceptance:_ GitHub Actions can manually deploy the production backend without touching staging.
- **PLT-4.3 — Add manual production frontend deployment workflow** [partial] M infra — Release the second Vercel project intentionally and independently. _deps:_ PLT-4.1. _acceptance:_ GitHub Actions can manually build and push the production frontend with production-scoped Vercel settings.

## SEC — Security, privacy, and data governance

### SEC-1. Auth and request trust

- **SEC-1.1 — Keep server-verified Clerk bearer auth as the only API identity path** [built] M api — Preserve the no-spoofable-header rule. _deps:_ none. _acceptance:_ Backend rejects requests without a valid Clerk-issued bearer token outside demo mode.
- **SEC-1.2 — Add privileged-action confirmation for disconnect/delete flows** [new] M web/api — Require explicit confirmation before destructive account actions. _deps:_ AUT-3.2, SRC-2.2. _acceptance:_ Disconnecting a provider or deleting a user requires an explicit confirm step and leaves an audit event.
- **SEC-1.3 — Add origin/authorized-party diagnostics page for auth debugging** [new] S web/api — Make production auth misconfiguration easier to debug safely. _deps:_ SEC-1.1. _acceptance:_ A protected diagnostics surface reports whether Clerk token origin checks and app base URL expectations are aligned.

### SEC-2. Secrets and encryption

- **SEC-2.1 — Version encrypted provider credential envelopes** [new] M api/data — Support future key rotation without opaque token blobs. _deps:_ none. _acceptance:_ Stored provider credentials include enough metadata to support decrypt-with-current-or-previous-key logic.
- **SEC-2.2 — Encrypt non-bank sensitive payload pointers at rest** [new] M data — Extend at-rest protection beyond Plaid tokens to document/message references that expose sensitive behavior. _deps:_ SEC-2.1, RCP-1.2, SRC-3.3. _acceptance:_ Sensitive external pointers are stored encrypted and are only decrypted inside server-side handlers.
- **SEC-2.3 — Write a secret-rotation runbook for provider and app keys** [new] S infra — Document how to rotate encryption keys and provider secrets safely. _deps:_ SEC-2.1. _acceptance:_ A non-interactive runbook exists for rotating secrets without orphaning stored data.

### SEC-3. Privacy and user data rights

- **SEC-3.1 — Add user data export endpoint** [new] M api — Let a user export their financial records and connection metadata. _deps:_ LDG-1.2, OWE-1.1, RCP-2.3. _acceptance:_ A user can request a machine-readable export of canonical and source-linked records.
- **SEC-3.2 — Add user data deletion workflow** [new] M api — Support full account teardown with provider token revocation and data purge. _deps:_ AUT-3.2, SRC-2.2. _acceptance:_ Deleting a user queues a full purge workflow and finalizes only after provider credentials and stored data are removed.
- **SEC-3.3 — Redact PII and secrets from logs** [new] M api/infra — Keep operational logs safe for future debugging. _deps:_ none. _acceptance:_ Request, webhook, and parser logs never emit secrets, full token payloads, or unredacted sensitive document content.

### SEC-4. Compliance and research spikes

- **SEC-4.1 — Research Gmail restricted-scope compliance path** [new] S research — Decide whether Gmail ingestion is feasible before committing to it. _deps:_ none. _acceptance:_ A written spike summarizes scopes, verification burden, and whether phase-one Gmail should be metadata-only or deferred.
- **SEC-4.2 — Research SMS/iMessage privacy model** [new] S research — Decide how text-message receipt ingestion can work without over-collecting personal content. _deps:_ none. _acceptance:_ A written spike lists feasible ingestion paths and the privacy/compliance tradeoffs of each.
- **SEC-4.3 — Research sensitive document storage policy** [new] S research — Decide retention and deletion rules for receipts, invoices, and message attachments. _deps:_ RCP-1.2. _acceptance:_ A short policy note defines retention, encryption, and deletion expectations for uploaded or synced documents.

## AUT — Identity, auth, and user/account lifecycle

### AUT-1. User identity model

- **AUT-1.1 — Keep one internal user row per Clerk user** [partial] M api/data — Make local `users` the durable app identity surface. _deps:_ none. _acceptance:_ Every authenticated Clerk user consistently maps to one local row and duplicate creation paths are blocked.
- **AUT-1.2 — Add user preference fields for financial priorities** [new] M data/api — Store the user’s focus areas such as groceries, health, reimbursements, and taxes. _deps:_ ONB-1.3. _acceptance:_ Backend stores and returns structured preference fields that can seed review and reporting defaults.
- **AUT-1.3 — Add timezone, locale, and currency-preference fields** [new] S data/api — Make financial summaries and schedules respect user context. _deps:_ none. _acceptance:_ User settings can persist timezone, locale, and preferred display currency metadata.

### AUT-2. Session and route behavior

- **AUT-2.1 — Preserve Google sign-in through Clerk on web** [partial] M web — Keep OAuth-first sign-in as the default onboarding path. _deps:_ none. _acceptance:_ An unauthenticated user can sign in with Google and land on the dashboard without local demo-mode fallbacks.
- **AUT-2.2 — Add clear signed-out and expired-session UX** [new] M web — Avoid blank screens when auth expires mid-session. _deps:_ AUT-2.1. _acceptance:_ Expired sessions redirect or re-prompt cleanly instead of surfacing generic app failures.
- **AUT-2.3 — Add auth-route coverage tests** [new] S web — Lock in access control on protected pages and API proxy routes. _deps:_ AUT-2.1. _acceptance:_ Automated tests prove authenticated and unauthenticated behavior for dashboard, settings, transactions, and proxy endpoints.

### AUT-3. Account lifecycle and safety rails

- **AUT-3.1 — Add self-serve account deletion UI** [new] M web/api — Let the user intentionally tear down the app account. _deps:_ SEC-3.2. _acceptance:_ Settings exposes a guarded delete flow that queues the real purge job and confirms status.
- **AUT-3.2 — Add session/device history surface** [new] S web/api — Help the user recognize unexpected sign-ins. _deps:_ SEC-1.1. _acceptance:_ A settings page lists recent signed-in devices and timestamps from the app’s own audit surface or Clerk-backed metadata.
- **AUT-3.3 — Add re-auth requirement for destructive actions** [new] M web/api — Require a fresh auth check before deleting the user or severing major connections. _deps:_ AUT-3.1, SEC-1.2. _acceptance:_ High-risk settings actions require a recent verified session before proceeding.

## ONB — Onboarding and first-run experience

### ONB-1. Empty state and orientation

- **ONB-1.1 — Add an empty-state dashboard for users with no connected data** [partial] M web — Replace raw emptiness with a guided first-run state. _deps:_ none. _acceptance:_ A new user sees a clear “connect your first source” dashboard instead of blank summary cards.
- **ONB-1.2 — Add a first-run checklist component** [new] M web — Make setup progress visible and motivating. _deps:_ ONB-1.1. _acceptance:_ New users can see which setup milestones are complete and what the next recommended step is.
- **ONB-1.3 — Capture setup goals and focus areas during onboarding** [new] M web/api — Let the app know whether the user cares most about groceries, health, reimbursements, bills, or taxes. _deps:_ AUT-1.2. _acceptance:_ Onboarding persists structured goals that influence defaults in reporting and review.

### ONB-2. Guided first connection

- **ONB-2.1 — Explain staging vs production data modes in onboarding copy** [new] S web — Prevent accidental use of the wrong environment during testing. _deps:_ PLT-4.1. _acceptance:_ The first connect flow explains what sandbox/staging means and when real credentials should be used.
- **ONB-2.2 — Show post-connect success summary** [new] M web/api — Confirm what the app just imported after a first connection. _deps:_ SRC-2.1, ING-2.1. _acceptance:_ After connecting an institution, the user sees imported account count, initial history status, and next actions.
- **ONB-2.3 — Add unresolved-review reminder after onboarding** [new] S web/api — Nudge the user into the review queue after the first sync. _deps:_ REV-1.2. _acceptance:_ Users with new ambiguous transactions see a clear path into review instead of assuming setup is “done.”

## SRC — Source connections

### SRC-1. Connection framework

- **SRC-1.1 — Add a generic `connections` model above provider-specific records** [new] L data/api — Represent banks, Gmail, manual imports, and future sources consistently. _deps:_ PLT-2.1. _acceptance:_ The app can list all user connections through one normalized table with provider type, status, and capability metadata.
- **SRC-1.2 — Add connection capability metadata** [new] M data/shared — Record what each source can provide: balances, transactions, receipts, invoices, message text, investments, etc. _deps:_ SRC-1.1. _acceptance:_ Connection records declare capabilities that the UI and ingest pipeline can branch on without provider-specific conditionals everywhere.
- **SRC-1.3 — Standardize connect/reconnect/disconnect UI contract** [new] M web/shared — Make every source-management action look and behave consistently. _deps:_ SRC-1.1. _acceptance:_ Each connection surface uses the same action vocabulary, health badges, and confirmation flow.
- **SRC-1.4 — Add provider feasibility spike matrix** [new] S research — Decide which non-Plaid providers are realistic near-term. _deps:_ none. _acceptance:_ A short matrix compares Gmail, Venmo, PayPal, Fidelity/brokerage, manual CSV, and SMS on feasibility, cost, and compliance.

### SRC-2. Plaid bank and card connections

- **SRC-2.1 — Persist richer Plaid item metadata** [partial] M api/data — Store institution display assets, account coverage, and connection health. _deps:_ none. _acceptance:_ Plaid items track enough metadata to power a real connection-management page.
- **SRC-2.2 — Add Plaid connection disconnect flow** [new] M web/api — Let the user remove an institution without deleting unrelated data. _deps:_ SRC-1.3, SEC-1.2. _acceptance:_ A user can disconnect a Plaid item, revoke future syncs, and see retained history behavior explained.
- **SRC-2.3 — Add Plaid item reconnect via update mode** [new] M web/api — Repair broken institutions without nuking historical records. _deps:_ SRC-2.1, ING-2.5. _acceptance:_ A degraded Plaid item can be reconnected under the same logical connection and syncing resumes.
- **SRC-2.4 — Distinguish bank, credit, loan, and investment-style Plaid accounts in UI** [partial] M web/api — Present fragmented money more honestly. _deps:_ LDG-2.3. _acceptance:_ Accounts list and summaries clearly separate cash, credit, liabilities, and investment-like balances.

### SRC-3. Gmail connection

- **SRC-3.1 — Add Gmail connection record and status page** [new] M web/api — Create the surface for Gmail as a first-class source. _deps:_ SEC-4.1, SRC-1.1. _acceptance:_ Settings can show Gmail as a connectable source with status, scopes, and disconnect controls.
- **SRC-3.2 — Add Gmail message pull for receipt/invoice candidates** [new] M api — Fetch a constrained subset of likely receipt/invoice emails. _deps:_ SRC-3.1. _acceptance:_ Backend can ingest candidate message metadata without yet parsing full documents into the ledger.
- **SRC-3.3 — Store raw message metadata and body pointers** [new] M data — Preserve Gmail source truth separately from later extractions. _deps:_ SRC-3.2. _acceptance:_ Messages land in raw storage with provider ids, senders, timestamps, and secure content pointers.
- **SRC-3.4 — Add Gmail disconnect and token revocation flow** [new] M web/api — Let the user sever Gmail safely. _deps:_ SRC-3.1, SEC-1.2. _acceptance:_ Disconnecting Gmail revokes the live connection and marks related raw records as retained-but-disconnected or purge-pending.

### SRC-4. Person-to-person and manual sources

- **SRC-4.1 — Research Venmo import path** [new] S research — Decide whether CSV, email, scraping, or API-like routes are realistic. _deps:_ none. _acceptance:_ A written spike recommends a first Venmo path with explicit tradeoffs.
- **SRC-4.2 — Research PayPal import path** [new] S research — Decide how PayPal transactions can become source truth. _deps:_ none. _acceptance:_ A written spike recommends a first PayPal path with explicit tradeoffs.
- **SRC-4.3 — Add manual CSV import skeleton** [new] M web/api — Provide a fallback source for transactions and settlements before direct integrations exist. _deps:_ SRC-1.1. _acceptance:_ A user can upload a CSV, map required columns, and import staged raw records.
- **SRC-4.4 — Add manual cash / external account entry** [new] M web/api — Let the app track off-network cash, brokerage, or debt accounts. _deps:_ SRC-1.1, LDG-2.3. _acceptance:_ A user can create a manual account and add manual balance or transaction entries without Plaid.

## ING — Ingestion and sync engine

### ING-1. Raw storage and ingestion audit

- **ING-1.1 — Add raw source record tables beyond Plaid transactions** [new] L data — Create durable raw layers for messages, receipts, invoices, and manual imports. _deps:_ PLT-2.1, SRC-3.3, RCP-1.2. _acceptance:_ Every new source type lands first in a provider-specific raw table before canonicalization.
- **ING-1.2 — Add durable webhook event storage** [new] M data/api — Record webhook payloads before processing for replay and audit. _deps:_ PLT-2.1. _acceptance:_ Incoming webhooks are written to a raw event table before business logic runs.
- **ING-1.3 — Add source ingestion run audit model** [new] M data/api — Track every sync, parse, import, and replay as a first-class run. _deps:_ ING-1.1. _acceptance:_ The app can show what source ran, when, how many records changed, and whether retries happened.

### ING-2. Plaid sync correctness

- **ING-2.1 — Separate initial backfill job from incremental sync job** [partial] M api — Distinguish the “first huge import” path from normal refreshes. _deps:_ PLT-3.1. _acceptance:_ Backfill and incremental sync have separate job types, run records, and retry behavior.
- **ING-2.2 — Guarantee idempotent transaction sync by cursor and source ids** [partial] M api — Prevent duplicate application of Plaid updates. _deps:_ ING-2.1. _acceptance:_ Replaying the same sync inputs does not create duplicated raw or canonical records.
- **ING-2.3 — Preserve removed-transaction tombstones** [partial] M api/data — Keep a reversible record when Plaid removes a transaction. _deps:_ ING-2.2. _acceptance:_ Removed transactions are represented as source-truth tombstones and downstream reporting stops counting them.
- **ING-2.4 — Track pending-to-posted transaction transitions** [partial] M api/data — Avoid double-counting a pending card swipe that later posts. _deps:_ ING-2.2. _acceptance:_ Pending and final forms are linked and user-facing history reflects one economic event.
- **ING-2.5 — Add item-level sync state and retry policy** [partial] M api — Make failed items diagnosable and resumable. _deps:_ ING-2.1. _acceptance:_ A broken item records retryable status, last error, and recommended next action.

### ING-3. Backfill controls and observability

- **ING-3.1 — Add backfill progress endpoint** [new] S api — Surface long-running initial sync progress to the UI. _deps:_ ING-2.1, ING-1.3. _acceptance:_ UI can poll a backfill status endpoint and show progress, not just a spinner.
- **ING-3.2 — Add backfill cancel and resume semantics** [new] M api — Let the user stop a problematic historical import and continue later. _deps:_ ING-3.1. _acceptance:_ A backfill can be canceled safely and resumed without losing already-ingested records or double-applying work.
- **ING-3.3 — Add manual replay tools for raw source ingestion** [new] M api — Re-run canonicalization after bug fixes without re-fetching vendor data. _deps:_ ING-1.1, LDG-4.2. _acceptance:_ An internal path can replay selected raw records into canonical projections idempotently.

### ING-4. Reconciliation and operator recovery

- **ING-4.1 — Add account-to-ledger reconciliation checks** [new] M api — Detect when canonical ledger totals drift from trusted account-level movement. _deps:_ LDG-2.1, LDG-4.3. _acceptance:_ The app can compute and flag discrepancies between account snapshots and replayed ledger movement over a period.
- **ING-4.2 — Surface connection-level discrepancy states** [new] M web/api — Turn reconciliation failures into visible repair work instead of silent corruption. _deps:_ ING-4.1, REV-1.2. _acceptance:_ A connection or account can enter a discrepancy state with a visible explanation and next-step action.
- **ING-4.3 — Add operator repair toolkit for one connection** [new] M api — Repair one source without risky whole-database intervention. _deps:_ ING-3.3, ING-4.2. _acceptance:_ Internal tooling can resync, replay, or mark-resolved one connection’s ingestion state with audit history.

## LDG — Ledger core, balances, and money semantics

### LDG-1. Canonical ledger event model

- **LDG-1.1 — Expand ledger event types beyond the current placeholder set** [new] M data — Support purchases, transfers, refunds, reimbursements, bills, fees, tax payments, and income as distinct event types. _deps:_ PLT-2.1. _acceptance:_ Canonical events can express the major economic event families in the product vision without overloading one generic transaction row.
- **LDG-1.2 — Add `ledger_event_sources` join table** [new] M data — Let one canonical event map to multiple raw records across providers. _deps:_ LDG-1.1, ING-1.1. _acceptance:_ A canonical event can point to many source records and reporting always flows through that join.
- **LDG-1.3 — Add review state and confidence to canonical events** [partial] M data — Make downstream queueing and anomaly UX explicit. _deps:_ LDG-1.1. _acceptance:_ Canonical events carry confidence and review state without requiring UI-only heuristics.
- **LDG-1.4 — Add explicit review lifecycle states** [new] M data/api — Prevent future syncs and model suggestions from silently overwriting confirmed human decisions. _deps:_ LDG-1.3, REV-1.1. _acceptance:_ Canonical events and allocations can move through states like `needs_review`, `confirmed`, `locked`, `ignored`, and `superseded`.

### LDG-2. Balances and financial state

- **LDG-2.1 — Add account balance snapshot table** [new] M data — Preserve historical balances for trend views and point-in-time state. _deps:_ PLT-2.1. _acceptance:_ Every sync can append balance snapshots instead of overwriting the only known balance.
- **LDG-2.2 — Capture snapshots on sync and selected manual updates** [new] M api — Feed the new historical-balance surface. _deps:_ LDG-2.1. _acceptance:_ Sync jobs and manual account edits both create timestamped balance snapshots.
- **LDG-2.3 — Add point-in-time cash, credit, liability, and investment aggregations** [new] M api — Answer “what is my financial state right now?” directly. _deps:_ LDG-2.1, SRC-4.4. _acceptance:_ Backend can return categorized balance aggregates for dashboard and reports.
- **LDG-2.4 — Add net worth timeline endpoint** [new] M api — Create the API surface for later charts and iOS parity. _deps:_ LDG-2.3. _acceptance:_ A time-series endpoint returns historical net worth and its major components.
- **LDG-2.5 — Add positions/holdings and liability snapshots model** [new] L data/api — Prepare for brokerage, retirement, and debt state beyond bank balances. _deps:_ LDG-2.1, SRC-4.4. _acceptance:_ The data model can store point-in-time holdings or liabilities separately from cash accounts without overloading transaction rows.

### LDG-3. Money semantics and correctness

- **LDG-3.1 — Improve owned-account transfer detection** [partial] M api — Stop internal moves from pretending to be spend or income. _deps:_ LDG-1.1, SRC-1.2. _acceptance:_ Transfers between owned accounts are recognized and excluded from true-spend reporting by default.
- **LDG-3.2 — Improve credit-card payment detection** [partial] M api — Treat card payments as liability movement, not spending. _deps:_ LDG-3.1. _acceptance:_ Credit-card payments no longer inflate outflow or category spend.
- **LDG-3.3 — Add explicit lifecycle states for pending, posted, reversed, refunded** [new] M data/api — Model financial state changes without abusing booleans. _deps:_ ING-2.4. _acceptance:_ Canonical events can distinguish a posted purchase from a later reversal or refund.
- **LDG-3.4 — Add multi-currency and FX placeholder fields** [new] M data — Avoid painting future non-USD support into a corner. _deps:_ none. _acceptance:_ Ledger and account models can store original currency, display currency, and optional FX normalization fields.

### LDG-4. Data integrity upgrades

- **LDG-4.1 — Preserve append-only raw truth with projection rebuild support** [new] M data/api — Let canonical bugs be fixed by replaying source truth, not mutating away history. _deps:_ ING-3.3. _acceptance:_ Canonical projections can be rebuilt from raw storage without changing original source rows.
- **LDG-4.2 — Add projection idempotency tests** [new] S api — Prove rebuild safety before more providers land. _deps:_ LDG-4.1. _acceptance:_ Automated tests show that replaying the same raw inputs produces the same canonical outputs exactly once.
- **LDG-4.3 — Migrate money fields from `Float` to integer minor units** [new] L data/api/shared — Eliminate binary-floating money bugs. _deps:_ PLT-2.1. _acceptance:_ Stored money is integer minor units with consistent conversion rules at the API boundary.
- **LDG-4.4 — Separate source signed amount from user-facing economic amount** [new] M data/api — Support cases where source direction differs from user-facing meaning. _deps:_ LDG-1.1, LDG-4.3. _acceptance:_ Canonical events can render the right user-perspective amount without rewriting source truth.

## ENR — Enrichment, matching, splitting, and dedup

### ENR-1. Merchant normalization

- **ENR-1.1 — Add merchant alias and normalization table** [new] M data — Give the app a stable merchant identity layer. _deps:_ PLT-2.1. _acceptance:_ Known alias patterns can normalize multiple source names into one merchant identity.
- **ENR-1.2 — Normalize merchant names during ingestion** [new] M api — Apply the alias layer automatically, not only in the UI. _deps:_ ENR-1.1. _acceptance:_ New raw records produce normalized merchant candidates in canonical projections.
- **ENR-1.3 — Add merchant review/edit workflow** [new] M web/api — Let the user correct normalization mistakes and teach the system. _deps:_ ENR-1.1. _acceptance:_ Editing a merchant mapping updates future normalization and preserves an audit trail.

### ENR-2. Cross-source matching

- **ENR-2.1 — Match receipts to bank/card transactions** [new] M api — Join document evidence to the money movement it explains. _deps:_ RCP-2.2, ENR-1.2. _acceptance:_ A receipt can be linked to candidate transactions by merchant/date/amount with confidence.
- **ENR-2.2 — Match reimbursement settlements to claims** [new] M api — Recognize when Venmo, PayPal, or manual inflows settle money owed. _deps:_ OWE-1.1, SRC-4.3. _acceptance:_ Candidate incoming settlements can be attached to outstanding claims.
- **ENR-2.3 — Match refunds to original purchases or return intents** [new] M api — Turn separate refund rows into resolved economic narratives. _deps:_ OWE-2.1, ING-2.4. _acceptance:_ A refund can resolve a planned return or refund anomaly under one canonical explanation.
- **ENR-2.4 — Show match confidence and alternatives in the UI** [new] M web — Make fuzzy matching reviewable instead of invisible magic. _deps:_ ENR-2.1, ENR-2.2, ENR-2.3. _acceptance:_ Users can inspect why a match was proposed and choose a different candidate when needed.
- **ENR-2.5 — Add user-visible provenance trace for one ledger event** [new] M web/api — Answer “where did this conclusion come from?” directly. _deps:_ LDG-1.2, ENR-2.4. _acceptance:_ A user can open one canonical event and see every linked raw source, match reason, rule, and correction that shaped it.

### ENR-3. Dedupe and splitting

- **ENR-3.1 — Add duplicate economic-event detection rules** [new] M api — Catch bank/provider duplicates before they skew reporting. _deps:_ LDG-1.2. _acceptance:_ The system can flag two or more source records as probable duplicates of one economic event.
- **ENR-3.2 — Add one-purchase-many-sources merge model** [new] M data — Represent a purchase enriched by bank, receipt, and reimbursement evidence. _deps:_ LDG-1.2. _acceptance:_ One canonical purchase can legitimately point to several raw inputs without double-counting.
- **ENR-3.3 — Add manual split editor for one transaction to many allocations** [new] L web/api — Let the user separate one Target trip into groceries, health, shared expenses, and planned return. _deps:_ LDG-4.3, RCP-4.2. _acceptance:_ A user can split one purchase into multiple tagged allocations that still reconcile back to the source total.
- **ENR-3.4 — Add no-double-count reporting invariant tests** [new] S api — Protect every future enrichment step from inflating totals. _deps:_ ENR-3.1, ENR-3.2, ENR-3.3. _acceptance:_ Reporting tests prove that matched or split transactions still roll up to correct totals.

## RCP — Receipts, invoices, and itemization

### RCP-1. Receipt capture and storage

- **RCP-1.1 — Add manual receipt upload flow** [new] M web/api — Let the user attach receipts before Gmail or SMS ingestion exists. _deps:_ none. _acceptance:_ A user can upload a receipt file and see it appear in a receipts list.
- **RCP-1.2 — Add receipt document storage pointer model** [new] M data/api — Store files safely without bloating primary rows. _deps:_ PLT-2.1. _acceptance:_ Uploaded receipt metadata points to a storage location and retains provider-independent document identity.
- **RCP-1.3 — Add receipts list and detail screen** [new] M web — Give the user a place to inspect and review documents. _deps:_ RCP-1.1, RCP-1.2. _acceptance:_ The app exposes a searchable list of receipts and a detail screen showing parse and match status.

### RCP-2. Parsing and extraction

- **RCP-2.1 — Research OCR/parser vendor strategy** [new] S research — Decide whether to use OCR-only, structured LLM parsing, or a hybrid. _deps:_ none. _acceptance:_ A spike recommends a first parser path with cost, latency, and auditability tradeoffs.
- **RCP-2.2 — Extract merchant/date/total/tax/tip from receipts** [new] M api — Land the first useful structured document parse. _deps:_ RCP-2.1, RCP-1.2. _acceptance:_ Uploaded receipts produce a basic parsed record with confidence fields and parse status.
- **RCP-2.3 — Add line-item extraction table** [new] M data/api — Make itemization a first-class model instead of a blob. _deps:_ RCP-2.2. _acceptance:_ Parsed receipts can store individual line items with quantity, unit price, and category hints.
- **RCP-2.4 — Add parser confidence and review-needed state** [new] M data/web — Route imperfect extractions into review instead of pretending they are final. _deps:_ RCP-2.2, REV-1.2. _acceptance:_ Low-confidence parses automatically appear in the review queue with the right action set.

### RCP-3. Invoices and bill documents

- **RCP-3.1 — Detect invoice-like Gmail messages** [new] M api — Pull bill-like source truth out of mail before money moves. _deps:_ SRC-3.2. _acceptance:_ Gmail ingestion can flag invoice candidates with sender, due-date, and amount hints.
- **RCP-3.2 — Add invoice model with issuer, amount, due date, and status** [new] M data — Treat invoices as future obligations, not just emails. _deps:_ RCP-3.1, OWE-3.1. _acceptance:_ Invoice records can exist before payment and later link to ledger events.
- **RCP-3.3 — Add invoice review and link-to-ledger flow** [new] M web/api — Let the user confirm which invoice became which payment. _deps:_ RCP-3.2, ENR-2.1. _acceptance:_ An invoice can be reviewed, matched to a payment, and resolved as paid or still due.

### RCP-4. Itemization UX

- **RCP-4.1 — Add line-item editor** [new] M web — Let the user fix parsed receipts manually. _deps:_ RCP-2.3. _acceptance:_ Users can add, edit, delete, and rename line items on a receipt.
- **RCP-4.2 — Link line items to ledger allocations** [new] M web/api — Bridge receipt details to actual spending allocations. _deps:_ ENR-3.3, RCP-4.1. _acceptance:_ One line item or line-item group can map to one allocation in the canonical purchase split.
- **RCP-4.3 — Add grocery and health subtype pickers at line-item level** [new] M web/api — Support macro and health deep-dives beyond coarse categories. _deps:_ CAT-1.2, RCP-4.2. _acceptance:_ Individual items can be tagged as produce/protein or glasses/derm/psych and roll up correctly in reports.

## CAT — Categorization, taxonomy, rules, and LLM assist

### CAT-1. Taxonomy and dimensions

- **CAT-1.1 — Add multi-dimensional categories model** [new] M data — Move beyond one giant flat category string. _deps:_ PLT-2.1. _acceptance:_ Categories can support high-level domains, subdomains, and orthogonal tags without awkward string parsing.
- **CAT-1.2 — Seed domain-specific subcategories for groceries, health, bills, taxes** [new] M data — Build the taxonomy the product thesis actually needs. _deps:_ CAT-1.1. _acceptance:_ The seeded taxonomy includes grocery, health, bill-pay, tax, reimbursement, and transfer-specific structures.
- **CAT-1.3 — Add free-form tags and tag groups** [new] M data/api — Let the user annotate intent outside the category tree. _deps:_ CAT-1.1. _acceptance:_ Transactions and allocations can carry multiple tags like `roommate split`, `planned return`, or `tax-deductible candidate`.
- **CAT-1.4 — Add structured “reason” field on allocations** [new] M data/api — Capture why a dollar was spent, not only what broad bucket it belongs to. _deps:_ ENR-3.3, CAT-1.1. _acceptance:_ Allocations can store a user-visible reason or memo that survives reporting and review.

### CAT-2. Manual categorization workflows

- **CAT-2.1 — Improve single-transaction category editing** [partial] M web/api — Make manual correction fast enough to become a habit. _deps:_ CAT-1.1. _acceptance:_ Editing category, subcategory, tags, and exclusion flags for one transaction is fast and reliable.
- **CAT-2.2 — Add bulk categorization and tagging** [new] M web/api — Let the user fix dozens of similar transactions at once. _deps:_ CAT-2.1. _acceptance:_ User can multi-select transactions and apply category/tag changes in one action.
- **CAT-2.3 — Show merchant category history when editing** [new] S web/api — Use prior choices as context for new corrections. _deps:_ ENR-1.3. _acceptance:_ The category editor can surface past decisions for the same merchant or rule candidate.

### CAT-3. Rules engine

- **CAT-3.1 — Add user rule model and priority ordering** [new] M data — Store user-authored categorization and tagging logic explicitly. _deps:_ CAT-1.1. _acceptance:_ Users can own ordered rules with match criteria and actions.
- **CAT-3.2 — Evaluate rules during canonicalization** [new] M api — Apply learned logic automatically on new records. _deps:_ CAT-3.1, LDG-1.1. _acceptance:_ New canonical events can be auto-tagged or categorized by stored rules.
- **CAT-3.3 — Create a rule from a manual correction** [new] M web/api — Convert repeated cleanup into reusable automation. _deps:_ CAT-3.1, CAT-2.1. _acceptance:_ After editing a transaction, the user can promote that edit into a future rule.
- **CAT-3.4 — Add rule preview/test mode** [new] M web/api — Make rule edits safe and reviewable. _deps:_ CAT-3.2. _acceptance:_ Users can see which existing events a proposed rule would change before saving it.

### CAT-4. LLM-assisted categorization

- **CAT-4.1 — Define structured categorization suggestion schema** [new] M shared/api — Keep model output machine-usable and auditable. _deps:_ CAT-1.2. _acceptance:_ LLM categorization uses a typed JSON contract that names category, tags, reason, and confidence.
- **CAT-4.2 — Queue low-confidence or uncategorized events for LLM suggestion** [new] M api — Use models where they create leverage, not everywhere. _deps:_ CAT-4.1, PLT-3.1. _acceptance:_ Eligible events can receive asynchronous LLM suggestions without blocking core ingestion.
- **CAT-4.3 — Store model input/output/version audit trail** [new] M data — Make smart categorization explainable and replayable. _deps:_ CAT-4.2. _acceptance:_ Every suggestion stores enough metadata to answer “why did the model say this?”
- **CAT-4.4 — Add accept/reject/override UI for LLM suggestions** [new] M web — Keep the human in the loop. _deps:_ CAT-4.3, REV-2.2. _acceptance:_ Users can review, accept, reject, or override suggestions and the result updates the canonical record.
- **CAT-4.5 — Learn from user corrections into rules or prompt context** [new] M api — Make the app smarter over time instead of statelessly guessing. _deps:_ CAT-3.3, CAT-4.4. _acceptance:_ Accepted and rejected suggestions influence future automation through explicit stored learning paths.
- **CAT-4.6 — Add categorization explanation drill-down** [new] M web/api — Expose the exact rule, merchant memory, or model reasoning behind a category decision. _deps:_ CAT-4.3, ENR-2.5. _acceptance:_ A user can inspect why a category was applied and what evidence chain produced it.

## OWE — Reimbursements, returns, bills, and obligations

### OWE-1. Reimbursements and money owed

- **OWE-1.0 — Add counterparties model** [new] M data/api — Represent people and entities involved in reimbursements and shared spend. _deps:_ PLT-2.1. _acceptance:_ Claims and allocations can reference a structured counterparty record instead of only free text.
- **OWE-1.1 — Add reimbursement claim model** [new] M data — Represent money other people owe the user. _deps:_ PLT-2.1, LDG-1.1. _acceptance:_ Claims can store counterparty, expected amount, due date, source allocation, and status.
- **OWE-1.2 — Create claim from split allocation** [new] M web/api — Turn shared spending into a trackable receivable in one step. _deps:_ ENR-3.3, OWE-1.0, OWE-1.1. _acceptance:_ A user can mark part of a split purchase as owed by another person and generate a claim immediately.
- **OWE-1.3 — Support partial settlements and claim history** [new] M api/data — Handle real-world staggered payback instead of only all-or-nothing reimbursement. _deps:_ OWE-1.1. _acceptance:_ Claims can track multiple partial settlements and remaining balance correctly.
- **OWE-1.4 — Add receivables summary widget** [new] M web/api — Surface “money I am owed” on the dashboard. _deps:_ OWE-1.3. _acceptance:_ Dashboard and reports can show total outstanding receivables and aging buckets.

### OWE-2. Returns and refunds

- **OWE-2.1 — Add return-intent model** [new] M data — Treat “I plan to return this” as a real tracked state. _deps:_ ENR-3.3. _acceptance:_ Return intents store original allocation, expected refund amount, date, and resolution status.
- **OWE-2.2 — Create return intent from transaction or line item** [new] M web/api — Let the user flag a future refund before it happens. _deps:_ OWE-2.1, RCP-4.2. _acceptance:_ A user can mark a purchase or item as planned return and see it on an upcoming-return list.
- **OWE-2.3 — Match refund to return intent automatically** [new] M api — Resolve return tracking when the money comes back. _deps:_ OWE-2.1, ENR-2.3. _acceptance:_ Matching refunds close the related return intent automatically with preserved audit trail.
- **OWE-2.4 — Flag stale or missing refunds** [new] M api/ntf — Catch returns that never actually refunded. _deps:_ OWE-2.3, INT-2.2. _acceptance:_ Old unresolved return intents generate anomalies and notifications.

### OWE-3. Bills and future obligations

- **OWE-3.1 — Add bill/obligation model** [new] M data — Track upcoming bills before the transaction exists. _deps:_ PLT-2.1. _acceptance:_ Bills can store merchant, amount, due date, cadence, status, and optional source invoice/recurring stream linkage.
- **OWE-3.2 — Create bills from invoices or recurring streams** [new] M api — Turn detected future obligations into actionable items. _deps:_ RCP-3.2, INT-1.3. _acceptance:_ Bill records can be generated from invoices or recurring streams with confidence and review state.
- **OWE-3.3 — Add upcoming obligations list and summary** [new] M web/api — Answer “what is about to hit me?” clearly. _deps:_ OWE-3.1. _acceptance:_ User can view upcoming bills and other obligations ordered by due date and amount.
- **OWE-3.4 — Mark obligations paid from matched ledger events** [new] M api — Close the loop from planned obligation to actual payment. _deps:_ OWE-3.1, LDG-1.2. _acceptance:_ A bill is automatically or manually marked paid when a matching ledger event arrives.

### OWE-4. Credit and tax obligations

- **OWE-4.1 — Add credit-card liability summary model** [new] M api — Represent what is owed on cards separately from ordinary outflow. _deps:_ LDG-2.3. _acceptance:_ App can summarize outstanding card liabilities and due-soon payment amounts.
- **OWE-4.2 — Add tax obligation placeholder model** [new] M data/api — Prepare for quarterly tax tracking without requiring a full tax engine yet. _deps:_ CAT-1.2. _acceptance:_ User can store expected tax obligations and later reconcile actual payments against them.
- **OWE-4.3 — Add tax payment reconciliation view** [new] M web/api — Compare estimated vs actual tax-related cash movement. _deps:_ OWE-4.2, RPT-4.1. _acceptance:_ Reports can show tax obligations, tax payments, and current surplus/deficit.
- **OWE-4.4 — Add credit-card statement semantics** [new] M data/api — Track statement balance, due date, and autopay state separately from generic bills. _deps:_ OWE-4.1, OWE-3.1. _acceptance:_ Credit-card obligations can distinguish current balance from statement balance and upcoming due amount.

## INT — Intelligence: recurring detection, prediction, anomaly

### INT-1. Recurring streams

- **INT-1.1 — Add heuristic recurring detector** [new] M api — Detect likely subscriptions and bills without paying for extra vendor products first. _deps:_ LDG-1.1. _acceptance:_ Backend can group likely recurring charges by merchant, amount band, and cadence with confidence.
- **INT-1.2 — Add recurring stream model** [new] M data — Store the recurring objects the detector finds. _deps:_ INT-1.1. _acceptance:_ Recurring streams can persist expected amount, cadence, next date, and status.
- **INT-1.3 — Add recurring stream review UI** [new] M web — Let the user confirm or reject the app’s guess. _deps:_ INT-1.2, REV-2.2. _acceptance:_ A user can approve, reject, or pause recurring streams from a dedicated review surface.
- **INT-1.4 — Mark recurring streams paused, canceled, or changed** [new] M web/api — Support the real lifecycle of bills and subscriptions. _deps:_ INT-1.3. _acceptance:_ Users can explicitly change recurring-stream status and later reports respect it.

### INT-2. Anomaly detection

- **INT-2.1 — Detect duplicate charge candidates** [new] M api — Flag cases where the same merchant/amount likely hit twice. _deps:_ ENR-3.1. _acceptance:_ The app produces duplicate-charge anomalies with confidence and supporting evidence.
- **INT-2.2 — Detect changed recurring charges and missed expected reversals** [new] M api — Catch common “forgotten subscription” and “why didn’t I get refunded?” cases. _deps:_ INT-1.2, OWE-2.4. _acceptance:_ Anomalies appear when recurring charges change materially or expected refunds never arrive.
- **INT-2.3 — Detect unrecognized or first-seen merchants** [new] M api — Surface surprising spending quickly. _deps:_ ENR-1.1. _acceptance:_ New or low-confidence merchants can trigger a review/anomaly event instead of silently blending in.
- **INT-2.4 — Detect unusual category spend spikes** [new] M api — Highlight when grocery, health, or other priority buckets jump unexpectedly. _deps:_ CAT-1.2, RPT-2.1. _acceptance:_ The app can flag a category-level spike compared with recent baseline behavior.

### INT-3. Prediction and explanation

- **INT-3.1 — Predict next bill dates and amounts** [new] M api — Estimate near-future obligations from recurring patterns. _deps:_ INT-1.2. _acceptance:_ The app can forecast the next expected occurrence for confirmed recurring streams.
- **INT-3.2 — Project short-term cash outflow and runway** [new] M api — Turn balances plus obligations into “what happens next?” insight. _deps:_ LDG-2.3, OWE-3.1, INT-3.1. _acceptance:_ Backend can estimate near-term projected outflow and available runway.
- **INT-3.3 — Generate “why did spending change?” explanations** [new] M api — Summarize the real drivers of month-over-month changes. _deps:_ RPT-2.1, CAT-4.3. _acceptance:_ App can explain which categories, merchants, reimbursements, returns, or bills changed a period summary.

### INT-4. Evaluation and regression harnesses

- **INT-4.1 — Create golden-set fixtures for categorization and matching** [new] M api/data — Make intelligence features measurable instead of purely subjective. _deps:_ CAT-4.1, ENR-2.1. _acceptance:_ Repo includes representative golden examples for categorization, matching, and recurring detection regression checks.
- **INT-4.2 — Add confidence calibration reports for model/rule outputs** [new] M api — Help decide where automation is safe and where review is required. _deps:_ CAT-4.3, INT-4.1. _acceptance:_ An internal report can show how often suggestions at each confidence band are accepted or corrected.
- **INT-4.3 — Add recurring/anomaly regression scoring job** [new] M api — Prevent future detector changes from silently getting worse. _deps:_ INT-1.1, INT-2.1, INT-4.1. _acceptance:_ A repeatable job scores detector output against saved examples and flags regressions.

## RPT — Analytics, cash-flow, and reporting

### RPT-1. Dashboard and summary cards

- **RPT-1.1 — Separate gross inflow/outflow from true spend on the dashboard** [partial] M api/web — Show raw movement and corrected economic meaning side by side. _deps:_ LDG-3.1, LDG-3.2. _acceptance:_ Dashboard distinguishes gross outflow from true spend and identifies what was excluded.
- **RPT-1.2 — Add money-owed and money-owing summary cards** [new] M web/api — Surface receivables and obligations as first-class financial state. _deps:_ OWE-1.4, OWE-3.3. _acceptance:_ Dashboard can show money owed to the user and money due soon from the user.
- **RPT-1.3 — Add investment, liability, and net-worth summary cards** [new] M web/api — Reflect fragmented money beyond checking and cards. _deps:_ LDG-2.3, SRC-4.4. _acceptance:_ Dashboard summarizes non-cash assets and liabilities in addition to cash and credit.

### RPT-2. Spending analysis

- **RPT-2.1 — Add category spend over time view** [new] M web/api — Show how much money goes where by period. _deps:_ CAT-1.2, LDG-4.3. _acceptance:_ Reports can show periodized spend by category and subcategory.
- **RPT-2.2 — Add merchant spend leaderboard** [new] M web/api — Answer “who did I actually pay most?” _deps:_ ENR-1.2. _acceptance:_ Reports can rank merchant spend with drill-through to transactions and allocations.
- **RPT-2.3 — Add grocery and health deep-dive reports** [new] M web/api — Support the user’s macro and health spend questions. _deps:_ RCP-4.3. _acceptance:_ Reports can break down groceries and health spend into meaningful subtypes.
- **RPT-2.4 — Add reimbursable vs true-personal spend view** [new] M web/api — Separate fronted/shared spend from personal consumption. _deps:_ OWE-1.1, ENR-3.3. _acceptance:_ Reports can exclude or isolate reimbursable/shared allocations from personal spend.

### RPT-3. Cash flow and balance history

- **RPT-3.1 — Add monthly inflow/outflow waterfall** [new] M web/api — Explain how cash moved over a period by type. _deps:_ LDG-1.1. _acceptance:_ Report shows inflow and outflow broken down into meaningful event categories, not just one total.
- **RPT-3.2 — Add account balance timeline** [new] M web/api — Show how balances evolved over time. _deps:_ LDG-2.1. _acceptance:_ User can graph one or more account balance histories.
- **RPT-3.3 — Add net worth trend line** [new] M web/api — Bring fragmented money together visually. _deps:_ LDG-2.4. _acceptance:_ User can see net worth and its major components across time periods.

### RPT-4. Tax and exports

- **RPT-4.1 — Add tax-related transaction filters and report** [new] M web/api — Surface tax-relevant cash movement without pretending to be tax software. _deps:_ CAT-1.2, OWE-4.2. _acceptance:_ User can filter and report transactions/allocations tagged as tax-relevant.
- **RPT-4.2 — Add CSV export for transactions, claims, and obligations** [new] M web/api — Let the user take data elsewhere when needed. _deps:_ SEC-3.1. _acceptance:_ User can export canonical records and supporting statuses to CSV.
- **RPT-4.3 — Add accountant-ready ledger snapshot export** [new] M web/api — Make month-end or tax-prep handoff easier. _deps:_ RPT-4.1, LDG-1.2. _acceptance:_ User can export a period snapshot that includes normalized event, category, tags, and linked status fields.

## REV — Review queue / Tinder-style workflows

### REV-1. Queue construction

- **REV-1.1 — Add review-reason codes** [new] M data — Explain why an event needs a human. _deps:_ LDG-1.3. _acceptance:_ Events can be queued for specific reasons like uncategorized, possible duplicate, low-confidence receipt parse, new merchant, or unresolved refund.
- **REV-1.2 — Add review queue builder service** [new] M api — Materialize the queue from the current state of records. _deps:_ REV-1.1. _acceptance:_ Backend can return a stable prioritized review queue built from reason codes and confidence rules.
- **REV-1.3 — Add queue counts and badges in navigation** [new] S web — Make review debt visible but not overwhelming. _deps:_ REV-1.2. _acceptance:_ Shell can show how many review items are waiting and link directly into them.

### REV-2. Swipe and card review UX

- **REV-2.1 — Add swipe-card shell for review** [new] M web — Create the Tinder-style interaction model the user wants. _deps:_ REV-1.2. _acceptance:_ A review page can display one actionable card at a time with stacked context.
- **REV-2.2 — Add card actions for confirm, split, reimburse, return, categorize, snooze** [new] L web/api — Make one-card review do real work. _deps:_ REV-2.1, ENR-3.3, OWE-1.2, OWE-2.2, CAT-2.1. _acceptance:_ A review card can execute the core resolution actions without forcing a full page edit flow.
- **REV-2.3 — Add keyboard shortcuts and quick actions** [new] M web — Optimize desktop review speed. _deps:_ REV-2.2. _acceptance:_ Most review actions can be completed from the keyboard with visible shortcut hints.
- **REV-2.4 — Add undo for last review action** [new] M web/api — Make fast review safer. _deps:_ REV-2.2. _acceptance:_ User can undo the last queue action and the record state rolls back safely.

### REV-3. Bulk review workflows

- **REV-3.1 — Add table-based bulk review for desktop** [new] M web — Complement swipe cards with higher-throughput workflows. _deps:_ REV-1.2, CAT-2.2. _acceptance:_ User can batch-resolve many similar review items in a list view.
- **REV-3.2 — Add needs-review filters to the transactions page** [new] M web — Keep review integrated with ordinary browsing. _deps:_ REV-1.1. _acceptance:_ Transactions page can filter and sort by review state and review reason.
- **REV-3.3 — Add batch accept/reject for model suggestions** [new] M web/api — Make LLM assist scalable instead of noisy. _deps:_ CAT-4.4. _acceptance:_ User can accept or reject many similar model suggestions at once.

## NAV — Navigation, shell, search, and saved views

### NAV-1. App shell and routing

- **NAV-1.1 — Add global command/search palette** [new] M web — Make power-user navigation and lookup fast. _deps:_ none. _acceptance:_ User can search merchants, accounts, reports, receipts, and actions from one command surface.
- **NAV-1.2 — Add deep links for accounts, merchants, claims, recurring streams, and receipts** [new] M web/api — Make future alerts and reports navigable. _deps:_ OWE-1.1, INT-1.2, RCP-1.3. _acceptance:_ Core entities have stable route patterns and can be linked from notifications and reports.
- **NAV-1.3 — Add saved filters and custom views** [new] M web/api — Let the user return to favorite slices like “health this month” or “unpaid claims.” _deps:_ RPT-2.1, REV-3.2. _acceptance:_ User can save and reuse named filter sets across transactions and reports.

### NAV-2. Information architecture

- **NAV-2.1 — Add dedicated Reports section** [new] S web — Separate summary analytics from day-to-day transaction browsing. _deps:_ RPT-1.1. _acceptance:_ App shell includes a Reports area with its own sub-navigation.
- **NAV-2.2 — Add dedicated Review section** [new] S web — Give review workflow a first-class home. _deps:_ REV-1.2. _acceptance:_ App shell includes a Review area distinct from general transaction history.
- **NAV-2.3 — Add dedicated Receipts and Documents section** [new] S web — Make non-bank source truth visible. _deps:_ RCP-1.3. _acceptance:_ App shell includes a place to browse receipts, invoices, and document-linked states.

### NAV-3. Settings and preferences

- **NAV-3.1 — Expand connection management section** [partial] M web — Make connected-source lifecycle management explicit. _deps:_ SRC-1.3. _acceptance:_ Settings shows every source with health, reconnect, disconnect, and sync actions.
- **NAV-3.2 — Add privacy/export/data controls section** [new] M web — Centralize account deletion, exports, and retention-related actions. _deps:_ SEC-3.1, SEC-3.2. _acceptance:_ Settings exposes privacy and data-management actions in one dedicated area.
- **NAV-3.3 — Add notification and review preference settings** [partial] M web/api — Let the user tune noise and queue behavior. _deps:_ NTF-1.1, ONB-1.3. _acceptance:_ Settings can store notification severity preferences and review defaults tied to user goals.

## NTF — Notifications and push

### NTF-1. In-app notifications

- **NTF-1.1 — Add notification preference model** [new] M data/api — Store what the user wants to hear about and at what urgency. _deps:_ PLT-2.1. _acceptance:_ Backend can persist notification preferences by event family and delivery channel.
- **NTF-1.2 — Expand notification types beyond sync events** [partial] M api — Cover anomalies, reimbursements, missing refunds, and bills due. _deps:_ INT-2.1, OWE-1.3, OWE-2.4, OWE-3.3. _acceptance:_ The notification system can emit the major event types promised by the product vision.
- **NTF-1.3 — Add drill-down links from notifications** [new] S web — Make alerts actionable, not just decorative. _deps:_ NAV-1.2. _acceptance:_ Clicking a notification lands the user on the precise entity or filtered view that needs attention.

### NTF-2. Web and mobile push groundwork

- **NTF-2.1 — Add push-device registration model** [new] M data/api — Represent browser or mobile push endpoints in one place. _deps:_ PLT-2.1. _acceptance:_ User devices can register push targets with platform metadata and status.
- **NTF-2.2 — Research mobile push delivery path** [new] S research — Decide between native APNs orchestration, third-party provider, or hybrid. _deps:_ IOS-1.1. _acceptance:_ A short spike recommends the first production-worthy push path for iOS.
- **NTF-2.3 — Add browser push opt-in prototype** [new] M web/api — Test whether lightweight web push is worth shipping before native app parity. _deps:_ NTF-2.1. _acceptance:_ A signed-in browser can opt into push and receive one safe test notification.

## IOS — iOS app

### IOS-1. Architecture and bootstrap

- **IOS-1.1 — Choose iOS client architecture** [new] S research — Decide whether the app should be SwiftUI-native, a thin wrapper, or another approach. _deps:_ none. _acceptance:_ A short spike records the architecture choice and why it best fits the current web-first repo.
- **IOS-1.2 — Define shared API auth contract for iOS** [new] M shared/api — Make mobile auth use the same server-trust model as web. _deps:_ AUT-2.1, SEC-1.1. _acceptance:_ iOS client auth flow is documented and testable against the existing backend bearer-token expectations.
- **IOS-1.3 — Bootstrap iOS project and sign-in shell** [new] L ios — Create the first real mobile app target. _deps:_ IOS-1.1, IOS-1.2. _acceptance:_ A signed-in iOS shell can authenticate and reach a protected “me/dashboard” surface.

### IOS-2. Navigation and parity screens

- **IOS-2.1 — Add tab bar and app shell for Dashboard, Accounts, Transactions, Review, Settings** [new] M ios — Mirror the core web information architecture. _deps:_ IOS-1.3. _acceptance:_ iOS app has a stable tabbed shell covering the product’s main daily surfaces.
- **IOS-2.2 — Add dashboard summary screen** [new] M ios — Bring core financial-state visibility to mobile. _deps:_ IOS-2.1, RPT-1.1. _acceptance:_ iOS dashboard can render the core summary cards from shared backend endpoints.
- **IOS-2.3 — Add accounts list/detail and transaction list/detail screens** [new] L ios — Reach functional parity on read-heavy core screens. _deps:_ IOS-2.1. _acceptance:_ iOS can browse accounts and transactions with filters and detail views.
- **IOS-2.4 — Add review queue swipe screen** [new] L ios — Bring the Tinder-style review loop to the platform where it fits naturally. _deps:_ REV-2.2, IOS-2.1. _acceptance:_ iOS review flow supports the core resolution actions on touch-first cards.

### IOS-3. Native integrations

- **IOS-3.1 — Add Plaid Link / connect flow on iOS** [new] L ios — Let the mobile app connect sources directly when appropriate. _deps:_ IOS-1.2, SRC-2.1. _acceptance:_ iOS user can launch Plaid Link and complete the same backend exchange flow as web.
- **IOS-3.2 — Add secure token/session storage on device** [new] M ios — Keep sessions durable without leaking secrets. _deps:_ IOS-1.3. _acceptance:_ The iOS app can persist and restore auth state using secure on-device storage.
- **IOS-3.3 — Add receipt upload from camera, photo library, and files** [new] L ios — Make document capture much easier on mobile. _deps:_ RCP-1.1, IOS-2.1. _acceptance:_ iOS user can create a receipt record by taking or selecting a photo/document.
- **IOS-3.4 — Add push-notification tap routing** [new] M ios — Make mobile alerts land on the right screen. _deps:_ NTF-2.1, IOS-2.1. _acceptance:_ Opening a push notification routes to the correct claim, anomaly, transaction, or review item.
