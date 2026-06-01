# Cash Lens — Feature Tree (canonical)

Version: **v2** · See [00-README.md](00-README.md) for vision, conventions, legend, and the iteration protocol.
Leaf format: `**ID — Title** [status] size layer — scope.`
followed by an optional compact sub-line of `_deps:_ … · _skill:_ … · _data:_ … · _accept:_ … · _test:_ … · _xc:_ … · _risk:_ …`
Status `[built]`/`[partial]`/`[new]` · size `S`/`M`/`L` · layer `api·web·ios·infra·data·shared·research`.

Sub-field legend (added v1):
- `_deps:_` upstream leaf IDs that must land first. **(v2: pruned to direct/non-transitive edges; graph verified acyclic — 0 cycles, 0 dangling.)**
- `_skill:_` repo/vendor skill an implementer invokes (see README §7).
- `_data:_` concrete schema/endpoint/shared-type delta (grounded in real `models.py`/`schemas.py`/`api-types`). **(v2: unique keys + indexes named where idempotency/query perf depends on them.)**
- `_accept:_` one-line acceptance criterion (the observable that proves it works).
- `_test:_` proving test layer — `pytest` (api), `vitest` (web unit), `playwright` (e2e), or `manual`/`doc`. **(v2: wedge leaves cite a named golden fixture + invariant.)**
- `_xc:_` cross-cutting reqs honored: `authz` (server-verified row-scoped identity), `crypto` (encrypted at rest), `idem` (idempotent/replay-safe), `rate` (rate-limited), `a11y`, `money` (integer minor units), `obs` (observability/metrics).
- `_risk:_` only on risky/ambiguous/spike leaves — risk + one-line mitigation. **(v2: every `research` spike now carries `_cost:_` $ estimate + `_decide-by:_` exit criterion/timebox.)**
- `_cost:_` / `_decide-by:_` (v2) — rough $ / vendor-spend estimate and the decision deadline + crisp exit criterion for `research` spikes only.

> **Golden fixtures (shared test corpus, defined once, reused across wedge leaves):**
> - `GF-DEDUP` — 1 purchase ($42.17) seen via bank + Venmo + email receipt → exactly **1** canonical purchase counted once.
> - `GF-TRANSFER` — checking −$500 out + savings +$500 in within 3 days → 1 confirmed transfer pair, both legs excluded from true-spend.
> - `GF-CARDPAY` — checking →card payment −$1,200 + card statement credit → excluded; underlying card purchases still counted.
> - `GF-TRUESPEND` — mixed month: 20 purchases, 2 transfers, 1 card payment, 1 refund → true-spend = Σout − transfers − card-payments − excluded − refunds.
> - `GF-RECURRING` — 13 monthly Netflix charges (one a $2 price hike) → 1 stream, monthly cadence, price-change flagged.
> - `GF-SPLIT` — $90 dinner split 3 ways → child splits sum to parent; 2 marked receivable → 2 receivables of $30.
> - `GF-MONEY` — float amounts incl. `19.99`, `0.1+0.2`, `-0.005` → integer-minor backfill exact & re-runnable (replay = no-op).
> - `GF-REPLAY` — re-running any ingest/derivation/backfill twice yields **zero** row delta on the 2nd run.
> **First-10-PR starter slice (critical path):** PLT-2.1 → PLT-2.2 → SEC-1.1 → SEC-1.3 → SEC-1.2 → LDG-4.3 → SRC-1.2 → CAT-1.1 → ENR-2.1 → REV-1.1. Rationale: migrations + server-verified auth + encrypted tokens + integer money are the foundation every data leaf depends on; taxonomy + matching framework + queue unlock the wedge.
> **Critical path (longest dependency chain to the wedge):** PLT-2.1 → LDG-4.3 → LDG-4.4 → ENR-2.1 → ENR-2.6 → ENR-3.1 → ENR-3.4 (deduped true-spend). Parallel foundation chain: PLT-2.1 → SEC-3.5/SRC-1.2; auth chain: SEC-1.1 → SEC-1.2 → AUT-3.1. Resolve spikes **AUT-5.1, SRC-1.5, IOS-1.1** before their dependents (they gate re-scoping / provider / stack choices).
> **Phase rollup:** P0 Foundation (PLT-2, SEC-1, LDG-4.3/4.4, AUT-1/2, AUT-5.1 spike) · P1 Source+Ingest (SRC-1/2, ING-1/2/3) · P2 Ledger+Cat (LDG-1/2/3, CAT-1/3/4) · P3 Wedge (ENR, RCP, OWE) · P4 Intelligence+Reports (INT, RPT) · P5 Review+Nav+Notif (REV, NAV, NTF) · P6 iOS (IOS). Cross-phase: PLT-8 Performance & scale spans P1–P4.

---

## PLT — Platform, Environments & Delivery

### PLT-1 Local dev & demo
- **PLT-1.1 — One-command local stack** `[partial]` `M` `infra` — `make dev` boots api + web + db in demo mode.
  _accept:_ `make dev` brings up api+web+Postgres and `/health` is green within 60s. _test:_ doc + smoke script. _xc:_ obs.
- **PLT-1.2 — Idempotent demo workspace seed/reset** `[built]` `S` `api` — reseed without duplicating rows.
  _skill:_ db-evolution · _accept:_ running seed twice yields identical row counts (upsert by external id). _test:_ pytest (re-run count assert). _xc:_ idem.
- **PLT-1.3 — Local Postgres parity (docker-compose)** `[partial]` `S` `infra` — match Neon locally, not just SQLite.
  _accept:_ test suite passes on Postgres 16 container identical to Neon major. _test:_ pytest in CI matrix.

### PLT-2 Migrations & schema management
- **PLT-2.1 — Introduce Alembic migration framework** `[new]` `M` `infra` — replace `create_all`; baseline migration of current 7 tables (users, plaid_items, financial_accounts, raw_transactions, ledger_events, notification_events, sync_runs).
  _skill:_ db-evolution · _data:_ adds `alembic_version` table; baseline revision reflects current `models.py`. _accept:_ fresh db `alembic upgrade head` reproduces current schema exactly. _test:_ pytest (schema diff vs metadata == empty). _xc:_ idem.
- **PLT-2.2 — Migration CI check (upgrade+downgrade on ephemeral db)** `[new]` `S` `infra` — round-trip migrations in CI.
  _deps:_ PLT-2.1 · _accept:_ CI fails if `upgrade head` then `downgrade base` errors or leaves residue. _test:_ pytest in CI. _xc:_ idem, obs.
- **PLT-2.3 — Idempotent migration/backfill test harness** `[new]` `M` `data` — reusable fixture asserting re-run safety for data migrations.
  _skill:_ db-evolution · _accept:_ harness runs any backfill twice and asserts no row delta on 2nd run. _test:_ pytest (`GF-REPLAY`: 2nd run row-count delta == 0 for every backfill that adopts the harness). _xc:_ idem.
- **PLT-2.4 — Seed data decoupled from app startup** `[new]` `S` `data` — fixtures runnable independently of process boot.
  _deps:_ PLT-2.1 · _accept:_ `make seed` works without starting the API server. _test:_ pytest.

### PLT-3 Background jobs & scheduling
- **PLT-3.1 — Task runner abstraction (enqueue interface)** `[new]` `M` `api` — local in-proc + Cloud Tasks behind one `enqueue(task, payload)` interface.
  _accept:_ same call path runs sync inline locally and via Cloud Tasks in prod. _test:_ pytest (fake backend records enqueues). _xc:_ obs.
- **PLT-3.2 — Cloud Tasks queue + secured handler endpoint** `[new]` `M` `infra` — task HTTP handler authenticated via OIDC, not public.
  _deps:_ PLT-3.1, SEC-4.3 · _accept:_ unauthenticated POST to handler → 401; valid OIDC token → processed. _test:_ pytest + manual gcloud. _xc:_ authz, rate. _risk:_ Cloud Tasks→Cloud Run auth misconfig; mitigate with audience-pinned OIDC check.
- **PLT-3.3 — Cloud Scheduler periodic sync trigger** `[new]` `S` `infra` — cron enqueues per-item sync.
  _deps:_ PLT-3.2 · _accept:_ scheduler fires hourly and a sync_run row is created. _test:_ manual + pytest on trigger handler. _xc:_ obs.
- **PLT-3.4 — Job status surfacing API (from sync_runs)** `[partial]` `S` `api` — `GET /sync-runs` list with status/error.
  _data:_ read over `sync_runs`; new `SyncRunRead` schema + `api-types` `SyncRun`. _accept:_ returns user-scoped runs newest-first. _test:_ pytest. _xc:_ authz.
- **PLT-3.5 — Dead-letter + retry/backoff policy** `[new]` `M` `api` — bounded retries then DLQ; surfaces terminal failures.
  _deps:_ PLT-3.1 · _accept:_ task failing N times lands in DLQ and marks sync_run `failed`. _test:_ pytest (forced-failure path). _xc:_ idem, obs.

### PLT-4 Observability & error tracking
- **PLT-4.1 — Structured JSON logging + request IDs** `[new]` `S` `api` — correlation id per request, propagated to jobs.
  _accept:_ every log line has `request_id`; same id appears across a request's logs. _test:_ pytest (log capture). _xc:_ obs.
- **PLT-4.2 — Error tracking (Sentry) — backend** `[new]` `S` `api` — capture unhandled exceptions with PII scrubbing.
  _deps:_ SEC-4.4 · _accept:_ raised exception appears in Sentry with no raw PII. _test:_ manual + pytest (before-send scrubber unit). _xc:_ obs.
- **PLT-4.3 — Error tracking (Sentry) — web** `[new]` `S` `web` — client + RSC error capture.
  _accept:_ thrown client error reports to Sentry with release tag. _test:_ manual. _xc:_ obs.
- **PLT-4.4 — Health + readiness probes** `[built]` `S` `api` — `/health` liveness + db readiness.
  _accept:_ `/health` 200 when db reachable, 503 when not. _test:_ pytest. _xc:_ obs.
- **PLT-4.5 — Core metrics (sync latency, job counts, error rate)** `[new]` `M` `api` — emit counters/histograms for sync + LLM + jobs.
  _data:_ derives from `sync_runs` timings. _accept:_ dashboard shows sync p50/p95 and error rate. _test:_ pytest (metric emitted on sync). _xc:_ obs.

### PLT-5 Config, secrets & feature flags
- **PLT-5.1 — Typed settings/config module** `[built]` `S` `api` — pydantic settings, fail-fast on missing.
  _accept:_ missing required env var → startup error naming the var. _test:_ pytest. _xc:_ obs.
- **PLT-5.2 — Secret Manager wiring for prod secrets** `[partial]` `M` `infra` — Plaid/Clerk/DB secrets from GCP Secret Manager, never in env files.
  _skill:_ platform-ops · _accept:_ prod boots reading secrets from Secret Manager; none in repo/CI logs. _test:_ manual + doc. _xc:_ crypto.
- **PLT-5.3 — Feature flag module (server + client)** `[new]` `M` `shared` — flag eval shared by api + web; per-user overrides.
  _data:_ `feature_flags` config + optional per-user override row. _accept:_ flag off hides feature in web and 404s its API. _test:_ vitest + pytest. _xc:_ authz.
- **PLT-5.4 — Per-env config matrix + startup validation** `[partial]` `S` `infra` — local/preview/staging/prod matrix doc + assertion.
  _skill:_ env-vars · _accept:_ each env documents required vars; CI asserts matrix completeness. _test:_ doc + pytest. _xc:_ obs.

### PLT-6 CI/CD & environments
- **PLT-6.1 — CI checks: api/web/e2e/docs** `[built]` `S` `infra` — required status checks map to branch protection.
  _accept:_ PR blocked unless api+web+e2e+docs pass. _test:_ doc. _xc:_ obs.
- **PLT-6.2 — Per-PR preview deploys (web)** `[partial]` `S` `infra` — Vercel preview per PR.
  _skill:_ deployments-cicd · _accept:_ each PR comments a preview URL that boots. _test:_ manual. _xc:_ obs.
- **PLT-6.3 — Staging auto-deploy** `[built]` `S` `infra` — merge to main → staging.
  _accept:_ merge triggers staging deploy of api+web. _test:_ manual. _xc:_ obs.
- **PLT-6.4 — Production deploy workflows (api + web)** `[partial]` `M` `infra` — gated promote to prod, separate secrets/db.
  _accept:_ prod deploy is manual-approval and uses prod-only secrets/db. _test:_ manual + doc. _xc:_ crypto.
- **PLT-6.5 — DB migration step in deploy pipeline** `[new]` `M` `infra` — `alembic upgrade head` runs before app rollout.
  _deps:_ PLT-2.1 · _accept:_ deploy fails closed if migration fails (no app swap). _test:_ manual + doc. _xc:_ idem.

### PLT-8 Performance & scale
- **PLT-8.1 — Cursor/keyset pagination on transaction list** `[new]` `M` `api` — replace offset paging with keyset on `(date, id)` for stable large-list paging.
  _deps:_ NAV-3.1 · _data:_ composite index `ledger_events(user_id, date desc, id desc)`; `GET /transactions?cursor=`. _accept:_ paging 100k rows stays O(page) with no drift as rows mutate. _test:_ pytest (seed 100k, assert stable order + no dupes/skips across pages). _xc:_ authz, obs.
- **PLT-8.2 — Large-account backfill performance budget** `[new]` `M` `api` — bounded memory + batched writes for multi-year backfills.
  _deps:_ ING-1.1 · _accept:_ backfilling a 50k-txn account stays under a documented memory/time budget (batched, streamed). _test:_ pytest (synthetic 50k fixture asserts batch size + peak memory bound). _xc:_ obs, rate.
- **PLT-8.3 — Report aggregation query budget + indexes** `[new]` `M` `api` — ensure rollup queries stay fast at scale.
  _deps:_ RPT-2.4 · _data:_ covering indexes for group-by(period/category); optional materialized monthly rollup. _accept:_ aggregate over 100k events returns under target latency; explain plan uses index. _test:_ pytest (EXPLAIN asserts index scan; latency budget on 100k seed). _xc:_ money, obs.
- **PLT-8.4 — Load/scale test harness (seed N + smoke)** `[new]` `M` `data` — reusable generator of N synthetic users/txns + perf smoke.
  _skill:_ testing-playbook · _accept:_ `make perf-seed N=100000` populates realistic data; smoke asserts key endpoints under budget. _test:_ pytest + doc. _xc:_ obs.

### PLT-7 Release & versioning
- **PLT-7.1 — Version sync script + check** `[built]` `S` `infra` — VERSION/CHANGELOG/package.json/pyproject in lockstep.
  _skill:_ release-hygiene · _accept:_ CI fails if versions drift. _test:_ pytest/script. _xc:_ obs.
- **PLT-7.2 — Changelog "Unreleased" flow** `[partial]` `S` `infra` — Keep-a-Changelog unreleased section.
  _skill:_ release-hygiene · _accept:_ `make docs-build` errors if Unreleased empty at tag time. _test:_ doc.
- **PLT-7.3 — Release tagging + GitHub release** `[new]` `S` `infra` — tag + autogenerated notes from changelog.
  _deps:_ PLT-7.1 · _accept:_ tagging `vX.Y.Z` creates a GitHub release with changelog body. _test:_ manual.

---

## SEC — Security, Privacy, Data & Compliance

### SEC-1 Identity & token security
- **SEC-1.1 — Enforce server-verified identity (no spoofable headers)** `[partial]` `M` `api` — verify Clerk JWT server-side on every request; remove any header-trust path.
  _skill:_ clerk-cli, auth · _data:_ resolves `users.external_auth_user_id` from verified JWT `sub`. _accept:_ request with forged `X-User-Id` but no valid JWT → 401. _test:_ pytest (forged-header rejected, valid JWT accepted). _xc:_ authz. _risk:_ regressing to demo-bypass in prod; gate bypass behind env flag asserted off in prod.
- **SEC-1.2 — Per-user row-scoping guard** `[partial]` `M` `api` — every query filtered by authenticated `user_id`; shared dependency, not per-route.
  _deps:_ SEC-1.1 · _data:_ all tables already carry `user_id`; centralize scoping in a query dependency. _accept:_ user A cannot read/patch user B's transaction id (404/403). _test:_ pytest (cross-tenant access denied across every router). _xc:_ authz.
- **SEC-1.3 — Encrypted provider-token storage (KMS/Fernet)** `[partial]` `M` `api` — real envelope crypto for `plaid_items.encrypted_access_token`.
  _data:_ encrypt at write, decrypt at use; store key ref/version. _accept:_ DB column is ciphertext; decrypt round-trips; rotating key version still decrypts old rows. _test:_ pytest (round-trip + tamper detection). _xc:_ crypto. _risk:_ key loss = unrecoverable tokens; document KMS key backup + versioning.
- **SEC-1.4 — Token rotation + revoke on disconnect** `[new]` `M` `api` — re-encrypt on key rotation; null + revoke on disconnect.
  _deps:_ SEC-1.3 · _data:_ updates `encrypted_access_token`, sets `status='disconnected'`. _accept:_ disconnect calls provider revoke and leaves no usable token. _test:_ pytest. _xc:_ crypto, idem.

### SEC-2 Data encryption
- **SEC-2.1 — Field-level encryption for sensitive PII** `[new]` `M` `data` — encrypt sensitive free-text (notes, raw merchant PII) beyond column tokens.
  _deps:_ SEC-1.3 · _data:_ encrypted columns for designated PII fields. _accept:_ targeted fields stored ciphertext; app reads transparently. _test:_ pytest. _xc:_ crypto.
- **SEC-2.2 — Secret rotation runbook + automation** `[new]` `S` `infra` — documented + scripted rotation for Plaid/Clerk/DB/KMS.
  _skill:_ platform-ops · _accept:_ runbook rotates a secret with zero downtime in staging. _test:_ doc + manual. _xc:_ crypto.
- **SEC-2.3 — Verify Neon at-rest encryption posture** `[new]` `S` `research` — confirm Neon encryption + backup encryption guarantees.
  _skill:_ neon-ops · _accept:_ written finding citing Neon at-rest + PITR encryption. _test:_ doc. _cost:_ $0 (doc/contract review). _decide-by:_ before SEC-2.1 lands; exit = documented confirmation or compensating field-encryption decision. _risk:_ assumption of encryption unverified; resolve via vendor doc/contract.

### SEC-3 Privacy & data rights
- **SEC-3.1 — Account deletion orchestration (export → disconnect → cascade)** `[new]` `M` `api` — orchestrate full erasure with confirmation + audit.
  _deps:_ SEC-3.5, SEC-3.2, SRC-2.5 · _data:_ deletes user + cascade across all 7 tables. _accept:_ post-deletion no rows for `user_id` anywhere and providers revoked. _test:_ pytest (delete then assert 0 rows across every table for that `user_id`; re-run delete is a no-op). _xc:_ authz, idem.
- **SEC-3.5 — Cascade-delete migration + FK constraints** `[new]` `M` `data` — add ON DELETE cascade / explicit child deletes so erasure is total.
  _deps:_ PLT-2.1 · _skill:_ db-evolution · _data:_ FK `ondelete='CASCADE'` on child tables. _accept:_ deleting a user removes all dependent rows; migration is reversible. _test:_ pytest (orphan check). _xc:_ idem.
- **SEC-3.2 — Full data export (JSON/CSV)** `[new]` `M` `api` — async export bundle of all user data.
  _deps:_ PLT-3.1 · _data:_ reads all user tables → zipped JSON+CSV to Blob. _accept:_ export contains every transaction/account/receipt for the user. _test:_ pytest (export row-count == db row-count per table for the user). _xc:_ authz, rate.
- **SEC-3.3 — Consent records per data source** `[new]` `M` `data` — store consent grant/scope/timestamp per connection.
  _data:_ `consents` table (user_id, source, scope, granted_at, revoked_at). _accept:_ connecting a source writes a consent row; disconnect sets revoked. _test:_ pytest. _xc:_ authz.
- **SEC-3.4 — Data retention config + privacy policy page** `[new]` `S` `infra` — retention windows + public policy page.
  _accept:_ policy page reachable; retention setting documented. _test:_ doc + playwright (page renders). _xc:_ a11y.
- **SEC-3.6 — Automated DB backup + restore drill** `[new]` `S` `infra` — verify Neon PITR/backups + practice a restore.
  _skill:_ neon-ops · _accept:_ documented restore drill recovers staging to a prior point. _test:_ manual + doc. _xc:_ crypto, obs. _risk:_ untested backups = false safety; schedule periodic restore drills.
- **SEC-3.7 — User-initiated import-from-export (restore)** `[new]` `M` `api` — re-import a prior data export bundle.
  _deps:_ SEC-3.2, PLT-2.3 · _accept:_ importing a user's export reproduces their data idempotently (no dupes). _test:_ pytest (export→import round-trip). _xc:_ idem, authz.

### SEC-4 Audit & abuse
- **SEC-4.1 — Audit log of sensitive actions** `[new]` `M` `data` — append-only log of deletes, exports, connection changes, step-up.
  _data:_ `audit_log`(user_id, action, entity, ip, at) + index `(user_id, at desc)`; no UPDATE/DELETE grant (append-only). _accept:_ each sensitive action writes one immutable audit row. _test:_ pytest (action emits exactly 1 row; update/delete blocked). _xc:_ authz, obs.
- **SEC-4.2 — Rate limiting (auth, sync, LLM endpoints)** `[new]` `M` `api` — per-user/IP limits with 429 + Retry-After.
  _accept:_ exceeding limit on `/plaid/sync-item` and LLM routes → 429. _test:_ pytest (limit boundary). _xc:_ rate, obs. _risk:_ Cloud Run multi-instance counters need shared store (Redis); note dependency.
- **SEC-4.3 — Webhook signature verification** `[partial]` `S` `api` — verify Plaid/provider webhook signatures (`/plaid/webhook`).
  _accept:_ unsigned/forged webhook → 401; valid → processed. _test:_ pytest. _xc:_ authz.
- **SEC-4.4 — PII redaction in logs** `[new]` `S` `api` — scrub tokens/emails/amounts from logs + Sentry.
  _accept:_ logged payloads show redacted markers, never raw token/email. _test:_ pytest (redactor unit). _xc:_ obs, crypto.

### SEC-5 Compliance posture
- **SEC-5.1 — SOC2-readiness checklist (doc)** `[new]` `S` `research` — gap analysis vs SOC2 controls.
  _accept:_ checklist enumerating controls + current gaps. _test:_ doc. _cost:_ $0 (internal). _decide-by:_ before first external user data lands; exit = prioritized gap list with owners.
- **SEC-5.2 — LLM data-handling policy (no-train, redaction)** `[new]` `S` `research` — vendor no-train terms + what's sent to LLM; **policy precedes implementation** (CAT-4.1 depends on this, not vice-versa).
  _accept:_ documented policy: zero-retention/no-train provider/tier + redaction rules before send. _test:_ doc. _cost:_ $0 (terms review). _decide-by:_ before CAT-4.1 implementation; exit = named provider+tier with written no-train terms. _risk:_ provider terms may allow training; pin to enterprise/zero-retention tier (e.g. via ai-gateway provider routing).

---

## AUT — Identity, Auth & Sessions

### AUT-1 Auth providers
- **AUT-1.1 — Clerk sign-in/sign-up (web)** `[partial]` `M` `web` — hosted Clerk flow + session cookie.
  _skill:_ clerk-cli, auth · _accept:_ new user can sign up and reach dashboard. _test:_ playwright (sign-up → dashboard). _xc:_ authz, a11y.
- **AUT-1.2 — Sign in with Google (Clerk OAuth)** `[new]` `S` `web` — Google as social provider.
  _deps:_ AUT-1.1 · _accept:_ Google button completes OAuth and creates/links the user. _test:_ playwright (mocked) + manual. _xc:_ authz, a11y.
- **AUT-1.3 — Clerk production instance setup** `[new]` `S` `infra` — prod Clerk instance, domains, keys in Secret Manager.
  _skill:_ clerk-cli · _deps:_ PLT-5.2 · _accept:_ prod uses prod Clerk keys distinct from dev. _test:_ doc + manual. _xc:_ crypto.
- **AUT-1.4 — Local auth toggle / demo bypass** `[built]` `S` `web` — dev-only bypass, hard-off in prod.
  _accept:_ bypass works locally and is asserted disabled when env=prod. _test:_ vitest + pytest (prod guard). _xc:_ authz. _risk:_ bypass leaking to prod; covered by SEC-1.1 guard.

### AUT-2 Session lifecycle
- **AUT-2.1 — Server session verification + `/me`** `[built]` `S` `api` — verify session, return `UserRead`.
  _data:_ `GET /me` → `UserRead`. _accept:_ valid session returns the user; invalid → 401. _test:_ pytest. _xc:_ authz.
- **AUT-2.2 — Sign-out + session revoke** `[partial]` `S` `web` — clear session + revoke at Clerk.
  _accept:_ after sign-out, protected routes redirect to login. _test:_ playwright. _xc:_ authz, a11y.
- **AUT-2.3 — Protected route middleware (web)** `[partial]` `S` `web` — Next middleware gating private routes.
  _skill:_ nextjs · _accept:_ unauthenticated hit to `/dashboard` redirects to `/login`. _test:_ playwright. _xc:_ authz.
- **AUT-2.4 — Token refresh handling** `[new]` `S` `web` — silent refresh + 401 retry on API client.
  _accept:_ expired token transparently refreshes; user not bounced. _test:_ vitest (client retry). _xc:_ authz.

### AUT-3 User record & preferences
- **AUT-3.1 — User provisioning on first login (upsert by external id)** `[partial]` `M` `api` — idempotent upsert keyed on `external_auth_user_id`.
  _deps:_ SEC-1.1 · _data:_ upsert `users` by unique `external_auth_user_id` (already `unique=True`); ON CONFLICT DO UPDATE. _accept:_ repeated logins never create duplicate users. _test:_ pytest (`GF-REPLAY`: 5 concurrent logins → exactly 1 row). _xc:_ authz, idem.
- **AUT-3.2 — Profile fields (name, email, avatar, timezone, currency)** `[partial]` `M` `api` — extend user with avatar/timezone/primary currency.
  _deps:_ PLT-2.1 · _data:_ add `avatar_url`, `timezone`, `primary_currency` to `users`; extend `UserRead`. _accept:_ profile fields persist and return via `/me`. _test:_ pytest. _xc:_ authz, money.
- **AUT-3.3 — User settings/preferences store** `[new]` `M` `data` — generic key/value prefs (notif defaults, display options).
  _deps:_ PLT-2.1 · _data:_ `user_preferences` table or JSON column. _accept:_ prefs round-trip via API. _test:_ pytest. _xc:_ authz.

### AUT-4 Multi-device & step-up
- **AUT-4.1 — Active sessions list + revoke** `[new]` `M` `web` — list devices/sessions, revoke individually.
  _skill:_ clerk-cli · _accept:_ revoking a session logs that device out. _test:_ playwright + manual. _xc:_ authz, a11y.
- **AUT-4.2 — Step-up auth for sensitive actions** `[new]` `M` `web` — re-verify before delete/export/disconnect.
  _deps:_ AUT-2.1, SEC-3.1 · _accept:_ account-deletion requires fresh re-auth. _test:_ playwright. _xc:_ authz, a11y.

### AUT-5 Household / shared access
- **AUT-5.1 — SPIKE: data-sharing model (household vs per-user shares)** `[new]` `S` `research` — decide ownership/sharing model before building. **(v2 leaning: add nullable `household_id` to owned rows now (default null = personal), keep `user_id` as creator; defer full per-resource ACL. This makes AUT-5.4 an additive scoping widen, not a re-scoping migration.)**
  _accept:_ recommendation: household-tenant via nullable `household_id` column vs per-resource sharing; documents the authz predicate (`user_id == me OR household_id IN my_households`) and migration cost of each. _test:_ doc. _cost:_ $0 (design). _decide-by:_ before LDG-3/ENR-3 mature (those add the most owned tables); exit = chosen predicate + which tables get `household_id`. _risk:_ wrong model forces a painful re-scoping migration; mitigate by reserving the nullable column early so the change is additive.
- **AUT-5.2 — Household/workspace model + membership** `[new]` `M` `data` — group users into a shared workspace with roles.
  _deps:_ AUT-5.1, PLT-2.1 · _data:_ `households` + `household_members`(user_id, household_id, role) unique `(user_id, household_id)`; reserve nullable `household_id` on owned tables. _accept:_ a user can belong to a household with a role. _test:_ pytest (membership unique; dup invite is a no-op). _xc:_ authz, idem.
- **AUT-5.3 — Invite/accept household member** `[new]` `M` `web` — invite by email, accept flow.
  _deps:_ AUT-5.2 · _accept:_ invitee accepts and gains scoped access. _test:_ playwright + pytest. _xc:_ authz, a11y.
- **AUT-5.4 — Shared-resource authorization (row scoping by household)** `[new]` `M` `api` — widen the SEC-1.2 scoping predicate to `user_id == me OR household_id ∈ my_households`.
  _deps:_ AUT-5.2, SEC-1.2 · _accept:_ a member sees shared data; a non-member is denied. _test:_ pytest (member reads shared row; non-member → 404 across every router). _xc:_ authz.

---

## ONB — Onboarding & Registration

### ONB-1 First-run flow
- **ONB-1.1 — Welcome / value-prop screen** `[new]` `S` `web` — first-run intro to the true-spend wedge.
  _skill:_ frontend-design · _accept:_ new user sees welcome before connecting; returning user skips it. _test:_ playwright. _xc:_ a11y.
- **ONB-1.2 — Onboarding progress checklist** `[new]` `M` `web` — connect account → review → set categories steps with completion state.
  _deps:_ ONB-1.3 · _accept:_ completing a step ticks it and persists across reload. _test:_ playwright. _xc:_ a11y.
- **ONB-1.3 — Onboarding state persistence** `[new]` `S` `api` — store onboarding step flags server-side.
  _deps:_ AUT-3.3 · _data:_ onboarding flags in `user_preferences`. _accept:_ step state survives logout/login. _test:_ pytest. _xc:_ authz, idem.

### ONB-2 Connect-first-account wizard
- **ONB-2.1 — Guided "connect your first bank" step** `[new]` `M` `web` — wizard wrapping Plaid Link with reassurance copy.
  _deps:_ SRC-2.3 · _accept:_ completing Link advances the wizard and shows the new connection. _test:_ playwright (mocked Link). _xc:_ a11y.
- **ONB-2.2 — "We're importing…" status step** `[new]` `S` `web` — live backfill progress during first sync.
  _deps:_ ING-1.2 · _accept:_ shows progress and transitions to dashboard when backfill completes. _test:_ playwright. _xc:_ a11y.
- **ONB-2.3 — Skip / connect-later path** `[new]` `S` `web` — allow exploring with demo/empty state.
  _accept:_ skipping lands on dashboard empty state without errors. _test:_ playwright. _xc:_ a11y.

### ONB-3 Personalization
- **ONB-3.1 — Choose primary currency + timezone** `[new]` `S` `web` — set during onboarding, default from locale.
  _deps:_ AUT-3.2 · _accept:_ selection persists to profile and drives display formatting. _test:_ playwright. _xc:_ money, a11y.
- **ONB-3.2 — Pick categories of interest** `[new]` `S` `web` — preselect category set to focus the taxonomy.
  _deps:_ CAT-1.1 · _accept:_ chosen categories appear prioritized in pickers. _test:_ playwright. _xc:_ a11y.
- **ONB-3.3 — Push opt-in step** `[new]` `S` `web` — request web-push permission with rationale.
  _deps:_ NTF-3.1 · _accept:_ granting permission registers a push subscription. _test:_ manual + playwright. _xc:_ a11y.

### ONB-4 Demo→real transition
- **ONB-4.1 — Demo workspace → real account migration** `[new]` `M` `api` — clear demo data when first real connection lands.
  _deps:_ PLT-1.2, SRC-2.2 · _data:_ delete demo-flagged rows; preserve user. _accept:_ first real connect removes demo transactions without touching real ones. _test:_ pytest (idempotent, demo-only deletion). _xc:_ idem, authz.
- **ONB-4.2 — Empty states across app pre-connection** `[new]` `M` `web` — purposeful empty states on every screen.
  _accept:_ each major screen renders a guiding empty state with a connect CTA when no data. _test:_ playwright + vitest. _xc:_ a11y.

---

## SRC — Source Connections

### SRC-1 Provider-agnostic framework
- **SRC-1.1 — Provider interface contract (Protocol + registry)** `[new]` `M` `api` — define `Provider` Protocol (`connect/sync/disconnect/capabilities`) + registry; Plaid as first impl.
  _deps:_ SRC-1.2 · _accept:_ Plaid routed through the interface with no behavior change; a fake provider passes the same suite. _test:_ pytest (contract tests vs fake + Plaid adapter). _xc:_ authz.
- **SRC-1.6 — Plaid adapter conformance to interface** `[new]` `M` `api` — refactor existing Plaid calls behind SRC-1.1.
  _deps:_ SRC-1.1 · _data:_ no schema change; wraps create-link/exchange/sync/webhook. _accept:_ existing Plaid e2e still green post-refactor. _test:_ pytest + playwright. _xc:_ authz, idem.
- **SRC-1.2 — Generalize `plaid_items` → `connections`** `[partial]` `M` `data` — rename/extend to provider-neutral `connections` with `provider` discriminator.
  _skill:_ db-evolution · _deps:_ PLT-2.1 · _data:_ migrate `plaid_items`→`connections` (+`provider` default `'plaid'`, keep `plaid_item_id`→`provider_ref` unique); update child FKs (`financial_accounts.plaid_item_id`, `raw_transactions.plaid_item_id`, `sync_runs.plaid_item_id`) + `PlaidItemRead`→`ConnectionRead`, `api-types`. _accept:_ existing Plaid rows readable post-migration; backward-compatible read. _test:_ pytest (migration up/down preserves every row + FK target; `GF-REPLAY` on re-run). _xc:_ idem.
- **SRC-1.3 — Provider capability metadata** `[new]` `S` `api` — declare per-provider fetchable data (txns, balances, holdings, identity).
  _deps:_ SRC-1.1 · _accept:_ UI can ask "does this provider support investments?" and get a truthful answer. _test:_ pytest.
- **SRC-1.4 — Connection health status model** `[partial]` `S` `data` — normalized status enum (healthy/needs_reauth/error/disconnected).
  _data:_ `connections.status` enum + last error. _accept:_ provider error maps to `needs_reauth` and surfaces in UI. _test:_ pytest. _xc:_ idem.
- **SRC-1.5 — SPIKE: bank provider choice (Plaid vs Teller vs SimpleFIN)** `[new]` `S` `research` — cost/coverage/data-quality comparison; recommend default. **(v2 grounding: Plaid = per-successful-call (~$0.10–0.60/call) + monthly minimums; Teller ≈ flat per-connected-account/mo, narrower coverage; SimpleFIN ≈ flat low $/mo via MX, 16k+ institutions. Decision hinges on auto-sync need + investment coverage + budget at expected user count.)**
  _accept:_ written recommendation with cost-per-active-user/mo at 100 & 1k users + coverage matrix (banks, cards, investments, identity) for each provider. _test:_ doc. _cost:_ $0 (research; vendor quotes). _decide-by:_ before SRC-1.6 Plaid-adapter hardening / any 2nd-provider work; exit = named default provider + documented migration cost from today's Plaid-only state. _risk:_ project memory says Teller default but repo is Plaid-only; SRC-1.1/1.2 keep it provider-neutral so the choice is swappable, not load-bearing.

### SRC-2 Bank & card (Plaid today)
- **SRC-2.1 — Plaid Link token create** `[built]` `S` `api` — `POST /plaid/create-link-token`.
  _data:_ `LinkTokenResponse`. _accept:_ returns a valid link_token for the env (demo/sandbox/prod). _test:_ pytest. _xc:_ authz, rate.
- **SRC-2.2 — Public-token exchange + item store** `[built]` `M` `api` — `POST /plaid/exchange-public-token`; persist item + accounts.
  _deps:_ SEC-1.3 · _data:_ writes `plaid_items`(encrypted token)+`financial_accounts`(unique `plaid_account_id`); `ExchangePublicTokenResponse`. _accept:_ exchange stores encrypted token + creates accounts; re-exchange is idempotent. _test:_ pytest (`GF-REPLAY`: re-exchange same item → no dup accounts). _xc:_ crypto, idem, authz, rate.
- **SRC-2.3 — Plaid Link UI button + flow** `[built]` `M` `web` — Link launch + success/exit handling.
  _accept:_ successful Link triggers exchange and shows new accounts. _test:_ playwright (mocked Link). _xc:_ a11y.
- **SRC-2.4 — Reconnect / Link update mode** `[new]` `M` `web` — re-auth an errored item without losing history.
  _data:_ link token in update mode for existing `plaid_item_id`. _accept:_ reconnect clears `needs_reauth` and resumes sync; history preserved. _test:_ playwright + pytest. _xc:_ idem, authz, a11y.
- **SRC-2.5 — Disconnect item (+ token revoke)** `[new]` `M` `api` — `DELETE /connections/{id}` revokes + soft-disconnects.
  _deps:_ SEC-1.4 · _data:_ sets `status='disconnected'`, nulls token; keeps historical events. _accept:_ disconnect revokes at provider and stops future syncs; transactions remain. _test:_ pytest. _xc:_ authz, crypto, idem.
- **SRC-2.6 — Multiple institutions support** `[partial]` `M` `api` — many connections per user, aggregated.
  _accept:_ two institutions show distinct accounts under one user; sync isolates per item. _test:_ pytest. _xc:_ authz.
- **SRC-2.7 — Institution metadata + logos** `[new]` `S` `web` — institution name/logo/color on connection cards.
  _data:_ `connections.institution_name`/logo ref. _accept:_ connection shows correct institution branding. _test:_ vitest. _xc:_ a11y.

### SRC-3 Venmo
- **SRC-3.1 — SPIKE: Venmo data access (API vs statement export)** `[new]` `S` `research` — confirm no consumer API; statement CSV path. **(v2 grounding: Venmo Developer/Payouts API is retired to new developers as of recent years → no sanctioned auto-sync; the monthly statement CSV (per-account export) is the only reliable path.)**
  _accept:_ documented: Venmo has no available public consumer txn API for new devs → CSV export is the path; note Plaid-via-PayPal limits. _test:_ doc. _cost:_ $0 (research). _decide-by:_ before SRC-3.2; exit = confirm CSV schema + cadence (manual upload, no auto-sync). _risk:_ no official API; rely on user CSV upload, no auto-sync.
- **SRC-3.2 — Venmo statement/CSV parser** `[new]` `M` `data` — parse Venmo CSV schema → normalized rows.
  _deps:_ SRC-3.1 · _data:_ map CSV cols → raw event shape (amount minor units, date, counterparty, note). _accept:_ sample CSV parses to expected normalized rows incl. fees + sign per direction. _test:_ pytest (fixture CSVs incl. payment, charge, fee, refund rows). _xc:_ money, idem.
- **SRC-3.3 — Venmo → raw events ingestion** `[new]` `M` `data` — idempotent upsert of parsed Venmo rows.
  _deps:_ SRC-3.2, ING-4.1 · _data:_ insert into raw store with `provider='venmo'` + stable dedup key `hash(provider, date, amount, counterparty, note)`. _accept:_ re-uploading same CSV adds no duplicates. _test:_ pytest (`GF-REPLAY`: re-upload identical CSV → 0 new rows). _xc:_ idem, money.

### SRC-4 PayPal
- **SRC-4.1 — SPIKE: PayPal API access** `[new]` `S` `research` — evaluate PayPal Transaction Search API + scopes.
  _accept:_ documented feasibility of PayPal Transaction Search API (≤3y window, `https://uri.paypal.com/services/reporting/search/read` scope, paginated) vs CSV fallback. _test:_ doc. _cost:_ ~$0 (PayPal API free; dev time only). _decide-by:_ before SRC-4.2; exit = API-or-CSV decision + window/scope limits documented. _risk:_ API rate/window limits + app-review for scope; fallback to statement import.
- **SRC-4.2 — PayPal data import → raw events** `[new]` `M` `data` — ingest PayPal (API or CSV) idempotently.
  _deps:_ SRC-4.1, ING-4.1 · _data:_ raw rows `provider='paypal'`. _accept:_ import is idempotent and preserves fees/currency. _test:_ pytest. _xc:_ idem, money.

### SRC-5 Investments (Fidelity / Robinhood / Kalshi)
- **SRC-5.1 — SPIKE: investments access (Plaid Investments vs direct)** `[new]` `S` `research` — coverage for Fidelity/Robinhood/Kalshi.
  _accept:_ matrix of which providers cover each broker (Plaid Investments holdings/transactions endpoints) ; Kalshi/Robinhood gaps noted. _test:_ doc. _cost:_ Plaid Investments billed per holdings/investments call on top of base; estimate per active investment user. _decide-by:_ before SRC-5.3; exit = per-broker coverage matrix + manual-entry fallback list. _risk:_ Kalshi/Robinhood lack reliable aggregation → SRC-5.4 manual entry fallback.
- **SRC-5.2 — Investment accounts + holdings model** `[new]` `M` `data` — accounts of type investment + holdings table.
  _deps:_ PLT-2.1 · _data:_ `holdings`(account_id, symbol, qty, cost_basis, value, as_of); extend account `type='investment'`. _accept:_ holdings persist with valuation timestamp. _test:_ pytest. _xc:_ money, idem.
- **SRC-5.3 — Investment balance/holdings ingestion** `[new]` `M` `data` — sync holdings + market value.
  _deps:_ SRC-5.1, SRC-5.2 · _accept:_ sync updates holdings + account value idempotently. _test:_ pytest. _xc:_ idem, money.
- **SRC-5.4 — Manual investment account entry** `[new]` `S` `web` — manual broker/holding entry for unsupported sources.
  _deps:_ SRC-5.2 · _accept:_ user adds a manual holding and it counts toward net worth. _test:_ playwright. _xc:_ money, a11y.

### SRC-6 Gmail (receipts/invoices)
- **SRC-6.1 — Gmail OAuth connection** `[new]` `M` `api` — OAuth consent + read-only Gmail scope.
  _skill:_ env-vars · _deps:_ SEC-3.3 · _accept:_ user grants Gmail read scope and a connection is created. _test:_ pytest (mocked OAuth) + manual. _xc:_ authz, crypto, rate. _risk:_ `gmail.readonly` is a Google **restricted** scope → CASA tier-2 security assessment + verification (weeks–months, recurring annual cost ~$mid-hundreds–low-thousands) before prod; gate behind a flag and ship the SRC-7.2 forward-to-email fallback first.
- **SRC-6.2 — Gmail token storage + scopes** `[new]` `M` `api` — encrypted refresh token + scope record.
  _deps:_ SEC-1.3, SRC-6.1 · _data:_ encrypted Gmail token on connection. _accept:_ token stored ciphertext; refresh works. _test:_ pytest. _xc:_ crypto.
- **SRC-6.3 — Receipt/invoice email query builder** `[new]` `M` `api` — build Gmail search queries (sender allowlist, keywords, has-attachment).
  _deps:_ SRC-6.1 · _accept:_ query returns candidate message ids for known receipt senders. _test:_ pytest (query construction unit). _xc:_ rate.
- **SRC-6.5 — Receipt/invoice email fetch + raw store** `[new]` `M` `api` — fetch message bodies/attachments → raw receipt records.
  _deps:_ SRC-6.3, RCP-1.2 · _data:_ writes raw receipt rows + Blob refs. _accept:_ fetched emails persist as receipt records, idempotent by message id. _test:_ pytest. _xc:_ idem, crypto, rate.
- **SRC-6.4 — Incremental Gmail history sync** `[new]` `M` `api` — use Gmail historyId for deltas.
  _deps:_ SRC-6.5 · _data:_ persist `history_id` cursor on connection. _accept:_ second sync only fetches new messages. _test:_ pytest. _xc:_ idem, rate.

### SRC-7 SMS / iMessage (receipts)
- **SRC-7.1 — SPIKE: SMS/iMessage receipt ingestion** `[new]` `S` `research` — feasibility + privacy of iMessage channel.
  _skill:_ imessage · _accept:_ documented approach + privacy constraints; likely macOS-only local read. _test:_ doc. _cost:_ $0 (research). _decide-by:_ before any SMS-ingest build; exit = go/no-go vs forward-to-email (SRC-7.2). _risk:_ no sanctioned iMessage API + significant privacy surface; prefer forward-to-email fallback (SRC-7.2).
- **SRC-7.2 — Forward-to-email receipt inbox (fallback path)** `[new]` `M` `api` — unique per-user inbound address → receipt ingest.
  _deps:_ SRC-6.5 · _data:_ inbound-email webhook → raw receipt. _accept:_ forwarding a receipt email creates a receipt record. _test:_ pytest. _xc:_ idem, authz.

### SRC-8 Manual & file import
- **SRC-8.1 — CSV import (mapping + preview)** `[new]` `M` `data` — generic CSV importer with column mapping + dedup preview.
  _deps:_ ING-4.1 · _data:_ raw rows `provider='csv'`, stable hash dedup key `hash(provider, date, amount, name)`. _accept:_ user maps columns, previews, and import is idempotent. _test:_ pytest (`GF-REPLAY`: re-import same CSV → 0 new rows) + playwright (mapping UI). _xc:_ idem, money, a11y.
- **SRC-8.4 — OFX/QFX import parser** `[new]` `M` `data` — parse OFX/QFX (Quicken) into normalized rows.
  _deps:_ SRC-8.1 · _data:_ map OFX fields → raw event shape. _accept:_ sample OFX/QFX parses with correct signs/amounts. _test:_ pytest (fixtures). _xc:_ money, idem.
- **SRC-8.2 — Manual transaction entry** `[new]` `M` `web` — add a one-off transaction by hand.
  _deps:_ LDG-1.1 · _data:_ creates a ledger event (`provider='manual'`). _accept:_ manual txn appears in lists and counts toward spend. _test:_ playwright + pytest. _xc:_ money, authz, a11y.
- **SRC-8.3 — Manual account (cash/asset/liability) entry** `[new]` `M` `web` — track cash/assets/liabilities not at any provider.
  _deps:_ LDG-3.1 · _data:_ `financial_accounts` row, `plaid_item_id=null`, manual type. _accept:_ manual account contributes to balances/net worth. _test:_ playwright + pytest. _xc:_ money, authz, a11y.

### SRC-9 Connection management UI
- **SRC-9.1 — Connections management page** `[partial]` `M` `web` — list connections with status/last-sync/accounts.
  _deps:_ PLT-3.4 · _accept:_ page lists every connection with health + last sync time. _test:_ playwright. _xc:_ a11y, authz.
- **SRC-9.2 — Per-connection "sync now" + status** `[built]` `S` `web` — manual sync trigger + live status.
  _data:_ `POST /plaid/sync-item/{id}` → `SyncResponse`. _accept:_ clicking sync updates last-synced and imported count. _test:_ playwright. _xc:_ rate, a11y.
- **SRC-9.3 — Reconnect prompts on error status** `[new]` `M` `web` — surface needs-reauth with a fix CTA.
  _deps:_ SRC-2.4 · _accept:_ errored connection shows a reconnect banner that launches update mode. _test:_ playwright. _xc:_ a11y.

---

## ING — Ingestion & Sync Engine

### ING-1 Initial backfill
- **ING-1.1 — Paged initial transactions backfill** `[partial]` `M` `api` — page provider history into raw store on connect.
  _skill:_ db-evolution · _deps:_ ING-4.1 · _data:_ bulk upsert `raw_transactions` (unique `plaid_transaction_id`). _accept:_ connecting backfills full available window without dupes. _test:_ pytest (multi-page fixture; `GF-REPLAY`: re-running backfill yields 0 new rows). _xc:_ idem, rate.
- **ING-1.2 — Backfill progress + resumability** `[new]` `M` `api` — checkpoint progress; resume after interruption.
  _deps:_ PLT-3.1, ING-5.1 · _data:_ progress on `sync_runs`. _accept:_ killing mid-backfill and re-running resumes, not restarts. _test:_ pytest. _xc:_ idem, obs.
- **ING-1.3 — Historical date-range backfill control** `[new]` `M` `web` — user picks how far back to import.
  _deps:_ ING-1.1 · _accept:_ choosing 2y triggers a bounded backfill. _test:_ playwright. _xc:_ a11y, rate.
- **ING-1.4 — Account balance snapshot on connect** `[partial]` `S` `api` — capture starting balances.
  _deps:_ LDG-3.1 · _data:_ writes balance history row. _accept:_ connect records a dated balance snapshot per account. _test:_ pytest. _xc:_ money, idem.

### ING-2 Incremental sync
- **ING-2.1 — Cursor-based incremental sync** `[partial]` `M` `api` — Plaid `/transactions/sync` cursor loop.
  _data:_ reads/writes `plaid_items.transactions_cursor`. _accept:_ sync applies added/modified/removed since cursor. _test:_ pytest (added+modified+removed fixture). _xc:_ idem, rate.
- **ING-2.2 — Safe cursor persistence/advance** `[partial]` `S` `data` — advance cursor only after successful apply.
  _skill:_ db-evolution · _deps:_ ING-2.1 · _accept:_ failure mid-apply does not advance cursor (no skipped txns). _test:_ pytest (failure path). _xc:_ idem.
- **ING-2.3 — Pending→posted transition handling** `[new]` `M` `data` — reconcile pending into posted via `pending_transaction_id`.
  _deps:_ ING-4.2 · _data:_ link `raw_transactions.pending_transaction_id`; supersede pending. _accept:_ a pending then posted pair yields one ledger event, not two. _test:_ pytest (fixture: pending row then posted row referencing it → exactly 1 surviving canonical raw + 1 ledger event). _xc:_ idem, money.
- **ING-2.4 — Removed-transaction handling** `[partial]` `S` `data` — soft-remove via `removed_at` + cascade to ledger.
  _data:_ set `raw_transactions.removed_at`; mark ledger event removed. _accept:_ provider-removed txn disappears from spend totals. _test:_ pytest. _xc:_ idem.

### ING-3 Webhooks
- **ING-3.1 — Webhook receiver + verification** `[built]` `M` `api` — `POST /plaid/webhook` with signature check.
  _deps:_ SEC-4.3 · _data:_ `WebhookPayload`. _accept:_ valid webhook accepted, forged rejected. _test:_ pytest. _xc:_ authz.
- **ING-3.2 — Webhook → enqueue sync job** `[new]` `M` `api` — translate webhook codes to enqueued syncs.
  _deps:_ PLT-3.1, ING-3.1 · _accept:_ `SYNC_UPDATES_AVAILABLE` enqueues that item's sync. _test:_ pytest. _xc:_ idem, obs.
- **ING-3.3 — Webhook event log + replay** `[new]` `M` `data` — persist raw webhooks for audit/replay.
  _deps:_ PLT-2.1 · _data:_ `webhook_events` table. _accept:_ replaying a stored webhook reproduces the same enqueue idempotently. _test:_ pytest. _xc:_ idem, obs.

### ING-4 Raw storage & dedup
- **ING-4.1 — Idempotent raw upsert (by provider txn id)** `[built]` `M` `data` — upsert keyed on provider transaction id.
  _data:_ unique `raw_transactions.plaid_transaction_id` (already `unique=True, index=True`). _accept:_ re-ingesting same txn updates in place, never duplicates. _test:_ pytest (`GF-REPLAY`: ingest same payload 3× → 1 row, fields reflect latest). _xc:_ idem.
- **ING-4.2 — Raw dedup (pending vs posted)** `[new]` `M` `data` — collapse pending+posted of one purchase.
  _deps:_ ING-4.1 · _data:_ dedup via `pending_transaction_id`. _accept:_ one logical purchase = one canonical raw row. _test:_ pytest (pending+posted of one purchase → 1 canonical row; distinct same-amount purchases stay separate). _xc:_ idem.
- **ING-4.3 — Raw JSON preservation** `[built]` `S` `data` — keep provider payload verbatim.
  _data:_ `raw_transactions.raw_json`. _accept:_ original provider JSON retrievable for replay/debug. _test:_ pytest. _xc:_ idem.

### ING-5 Orchestration & reliability
- **ING-5.1 — Sync run records + outcomes** `[built]` `S` `data` — one `sync_runs` row per job with status/error/timing.
  _data:_ `sync_runs`. _accept:_ every sync writes start/finish/status. _test:_ pytest. _xc:_ obs, idem.
- **ING-5.2 — Per-item rate limiting + backoff** `[new]` `M` `api` — respect provider limits with jittered backoff.
  _deps:_ PLT-3.5 · _accept:_ 429 from provider triggers backoff, not failure. _test:_ pytest. _xc:_ rate, obs.
- **ING-5.3 — Partial failure isolation** `[new]` `M` `api` — one account/item failing doesn't fail the whole run.
  _deps:_ ING-5.1 · _accept:_ run with one bad item still imports the good ones and reports partial. _test:_ pytest. _xc:_ obs, idem.
- **ING-5.4 — Manual full re-sync action** `[built]` `S` `api` — force a complete re-pull.
  _accept:_ re-sync re-applies history idempotently (no dupes). _test:_ pytest. _xc:_ idem, rate.
- **ING-5.5 — Sync result notifications (new txns, errors)** `[partial]` `M` `api` — emit notifications on outcome.
  _deps:_ NTF-5.3 · _data:_ writes `notification_events`. _accept:_ a sync importing new txns produces a notification; errors notify too. _test:_ pytest. _xc:_ obs.

---

## LDG — Ledger Core & Normalization

### LDG-1 Normalization pipeline
- **LDG-1.1 — Raw→ledger normalization service** `[built]` `M` `api` — derive a `LedgerEvent` from each raw transaction.
  _data:_ `raw_transactions`→`ledger_events`. _accept:_ every non-removed raw row yields exactly one ledger event. _test:_ pytest (N raw rows → N events; removed rows → 0). _xc:_ idem, money.
- **LDG-1.2 — Idempotent ledger derivation (no dup events)** `[partial]` `M` `data` — re-derivation never doubles events.
  _skill:_ db-evolution · _deps:_ LDG-1.1 · _data:_ unique `ledger_events.raw_transaction_id`. _accept:_ running derivation twice yields identical event set. _test:_ pytest (`GF-REPLAY`: derive 2× → identical event count + ids). _xc:_ idem.
- **LDG-1.3 — Ledger re-derivation/replay command** `[new]` `M` `data` — rebuild ledger from raw on demand (e.g., after rule change).
  _deps:_ LDG-1.2 · _accept:_ replay reproduces ledger while preserving manual overrides. _test:_ pytest. _xc:_ idem.
- **LDG-1.4 — Sign/direction normalization** `[built]` `S` `data` — normalize provider sign conventions to `direction` in/outflow.
  _data:_ `ledger_events.direction`. _accept:_ inflows/outflows are correctly signed regardless of provider convention. _test:_ pytest. _xc:_ money.

### LDG-2 Money-flow semantics
- **LDG-2.1 — Event-type taxonomy (purchase/income/fee/transfer/payment/refund)** `[partial]` `M` `data` — canonical `event_type` enum.
  _data:_ `ledger_events.event_type` enum. _accept:_ each event classified into exactly one type. _test:_ pytest. _xc:_ idem.
- **LDG-2.2 — Transfer candidate pairing (opposite amount/date window)** `[new]` `M` `data` — find candidate in/out pairs across accounts.
  _deps:_ LDG-2.1, LDG-4.3 · _data:_ candidate pairs keyed on equal `amount_minor` + opposite `direction` + date within window; index `(user_id, amount_minor, date)`. _accept:_ a $500 out + $500 in within window are flagged as a candidate pair. _test:_ pytest (`GF-TRANSFER`: yields the pair; a same-amount unrelated purchase does not pair). _xc:_ money, idem.
- **LDG-2.6 — Transfer confirmation + flagging** `[new]` `M` `data` — promote confirmed pairs to `is_transfer=true` on both legs.
  _deps:_ LDG-2.2 · _data:_ sets `ledger_events.is_transfer` + pair link. _accept:_ confirming a pair excludes both legs from true-spend; unmatch reverts. _test:_ pytest (`GF-TRANSFER`: confirm → both legs `is_transfer`; unmatch → both revert, idempotent). _xc:_ idem, money.
- **LDG-2.3 — Card-payment detection + exclusion** `[partial]` `M` `data` — detect credit-card payments (checking→card).
  _deps:_ LDG-2.2 · _data:_ `ledger_events.is_card_payment`. _accept:_ a detected card payment is excluded from spend. _test:_ pytest (`GF-CARDPAY`: checking→card payment flagged + excluded; the card's underlying purchases stay counted — not double-excluded). _xc:_ money, idem.
- **LDG-2.4 — True-spend computation** `[built]` `M` `api` — spend excluding transfers/card payments/excluded.
  _deps:_ LDG-2.3, LDG-2.6 · _data:_ feeds `DashboardSummary.true_spend_this_month`. _accept:_ true-spend = Σ(outflow) − transfers − card-payments − excluded − refunds. _test:_ pytest (`GF-TRUESPEND`: asserts the exact computed total on the fixed mixed-month dataset). _xc:_ money.
- **LDG-2.5 — Manual exclude-from-spend override** `[built]` `S` `web` — user toggles `exclude_from_spend`.
  _data:_ `PATCH /transactions/{id}` `exclude_from_spend`. _accept:_ toggling immediately changes true-spend total. _test:_ playwright + pytest. _xc:_ money, authz, a11y.

### LDG-3 Balances & net worth
- **LDG-3.1 — Account balance store + history** `[partial]` `M` `data` — current + dated historical balances.
  _deps:_ LDG-4.3 · _data:_ `balance_history`(account_id, balance_minor, as_of) unique `(account_id, as_of)`; `financial_accounts.current_balance`. _accept:_ each sync records a dated balance row. _test:_ pytest (`GF-REPLAY`: two syncs same day → 1 row upserted, not 2). _xc:_ money, idem.
- **LDG-3.2 — Net worth computation (assets − liabilities)** `[new]` `M` `api` — aggregate across accounts incl. manual + investments.
  _deps:_ LDG-3.1, SRC-5.2 · _data:_ `GET /net-worth`; new shared type. _accept:_ net worth = assets − liabilities across all accounts. _test:_ pytest. _xc:_ money, authz.
- **LDG-3.3 — Net worth over-time snapshots** `[new]` `M` `data` — periodic net-worth snapshots.
  _deps:_ LDG-3.2 · _data:_ `net_worth_snapshots`. _accept:_ daily snapshot stored; series queryable. _test:_ pytest. _xc:_ money, idem.
- **LDG-3.4 — Credit utilization + total owed** `[new]` `M` `api` — sum liabilities + utilization % per card.
  _deps:_ LDG-3.1 · _data:_ derives from credit accounts (limit vs balance). _accept:_ utilization computed per card and in aggregate. _test:_ pytest. _xc:_ money.
- **LDG-3.5 — Balance reconciliation (derived vs reported)** `[new]` `M` `api` — compare ledger-derived balance to provider-reported; flag drift.
  _deps:_ LDG-3.1, LDG-1.2 · _accept:_ a mismatch between summed events and reported balance is flagged with the delta. _test:_ pytest (golden drift case). _xc:_ money, obs.
- **LDG-3.6 — Manual cash adjustment / reconcile entry** `[new]` `M` `web` — adjust a manual cash/asset account to a counted balance.
  _deps:_ SRC-8.3, LDG-3.5 · _data:_ writes an adjustment ledger event to true up balance. _accept:_ reconciling sets the manual account to the entered balance via an adjustment event. _test:_ playwright + pytest. _xc:_ money, idem, authz, a11y.

### LDG-4 Currency & amounts
- **LDG-4.3 — Migrate money Float→integer minor units (schema+backfill)** `[new]` `M` `data` — add integer minor-unit columns + backfill from `Float`.
  _skill:_ db-evolution · _deps:_ PLT-2.1, PLT-2.3 · _data:_ add `amount_minor`(BigInt) to `ledger_events`/`raw_transactions` + `current_balance_minor`/`available_balance_minor` to `financial_accounts`; backfill `round(amount*100)` per `iso_currency_code` exponent. _accept:_ backfill is exact and re-runnable; Σ(amount_minor)/100 reconciles to Σ(float) within rounding tolerance. _test:_ pytest (`GF-MONEY`: `19.99`→1999, `0.1+0.2` no drift, half-cent rounds deterministically; `GF-REPLAY`: 2nd backfill 0 row delta). _xc:_ money, idem. _risk:_ float→int rounding edge cases; assert tolerance + reconcile totals before cutover (LDG-4.4).
- **LDG-4.4 — Cut over reads/writes to minor units** `[new]` `M` `api` — switch app + API + shared types to integer money; drop float reliance.
  _deps:_ LDG-4.3 · _data:_ `amount`/balances serialized as minor-unit ints in `schemas.py` + `api-types`. _accept:_ no money arithmetic uses Float; serialized amounts are ints. _test:_ pytest + vitest. _xc:_ money.
- **LDG-4.1 — Multi-currency amount model** `[new]` `M` `data` — store amount + currency consistently.
  _deps:_ LDG-4.4 · _data:_ `(amount_minor, currency)` pairs; `iso_currency_code` already present. _accept:_ a EUR transaction stores EUR, not silently USD. _test:_ pytest. _xc:_ money.
- **LDG-4.2 — FX rate fetch + conversion** `[new]` `M` `api` — fetch daily FX; convert to primary currency for rollups.
  _deps:_ LDG-4.1 · _data:_ `fx_rates`(base, quote, date, rate). _accept:_ multi-currency totals convert to primary currency at txn-date rate. _test:_ pytest. _xc:_ money, rate. _risk:_ FX source reliability; cache + fallback to last-known rate.

---

## ENR — Enrichment, Matching & Dedup

### ENR-1 Merchant enrichment
- **ENR-1.1 — Merchant name normalization** `[new]` `M` `data` — clean raw descriptors → human merchant names.
  _data:_ normalized name on `ledger_events.merchant_name` (raw kept). _accept:_ "SQ *BLUE BOTTLE #123" → "Blue Bottle". _test:_ pytest (fixture descriptors). _xc:_ idem.
- **ENR-1.2 — Merchant logo/domain enrichment** `[new]` `S` `api` — attach domain/logo to merchant.
  _deps:_ ENR-1.3 · _accept:_ known merchant shows logo in UI. _test:_ pytest. _xc:_ rate.
- **ENR-1.3 — Canonical merchant entity table** `[new]` `M` `data` — dedup merchants to canonical entities.
  _deps:_ PLT-2.1, ENR-1.1 · _data:_ `merchants` table + FK from events. _accept:_ variants map to one merchant id. _test:_ pytest. _xc:_ idem.

### ENR-2 Cross-source matching
- **ENR-2.1 — Match candidate generation (blocking by amount+date)** `[new]` `M` `data` — generate candidate pairs across sources via blocking keys.
  _deps:_ LDG-4.3 · _data:_ candidate index on `(user_id, amount_minor, date)` with ±window. _accept:_ given two sources of one purchase, the pair is a candidate. _test:_ pytest (`GF-DEDUP`: bank+Venmo+receipt of the $42.17 purchase generate the candidate pairs; unrelated same-amount rows outside window don't). _xc:_ money, idem.
- **ENR-2.6 — Match scoring + link model** `[new]` `M` `data` — score candidates (amount/date/merchant) + persist `match_links`.
  _deps:_ ENR-2.1 · _data:_ `match_links`(left_event, right_event, score, status) unique `(least(left,right), greatest(left,right))` to prevent dup links. _accept:_ high-score pair auto-linked, mid-score queued, low-score dropped. _test:_ pytest (scoring thresholds on `GF-DEDUP`; `GF-REPLAY`: re-score → no dup links). _xc:_ idem.
- **ENR-2.2 — Bank ↔ Venmo match** `[new]` `M` `data` — match bank charge to Venmo activity.
  _deps:_ SRC-3.3, ENR-2.6 · _accept:_ a Venmo payment and its bank funding link as one truth. _test:_ pytest. _xc:_ idem, money.
- **ENR-2.3 — Bank ↔ PayPal match** `[new]` `M` `data` — match bank charge to PayPal txn.
  _deps:_ SRC-4.2, ENR-2.6 · _accept:_ PayPal purchase + bank funding linked. _test:_ pytest. _xc:_ idem, money.
- **ENR-2.4 — Transaction ↔ receipt match** `[new]` `M` `data` — link receipts to ledger events.
  _deps:_ RCP-1.3, ENR-2.6 · _accept:_ a receipt matches its transaction by amount+merchant+date. _test:_ pytest. _xc:_ idem, money.
- **ENR-2.5 — Match confidence + manual confirm UI** `[new]` `M` `web` — review/confirm/reject mid-confidence matches.
  _deps:_ ENR-2.6 · _accept:_ user can confirm/reject a suggested match and it sticks. _test:_ playwright. _xc:_ a11y, authz.

### ENR-3 Dedup across sources
- **ENR-3.1 — Cross-source dedup model (canonical purchase + members)** `[new]` `M` `data` — one purchase = one canonical record with N source members.
  _skill:_ db-evolution · _deps:_ ENR-2.6 · _data:_ `purchase_groups` + member links (each ledger event in ≤1 group); canonical chosen by source precedence (bank > card > Venmo/PayPal > receipt). _accept:_ bank+Venmo+receipt of one purchase roll up to a single canonical amount counted once. _test:_ pytest (`GF-DEDUP`: 3 sources → exactly 1 purchase_group, canonical = bank row). _xc:_ idem, money.
- **ENR-3.4 — Dedup application to spend totals** `[new]` `M` `api` — ensure deduped purchases count once in spend/reports.
  _deps:_ ENR-3.1, LDG-2.4 · _accept:_ true-spend counts a deduped purchase exactly once. _test:_ pytest (`GF-DEDUP`: true-spend counts $42.17 once, not 3×; `GF-REPLAY`: recompute is stable). _xc:_ money, idem.
- **ENR-3.2 — Dedup review/merge UI** `[new]` `M` `web` — review suggested merges; merge/split.
  _deps:_ ENR-3.1 · _accept:_ user merges two rows into one purchase from the UI. _test:_ playwright. _xc:_ a11y, authz.
- **ENR-3.3 — Unmerge / split-back action** `[new]` `S` `api` — reverse a merge.
  _deps:_ ENR-3.1 · _accept:_ unmerge restores independent events and totals. _test:_ pytest. _xc:_ idem, authz.

### ENR-4 Splitting
- **ENR-4.1 — Split transaction model (parent + child splits)** `[new]` `M` `data` — model a transaction split into N parts summing to the whole.
  _deps:_ LDG-4.3 · _data:_ `transaction_splits`(parent_event, amount_minor, category); parent flagged split. _accept:_ Σ(child amount_minor) == parent amount_minor exactly; reject otherwise. _test:_ pytest (`GF-SPLIT`: $90 → 3×$30 saves; $90 → $30+$30+$25 rejected; integer-exact, no float drift). _xc:_ money, idem.
- **ENR-4.4 — Split editor UI** `[new]` `M` `web` — add/remove split rows with live remainder.
  _deps:_ ENR-4.1 · _accept:_ editor blocks save unless splits reconcile to total. _test:_ playwright + vitest. _xc:_ money, a11y.
- **ENR-4.2 — Split across categories** `[new]` `M` `web` — assign a category per split.
  _deps:_ ENR-4.4, CAT-1.1 · _accept:_ split categories appear correctly in category reports. _test:_ playwright. _xc:_ a11y.
- **ENR-4.3 — Split for reimbursement (mark portion owed)** `[new]` `M` `api` — mark a split as receivable.
  _deps:_ ENR-4.1, OWE-1.1 · _accept:_ marking a split reimbursable creates a receivable for that amount. _test:_ pytest. _xc:_ money, idem, authz.

---

## RCP — Receipts, Invoices & Line Items

### RCP-1 Capture
- **RCP-1.1 — Receipt image upload (web)** `[new]` `M` `web` — drag/drop or camera capture upload.
  _deps:_ RCP-1.2 · _accept:_ uploading an image creates a receipt record with a stored image. _test:_ playwright. _xc:_ a11y, authz.
- **RCP-1.2 — Receipt blob storage** `[new]` `M` `infra` — store images in Blob with signed access.
  _skill:_ vercel-storage · _data:_ `receipts.blob_url` + access control. _accept:_ only owner can fetch their receipt image (signed URL). _test:_ pytest + manual. _xc:_ authz, crypto.
- **RCP-1.3 — Gmail receipt fetch → receipt record** `[new]` `M` `api` — turn fetched receipt emails into receipt records.
  _deps:_ SRC-6.5 · _data:_ `receipts` rows from email source. _accept:_ a fetched receipt email becomes a receipt, idempotent by message id. _test:_ pytest. _xc:_ idem, authz.
- **RCP-1.4 — Email receipt HTML parser (structure)** `[new]` `M` `data` — extract totals/merchant/date from common HTML receipt layouts.
  _deps:_ RCP-1.3 · _accept:_ amazon/uber/doordash sample emails parse to merchant+total+date. _test:_ pytest (fixture emails). _xc:_ idem, money. _risk:_ template drift; design parser as pluggable per-sender adapters.
- **RCP-1.5 — Email receipt line-item parser** `[new]` `M` `data` — extract per-item rows from HTML receipts.
  _deps:_ RCP-1.4, RCP-3.1 · _accept:_ itemized email yields per-line rows summing to total. _test:_ pytest. _xc:_ money, idem.

### RCP-2 Parsing / OCR
- **RCP-2.1 — SPIKE: OCR vendor (Textract vs GPT-4o vision vs Tesseract)** `[new]` `S` `research` — accuracy vs cost-per-receipt. **(v2 grounding: Textract AnalyzeExpense ≈ $0.01/page, returns pre-normalized expense fields; GPT-4o vision ≈ $0.01–0.03/receipt token-based, flexible but needs sum-invariant guard; Tesseract ≈ $0 but lower accuracy on photos. Likely: Textract/Tesseract for header fields, vision-LLM only for messy/itemized.)**
  _accept:_ recommendation with measured per-receipt cost + field accuracy on a 20-receipt sample set per vendor. _test:_ doc. _cost:_ <$5 to benchmark the sample set across vendors. _decide-by:_ before RCP-2.2; exit = chosen primary OCR path + when to escalate to vision-LLM. _risk:_ OCR cost at scale; favor cheap OCR first, vision-LLM only when rules/confidence fail.
- **RCP-2.2 — Receipt OCR text extraction** `[new]` `M` `api` — image → raw text/tokens via chosen vendor.
  _deps:_ RCP-2.1, RCP-1.2 · _skill:_ ai-sdk, ai-gateway · _accept:_ uploaded image returns OCR text stored on the receipt. _test:_ pytest (mocked vendor). _xc:_ rate, obs.
- **RCP-2.5 — OCR text → structured header fields** `[new]` `M` `api` — parse merchant/total/tax/date from OCR text.
  _deps:_ RCP-2.2 · _skill:_ ai-sdk · _data:_ structured fields on `receipts`. _accept:_ OCR text yields merchant+total+date+tax with confidence. _test:_ pytest (mocked model; schema-validated). _xc:_ money, rate, obs.
- **RCP-2.3 — LLM line-item extraction** `[new]` `M` `api` — structured per-line items from receipt text/image.
  _deps:_ RCP-2.2, RCP-3.1 · _skill:_ ai-sdk · _accept:_ Σ(line items) (±tax/tip) == receipt total; mismatch flagged. _test:_ pytest (structured-output schema + sum check; hallucinated total → flagged, not saved). _xc:_ money, rate, obs. _risk:_ LLM hallucinated totals; validate sum invariant + flag mismatch.
- **RCP-2.4 — Parser confidence + review** `[new]` `M` `web` — review/correct low-confidence parses.
  _deps:_ RCP-2.5 · _accept:_ low-confidence receipt routes to review and corrections persist. _test:_ playwright. _xc:_ a11y.

### RCP-3 Line items
- **RCP-3.1 — Line item model (product/service, qty, unit price)** `[new]` `M` `data` — itemized lines under a receipt.
  _deps:_ LDG-4.3 · _data:_ `receipt_line_items`(receipt_id, desc, qty, unit_price_minor, total_minor). _accept:_ line items persist with integer money. _test:_ pytest. _xc:_ money, idem.
- **RCP-3.2 — Line items ↔ ledger linkage** `[new]` `M` `data` — connect receipt lines to the matched transaction/splits.
  _deps:_ ENR-4.1, ENR-2.4 · _accept:_ a matched receipt's lines attach to the transaction and can drive splits. _test:_ pytest. _xc:_ money, idem.
- **RCP-3.3 — Per-line-item category assignment** `[new]` `M` `web` — categorize individual line items.
  _deps:_ CAT-1.1, RCP-3.1 · _accept:_ assigning categories per line shows in category reports. _test:_ playwright. _xc:_ a11y.

### RCP-4 Invoice tracking
- **RCP-4.1 — Invoice model + lifecycle (received/paid/overdue)** `[new]` `M` `data` — invoices with due dates + status.
  _deps:_ LDG-4.3 · _data:_ `invoices`(payee, amount_minor, due_date, status) index `(user_id, status, due_date)`. _accept:_ invoice transitions received→paid/overdue correctly. _test:_ pytest. _xc:_ money, idem.
- **RCP-4.2 — Invoice extraction from Gmail** `[new]` `M` `api` — detect invoices in email → invoice records.
  _deps:_ SRC-6.5, RCP-4.1 · _accept:_ an invoice email creates an invoice with payee+amount+due. _test:_ pytest (fixtures). _xc:_ money, idem. _risk:_ invoice vs receipt disambiguation; use sender + keyword heuristics, confirm in review.
- **RCP-4.3 — Invoice → upcoming obligation linkage** `[new]` `M` `api` — link invoices to bills/upcoming obligations.
  _deps:_ OWE-5.1, RCP-4.1 · _accept:_ an unpaid invoice appears as an upcoming obligation in cash projection. _test:_ pytest. _xc:_ money.

---

## CAT — Categorization & Rules

### CAT-1 Taxonomy
- **CAT-1.1 — Two-level taxonomy (groups → categories)** `[new]` `M` `data` — category groups → categories hierarchy.
  _deps:_ PLT-2.1 · _data:_ `category_groups`, `categories`(group_id, name, is_default) unique `(group_id, name)`; `ledger_events.category/subcategory` reference. _accept:_ categories nest under groups; every event maps to one category. _test:_ pytest (nesting + every seeded category resolves to a group). _xc:_ idem.
- **CAT-1.2 — Default category seed set (+ icon/emoji)** `[new]` `S` `data` — opinionated default taxonomy seeded idempotently.
  _deps:_ CAT-1.1, PLT-1.2 · _accept:_ seeding twice yields one default set. _test:_ pytest. _xc:_ idem.
- **CAT-1.3 — Custom user categories CRUD** `[new]` `M` `api` — user-defined categories.
  _deps:_ CAT-1.1 · _data:_ `categories.user_id` (null=global). _accept:_ user creates/edits a category scoped to them. _test:_ pytest. _xc:_ authz.
- **CAT-1.4 — Category merge / rename / archive** `[new]` `M` `api` — lifecycle ops that reassign affected events.
  _deps:_ CAT-1.3 · _accept:_ merging A into B reassigns A's events to B; archive hides without data loss. _test:_ pytest (reassignment + idempotent). _xc:_ idem, authz.

### CAT-2 Manual categorization
- **CAT-2.1 — Inline category edit on transaction** `[built]` `S` `web` — edit category in the transaction list.
  _data:_ `PATCH /transactions/{id}` `category/subcategory`. _accept:_ edit persists and updates reports. _test:_ playwright + pytest. _xc:_ authz, a11y.
- **CAT-2.2 — Bulk categorize selection** `[new]` `M` `web` — multi-select → set category.
  _deps:_ CAT-2.3 · _data:_ batch PATCH endpoint. _accept:_ selecting N txns and categorizing updates all N. _test:_ playwright + pytest. _xc:_ authz, a11y.
- **CAT-2.3 — Category picker with search** `[new]` `S` `web` — searchable grouped picker.
  _deps:_ CAT-1.1 · _accept:_ typing filters categories; keyboard-selectable. _test:_ vitest. _xc:_ a11y.

### CAT-3 Rules engine
- **CAT-3.1 — Rule model (match → set category/flags)** `[new]` `M` `data` — conditions (merchant/amount/account) → actions (category, flags).
  _deps:_ CAT-1.1 · _data:_ `categorization_rules`(user_id, match_json, actions_json, priority) index `(user_id, priority)`. _accept:_ a rule persists and is user-scoped. _test:_ pytest (rule round-trips, user-scoped). _xc:_ authz, idem.
- **CAT-3.2 — Rule evaluation on ingest** `[new]` `M` `api` — apply rules during normalization.
  _deps:_ CAT-3.1, LDG-1.1 · _accept:_ matching txn gets the rule's category at ingest. _test:_ pytest. _xc:_ idem.
- **CAT-3.3 — "Apply to all future/past matching" on edit** `[new]` `M` `api` — turn a manual edit into a rule + backfill.
  _deps:_ CAT-3.1, LDG-1.3 · _accept:_ "apply to all" recategorizes past matches and future ones. _test:_ pytest (backfill idempotent). _xc:_ idem, authz.
- **CAT-3.4 — Rules management page** `[new]` `M` `web` — list/create/reorder rules.
  _deps:_ CAT-3.1 · _accept:_ user creates and reorders rules from the UI. _test:_ playwright. _xc:_ a11y, authz.
- **CAT-3.5 — Rule priority/conflict resolution** `[new]` `M` `api` — deterministic precedence among rules.
  _deps:_ CAT-3.2 · _accept:_ conflicting rules resolve by priority deterministically. _test:_ pytest. _xc:_ idem.

### CAT-4 LLM categorization
- **CAT-4.1 — LLM categorization service (structured output)** `[new]` `M` `api` — single-txn classify → category via structured output.
  _skill:_ ai-sdk, ai-gateway · _deps:_ CAT-1.1, SEC-5.2 · _data:_ writes `category`+`confidence` on event. _accept:_ given a merchant/amount, returns a valid taxonomy category + confidence. _test:_ pytest (mocked model, schema-validated). _xc:_ rate, obs. _risk:_ off-taxonomy outputs; constrain to enum + reject invalid.
- **CAT-4.4 — Categorization prompt + taxonomy grounding** `[new]` `M` `api` — prompt template injecting user taxonomy + examples (constrains CAT-4.1 to valid categories).
  _deps:_ CAT-4.1 · _skill:_ ai-sdk · _accept:_ prompt only offers existing categories; new ones not invented. _test:_ pytest (prompt snapshot + output constrained to enum; off-taxonomy reply rejected). _xc:_ obs, rate.
- **CAT-4.2 — Batch categorize uncategorized** `[new]` `M` `api` — async batch over uncategorized events.
  _deps:_ CAT-4.1, PLT-3.1 · _accept:_ batch job categorizes the backlog and is resumable. _test:_ pytest. _xc:_ idem, rate, obs.
- **CAT-4.3 — Confidence threshold to auto-apply vs queue** `[new]` `M` `api` — high-confidence auto-applies, else to review queue.
  _deps:_ CAT-4.1, REV-1.1 · _accept:_ below-threshold predictions land in review, not auto-applied. _test:_ pytest. _xc:_ idem.
- **CAT-4.5 — LLM cost controls + caching** `[new]` `M` `api` — cache by merchant signature; budget guard.
  _deps:_ CAT-4.1 · _skill:_ ai-gateway · _accept:_ repeat merchant hits cache (no new LLM call); budget cap enforced. _test:_ pytest (cache hit + cap). _xc:_ rate, obs.

### CAT-5 Learning
- **CAT-5.1 — Learn-from-corrections feedback store** `[new]` `M` `data` — record every manual correction with context.
  _deps:_ PLT-2.1 · _data:_ `category_corrections`(event_id, from, to, merchant, at). _accept:_ each correction writes a feedback row. _test:_ pytest. _xc:_ authz, idem.
- **CAT-5.2 — Auto-suggest rule from repeated corrections** `[new]` `M` `api` — propose a rule after N same corrections.
  _deps:_ CAT-3.1, CAT-5.1 · _accept:_ 3 identical corrections suggest a rule the user can accept. _test:_ pytest (fixture: 3 same merchant→category corrections trigger exactly 1 rule suggestion; 2 do not). _xc:_ idem.
- **CAT-5.3 — Per-merchant remembered category** `[new]` `M` `data` — sticky last-confirmed category per merchant.
  _deps:_ ENR-1.3, CAT-5.1 · _accept:_ a new txn from a corrected merchant uses the remembered category. _test:_ pytest (correct merchant once → next same-merchant txn pre-fills remembered category). _xc:_ idem.

---

## OWE — Receivables, Returns & Obligations

### OWE-1 Reimbursements (owed to me)
- **OWE-1.1 — Reimbursement claim model (amount, by whom, status)** `[new]` `M` `data` — receivable tied to a transaction/split.
  _deps:_ LDG-4.3 · _data:_ `receivables`(user_id, source_event_id, debtor, amount_minor, status) index `(user_id, status)`. _accept:_ a receivable persists with open/settled status. _test:_ pytest. _xc:_ money, authz, idem.
- **OWE-1.2 — Mark transaction/split as reimbursable** `[new]` `M` `web` — flag a txn/split as owed.
  _deps:_ ENR-4.3 · _accept:_ marking creates a receivable and shows an owed badge. _test:_ playwright + pytest. _xc:_ money, a11y.
- **OWE-1.3 — Settle reimbursement (match incoming payment)** `[new]` `M` `api` — close receivable when matching inflow arrives.
  _deps:_ ENR-2.6, OWE-1.1 · _accept:_ an incoming payment matching the amount settles the receivable. _test:_ pytest (`GF-SPLIT`: incoming $30 Venmo settles one $30 receivable, not both; partial payment leaves remainder open). _xc:_ money, idem.
- **OWE-1.4 — Outstanding receivables view** `[new]` `M` `web` — list of who owes what.
  _deps:_ OWE-1.1 · _accept:_ shows total owed + per-debtor breakdown. _test:_ playwright. _xc:_ money, a11y.

### OWE-2 Group pay / split (Venmo-back)
- **OWE-2.1 — Group expense model (I paid, owed by N)** `[new]` `M` `data` — one expense split across participants.
  _deps:_ OWE-1.1 · _data:_ `group_expenses` + `participant_shares`. _accept:_ Σ(participant shares) == expense total exactly. _test:_ pytest (`GF-SPLIT`: $90/3 → 3×$30 sums; uneven $100/3 → $34+$33+$33 with remainder rule, no lost cent). _xc:_ money, idem.
- **OWE-2.2 — Split calculator UI** `[new]` `M` `web` — even/percent/custom split entry.
  _deps:_ OWE-2.1 · _accept:_ split calculator reconciles to total before save. _test:_ playwright + vitest. _xc:_ money, a11y.
- **OWE-2.3 — Venmo-back matching (incoming → settle split)** `[new]` `M` `api` — match incoming Venmo to participant shares.
  _deps:_ ENR-2.2, OWE-2.1 · _accept:_ a Venmo repayment settles the matching participant's share. _test:_ pytest. _xc:_ money, idem.

### OWE-3 Returns
- **OWE-3.1 — Return-intent model (item, expected refund)** `[new]` `M` `data` — track purchases intended for return.
  _deps:_ LDG-4.3 · _data:_ `returns`(source_event_id, expected_refund_minor, status). _accept:_ a return-intent persists with expected refund. _test:_ pytest. _xc:_ money, idem.
- **OWE-3.2 — Mark purchase "to return"** `[new]` `S` `web` — flag a purchase for return.
  _deps:_ OWE-3.1 · _accept:_ marking shows a "to return" badge + expected refund. _test:_ playwright. _xc:_ a11y.
- **OWE-3.3 — Refund matching (credit → close return)** `[new]` `M` `api` — close return when refund credit lands.
  _deps:_ ENR-2.6, OWE-3.1 · _accept:_ a matching refund credit closes the return. _test:_ pytest. _xc:_ money, idem.
- **OWE-3.4 — Pending returns view** `[new]` `S` `web` — list of open returns + expected refunds.
  _deps:_ OWE-3.1 · _accept:_ shows open returns with expected refund totals. _test:_ playwright. _xc:_ money, a11y.

### OWE-4 Scheduled / future transactions
- **OWE-4.1 — Scheduled/future transaction model** `[new]` `M` `data` — known upcoming inflows/outflows.
  _deps:_ LDG-4.3 · _data:_ `scheduled_transactions`(amount_minor, date, direction, source) index `(user_id, date)`. _accept:_ scheduled items persist and are queryable by date. _test:_ pytest. _xc:_ money, idem.
- **OWE-4.2 — Manual upcoming-transaction entry** `[new]` `S` `web` — add a known future txn.
  _deps:_ OWE-4.1 · _accept:_ manual upcoming item appears in projection. _test:_ playwright. _xc:_ money, a11y.
- **OWE-4.3 — Future cash-position projection** `[new]` `M` `api` — project balance forward from scheduled + recurring.
  _deps:_ OWE-4.1, INT-3.1 · _accept:_ projection reflects scheduled items + recurring streams. _test:_ pytest. _xc:_ money.

### OWE-5 Bills & recurring obligations
- **OWE-5.1 — Bill model (payee, amount, cadence, due)** `[new]` `M` `data` — recurring obligations with due dates.
  _deps:_ LDG-4.3 · _data:_ `bills`(payee, amount_minor, cadence, next_due) index `(user_id, next_due)`. _accept:_ a bill persists with cadence + next due date. _test:_ pytest. _xc:_ money, idem.
- **OWE-5.2 — Bill calendar view** `[new]` `M` `web` — calendar of upcoming bills.
  _deps:_ OWE-5.1 · _accept:_ bills render on their due dates. _test:_ playwright. _xc:_ a11y, money.
- **OWE-5.3 — Bill due reminders** `[new]` `M` `api` — notify ahead of due date.
  _deps:_ NTF-5.3, OWE-5.1 · _accept:_ a reminder fires N days before due. _test:_ pytest. _xc:_ obs, idem.
- **OWE-5.4 — Bill ↔ recurring stream linkage** `[new]` `M` `api` — link a bill to its detected recurring stream.
  _deps:_ INT-1.2, OWE-5.1 · _accept:_ a detected recurring stream auto-suggests a bill. _test:_ pytest. _xc:_ idem.

---

## INT — Intelligence: Recurring, Prediction & Anomaly

### INT-1 Recurring detection
- **INT-1.1 — Recurring grouping (cluster by merchant+amount)** `[new]` `M` `api` — cluster historical events into candidate streams.
  _deps:_ ENR-1.3, INT-1.2 · _accept:_ Netflix monthly charges cluster into one candidate stream. _test:_ pytest (`GF-RECURRING`: 13 monthly charges → 1 stream despite the $2 price-hike month). _xc:_ idem.
- **INT-1.5 — Cadence inference + next-date prediction** `[new]` `M` `api` — infer interval (weekly/monthly/annual) + predict next date.
  _deps:_ INT-1.1 · _accept:_ a monthly stream predicts the next charge date within tolerance. _test:_ pytest (`GF-RECURRING`: infers `monthly`, next-date within ±3 days). _xc:_ idem.
- **INT-1.2 — Recurring stream model + cadence** `[new]` `M` `data` — persist detected streams + members.
  _deps:_ PLT-2.1 · _data:_ `recurring_streams`(merchant_id, cadence, amount_minor, next_due, status) + member links. _accept:_ stream persists with cadence + members. _test:_ pytest. _xc:_ money, idem.
- **INT-1.3 — Recurring list + calendar view** `[new]` `M` `web` — list/calendar of recurring streams.
  _deps:_ INT-1.2 · _accept:_ recurring items show with cadence + next date. _test:_ playwright. _xc:_ a11y, money.
- **INT-1.4 — Confirm/dismiss detected recurring** `[new]` `S` `web` — confirm or reject a candidate.
  _deps:_ INT-1.2 · _accept:_ dismissing removes it from recurring; confirming keeps it. _test:_ playwright. _xc:_ a11y.

### INT-2 Subscriptions
- **INT-2.1 — Subscription candidate detection** `[new]` `M` `api` — flag recurring streams that look like subscriptions.
  _deps:_ INT-1.1 · _accept:_ fixed-amount monthly merchants flagged as subscriptions. _test:_ pytest. _xc:_ idem.
- **INT-2.2 — Subscription cost rollup (monthly/annual)** `[new]` `M` `api` — total recurring spend normalized to month/year.
  _deps:_ INT-2.1 · _accept:_ annualized total matches sum of streams. _test:_ pytest. _xc:_ money.
- **INT-2.3 — Forgotten/unused subscription flag** `[new]` `M` `api` — flag long-untouched/duplicate subscriptions.
  _deps:_ INT-2.1 · _accept:_ a subscription with no related activity for 90d is flagged. _test:_ pytest. _xc:_ idem. _risk:_ "unused" is heuristic; surface as suggestion, not auto-action.

### INT-3 Forecasting
- **INT-3.1 — Recurring-based forecast engine** `[new]` `M` `api` — project recurring inflows/outflows forward.
  _deps:_ INT-1.2 · _accept:_ forecast includes all active recurring streams over the horizon. _test:_ pytest. _xc:_ money.
- **INT-3.4 — Cash-flow forecast horizons (30/60/90d) API** `[new]` `M` `api` — expose forecast with scheduled + recurring + trend.
  _deps:_ INT-3.1, OWE-4.1 · _data:_ `GET /forecast?horizon=` + shared type. _accept:_ returns projected balance at 30/60/90d. _test:_ pytest. _xc:_ money.
- **INT-3.2 — Month-end balance projection** `[new]` `M` `api` — project end-of-month balance.
  _deps:_ INT-3.1 · _accept:_ projection equals current + expected remaining flows. _test:_ pytest. _xc:_ money.
- **INT-3.3 — Forecast vs actual tracking** `[new]` `M` `api` — compare prior forecasts to realized.
  _deps:_ INT-3.4 · _accept:_ shows forecast error per past period. _test:_ pytest. _xc:_ money, obs.

### INT-4 Anomaly / overcharge
- **INT-4.1 — Anomaly baseline + scoring** `[new]` `M` `api` — per-merchant/category baselines (mean/stdev) + z-score.
  _deps:_ ENR-1.3 · _accept:_ a 3x-typical charge scores as anomalous. _test:_ pytest (fixture: 12 ~$15 charges + one $50 → $50 flagged, $16 not). _xc:_ money, idem.
- **INT-4.5 — Anomaly surfacing + dismiss** `[new]` `M` `api` — turn high scores into reviewable anomaly items.
  _deps:_ INT-4.1 · _data:_ `anomalies` records (unique `(user_id, event_id)` so re-scan doesn't dup). _accept:_ anomalous charge appears as an anomaly the user can dismiss. _test:_ pytest (`GF-REPLAY`: re-scan → no dup anomaly; dismissed stays dismissed). _xc:_ idem.
- **INT-4.2 — Duplicate-charge detection** `[new]` `M` `api` — same merchant+amount within a short window.
  _deps:_ ENR-3.1 · _accept:_ a double charge is flagged (and not confused with deduped multi-source). _test:_ pytest (`GF-DEDUP` negative control: the 3-source single purchase is NOT flagged as duplicate; a genuine same-card double charge IS). _xc:_ money, idem.
- **INT-4.3 — Price-change detection on recurring** `[new]` `M` `api` — detect recurring amount increases.
  _deps:_ INT-1.2 · _accept:_ a subscription price hike is flagged with old→new amount. _test:_ pytest (`GF-RECURRING`: the $2 hike flagged with old→new; steady months not flagged). _xc:_ money.
- **INT-4.4 — Overcharge/unexpected-fee flag** `[new]` `M` `api` — flag unexpected fees vs baseline.
  _deps:_ INT-4.1 · _accept:_ a surprise fee is flagged for review. _test:_ pytest. _xc:_ money.

### INT-5 Predicted / forgotten charges
- **INT-5.1 — Predict upcoming charges (from recurring)** `[new]` `M` `api` — list charges expected soon.
  _deps:_ INT-1.2 · _accept:_ predicts the next charge per active stream. _test:_ pytest. _xc:_ money.
- **INT-5.2 — "Charge you may have forgotten" surfacing** `[new]` `M` `api` — surface expected-but-missing or annual surprises.
  _deps:_ INT-5.1 · _accept:_ an annual renewal due soon is surfaced ahead of time. _test:_ pytest. _xc:_ money.
- **INT-5.3 — Anomaly/prediction notification feed** `[new]` `M` `api` — emit notifications for anomalies/predictions.
  _deps:_ NTF-5.3, INT-4.5 · _data:_ writes `notification_events`. _accept:_ a new anomaly produces a notification. _test:_ pytest. _xc:_ obs.

---

## RPT — Analytics, Reports & Insights

### RPT-1 Dashboard
- **RPT-1.1 — Summary cards (cash/credit/in/out/true-spend)** `[built]` `M` `web` — top-line metrics from dashboard summary.
  _data:_ `GET /dashboard` → `DashboardSummary`. _accept:_ cards show cash, credit, inflow, outflow, true-spend for the month. _test:_ playwright + vitest. _xc:_ money, a11y.
- **RPT-1.2 — Dashboard widget framework (registry + layout state)** `[new]` `M` `web` — pluggable widget registry + persisted layout.
  _skill:_ shadcn · _deps:_ AUT-3.3 · _accept:_ a widget can be registered and its position persists per user. _test:_ vitest. _xc:_ a11y, authz.
- **RPT-1.5 — Widget drag-reorder + visibility toggles** `[new]` `M` `web` — rearrange/hide widgets.
  _deps:_ RPT-1.2 · _accept:_ reordering/hiding persists across reload. _test:_ playwright. _xc:_ a11y.
- **RPT-1.3 — Recent activity feed widget** `[built]` `S` `web` — recent transactions widget.
  _data:_ `recent_transactions` from dashboard. _accept:_ shows latest N transactions. _test:_ vitest. _xc:_ a11y.
- **RPT-1.4 — Net worth widget** `[new]` `M` `web` — net-worth tile.
  _deps:_ LDG-3.2, RPT-1.2 · _accept:_ widget shows current net worth + delta. _test:_ playwright. _xc:_ money, a11y.

### RPT-2 Cash flow
- **RPT-2.1 — Cash-flow report (in vs out over time)** `[new]` `M` `web` — inflow/outflow bars over time.
  _deps:_ RPT-2.4 · _accept:_ monthly in-vs-out renders from real ledger data. _test:_ playwright. _xc:_ money, a11y.
- **RPT-2.4 — Aggregation query API (group by period/category)** `[new]` `M` `api` — reusable rollup endpoint powering charts.
  _deps:_ LDG-4.4 · _data:_ `GET /reports/aggregate?by=period|category` + shared type. _accept:_ returns summed minor-unit amounts grouped as requested, true-spend aware. _test:_ pytest (`GF-TRUESPEND`: per-category + per-month sums reconcile to the dataset's true-spend total; excludes transfers/card-pay). _xc:_ money, authz.
- **RPT-2.2 — Sankey data builder (income→group→category)** `[new]` `M` `api` — build node/link graph for Sankey.
  _deps:_ RPT-2.4 · _accept:_ income→category flows sum consistently at each node. _test:_ pytest. _xc:_ money.
- **RPT-2.5 — Sankey visualization (web)** `[new]` `M` `web` — render the Sankey + interactions.
  _deps:_ RPT-2.2 · _skill:_ frontend-design · _accept:_ Sankey renders flows and supports click-through. _test:_ playwright. _xc:_ a11y, money.
- **RPT-2.3 — Click-to-filter from chart → transactions** `[new]` `M` `web` — chart segment → filtered list.
  _deps:_ NAV-3.1 · _accept:_ clicking a category slice opens transactions filtered to it. _test:_ playwright. _xc:_ a11y.

### RPT-3 Category analytics
- **RPT-3.1 — Spending by category (donut/bar)** `[new]` `M` `web` — category breakdown chart.
  _deps:_ RPT-2.4 · _accept:_ chart matches summed category totals. _test:_ playwright + vitest. _xc:_ money, a11y.
- **RPT-3.2 — Category drilldown (e.g., groceries detail)** `[new]` `M` `web` — drill into a category's merchants/txns.
  _deps:_ RPT-3.1 · _accept:_ drilldown lists the category's transactions + merchant split. _test:_ playwright. _xc:_ a11y.
- **RPT-3.3 — Health spend breakdown (derm/psych/glasses)** `[new]` `S` `web` — themed subcategory view.
  _deps:_ RPT-3.2 · _accept:_ health subcategories roll up correctly. _test:_ vitest. _xc:_ a11y.
- **RPT-3.4 — Merchant leaderboard** `[new]` `S` `web` — top merchants by spend.
  _deps:_ RPT-2.4, ENR-1.3 · _accept:_ ranks merchants by total spend for the period. _test:_ vitest. _xc:_ money, a11y.

### RPT-4 Trends & net worth
- **RPT-4.1 — Spending trends (MoM/YoY)** `[new]` `M` `web` — period-over-period trend.
  _deps:_ RPT-2.4 · _accept:_ shows MoM/YoY deltas per category. _test:_ playwright. _xc:_ money, a11y.
- **RPT-4.2 — Net worth over-time chart** `[new]` `M` `web` — net worth series.
  _deps:_ LDG-3.3 · _accept:_ chart plots net-worth snapshots over time. _test:_ playwright. _xc:_ money, a11y.
- **RPT-4.3 — Income vs expense trend** `[new]` `S` `web` — income vs expense over time.
  _deps:_ RPT-2.4 · _accept:_ overlays income vs expense per period. _test:_ vitest. _xc:_ money, a11y.

### RPT-5 Tax
- **RPT-5.1 — Tax-relevant tags** `[new]` `M` `data` — mark transactions tax-deductible/category.
  _deps:_ NAV-5.1 · _data:_ tax tag on transactions via tag system. _accept:_ tagged txns appear in a tax report. _test:_ pytest. _xc:_ authz.
- **RPT-5.2 — Estimated tax-payment tracker** `[new]` `M` `api` — track quarterly estimated payments.
  _deps:_ PLT-2.1 · _accept:_ records estimated payments and remaining liability. _test:_ pytest. _xc:_ money.
- **RPT-5.3 — Surplus/deficit (savings rate) report** `[new]` `M` `api` — income − true-spend savings rate.
  _deps:_ RPT-2.4 · _accept:_ savings rate = (income − true-spend) / income for period. _test:_ pytest. _xc:_ money.

### RPT-6 Budgets / targets
- **RPT-6.1 — Budget/target model per category** `[new]` `M` `data` — monthly budget per category.
  _deps:_ CAT-1.1, LDG-4.3 · _data:_ `budgets`(category_id, period, amount_minor). _accept:_ a budget persists per category+period. _test:_ pytest. _xc:_ money, idem.
- **RPT-6.2 — Budget vs actual report** `[new]` `M` `web` — progress bars per category.
  _deps:_ RPT-6.1, RPT-2.4 · _accept:_ shows spent vs budget with over/under per category. _test:_ playwright. _xc:_ money, a11y.
- **RPT-6.4 — Overspend alerts** `[new]` `M` `api` — notify when a category exceeds budget (or trending to).
  _deps:_ RPT-6.1, NTF-5.3 · _accept:_ crossing a budget threshold fires a notification. _test:_ pytest. _xc:_ money, obs, idem.
- **RPT-6.3 — Macro percentages (50/30/20) view** `[new]` `M` `web` — needs/wants/savings split.
  _deps:_ RPT-2.4 · _accept:_ classifies spend into 50/30/20 buckets. _test:_ vitest. _xc:_ money, a11y.

### RPT-7 Goals & savings
- **RPT-7.3 — Savings goal model (target, deadline, linked account)** `[new]` `M` `data` — goals toward a target amount.
  _deps:_ LDG-4.3 · _data:_ `goals`(name, target_minor, deadline, account_id). _accept:_ a goal persists with target + progress source. _test:_ pytest. _xc:_ money, idem.
- **RPT-7.4 — Goal progress tracking + view** `[new]` `M` `web` — progress vs target with projection.
  _deps:_ RPT-7.3, LDG-3.1 · _accept:_ goal shows % funded + projected completion date. _test:_ playwright. _xc:_ money, a11y.

### RPT-8 Saved & export
- **RPT-7.1 — Saved/bookmarked report views** `[new]` `M` `web` — save report+filter configs.
  _deps:_ NAV-3.2 · _accept:_ a saved view reloads with its filters intact. _test:_ playwright. _xc:_ authz, a11y.
- **RPT-7.2 — Export report (CSV/PDF)** `[new]` `M` `web` — export current report.
  _deps:_ RPT-2.4 · _accept:_ exported CSV totals match the on-screen report. _test:_ playwright + pytest. _xc:_ money, a11y.

---

## REV — Review Queue (Tinder UI)

### REV-1 Queue construction
- **REV-1.1 — Queue builder (uncategorized/low-confidence/anomalies)** `[new]` `M` `api` — assemble items needing attention.
  _deps:_ LDG-1.1 · _data:_ query over `ledger_events` (uncategorized, `confidence<θ`) + anomalies. _accept:_ queue contains uncategorized + low-confidence + flagged items. _test:_ pytest (fixture: 1 each uncategorized/low-conf/anomaly present; a confirmed high-conf event absent). _xc:_ authz.
- **REV-1.2 — Queue prioritization (confidence, recency, amount)** `[new]` `M` `api` — order by impact.
  _deps:_ REV-1.1 · _accept:_ highest-amount/lowest-confidence items surface first. _test:_ pytest. _xc:_ authz.
- **REV-1.3 — Queue API + pagination** `[new]` `S` `api` — `GET /review-queue` paginated.
  _deps:_ REV-1.2 · _data:_ shared `ReviewItem` type. _accept:_ paginates stably as items are resolved. _test:_ pytest. _xc:_ authz.

### REV-2 Swipe / keyboard review
- **REV-2.1 — Swipe card component (gestures)** `[new]` `M` `web` — swipeable card with gesture handling.
  _skill:_ frontend-design · _deps:_ REV-1.3 · _accept:_ swipe left/right triggers reject/accept on touch + pointer. _test:_ vitest (gesture handlers). _xc:_ a11y.
- **REV-2.5 — Review screen + queue wiring** `[new]` `M` `web` — screen that feeds cards from the queue.
  _deps:_ REV-2.1 · _accept:_ resolving a card advances to the next queued item. _test:_ playwright. _xc:_ a11y.
- **REV-2.2 — Keyboard shortcuts for review** `[new]` `S` `web` — keys for categorize/skip/flag.
  _deps:_ REV-2.5 · _accept:_ keyboard alone can process the queue. _test:_ playwright. _xc:_ a11y.
- **REV-2.3 — Undo last action** `[new]` `S` `web` — revert the previous decision.
  _deps:_ REV-2.5 · _accept:_ undo restores the last card + reverts its change. _test:_ playwright. _xc:_ a11y, idem.
- **REV-2.4 — Progress + empty state** `[new]` `S` `web` — progress meter + "all done" state.
  _deps:_ REV-2.5 · _accept:_ shows remaining count and a celebratory empty state at zero. _test:_ vitest. _xc:_ a11y.

### REV-3 Card actions
- **REV-3.1 — Quick-categorize action** `[new]` `S` `web` — categorize from the card.
  _deps:_ CAT-2.3, REV-2.5 · _accept:_ choosing a category resolves the card. _test:_ playwright. _xc:_ a11y.
- **REV-3.2 — Mark reimbursable/return/transfer** `[new]` `M` `web` — flag from the card.
  _deps:_ OWE-1.2, LDG-2.6, REV-2.5 · _accept:_ marking transfer excludes from spend; reimbursable creates a receivable. _test:_ playwright. _xc:_ money, a11y.
- **REV-3.3 — Split action from card** `[new]` `M` `web` — open split editor from the card.
  _deps:_ ENR-4.4, REV-2.5 · _accept:_ splitting from a card persists splits. _test:_ playwright. _xc:_ money, a11y.
- **REV-3.4 — Add note/receipt from card** `[new]` `S` `web` — attach note/receipt inline.
  _deps:_ RCP-1.1, NAV-5.2, REV-2.5 · _accept:_ note/receipt attaches to the transaction. _test:_ playwright. _xc:_ a11y.

### REV-4 Prioritization & nudges
- **REV-4.1 — Bulk review (apply to similar)** `[new]` `M` `web` — "apply to all like this" from a card.
  _deps:_ CAT-3.3, REV-2.5 · _accept:_ resolving with "apply to similar" clears matching queue items. _test:_ playwright. _xc:_ idem, a11y.
- **REV-4.2 — Daily review reminder** `[new]` `S` `api` — nudge when queue has items.
  _deps:_ NTF-5.3, REV-1.1 · _accept:_ a daily reminder fires only when items await. _test:_ pytest. _xc:_ obs, idem.

---

## NAV — App Shell, Search & Navigation

### NAV-1 Shell
- **NAV-1.1 — App shell + collapsible sidebar** `[built]` `M` `web` — persistent shell + nav.
  _accept:_ sidebar collapses and state persists. _test:_ vitest. _xc:_ a11y.
- **NAV-1.2 — Responsive layout (mobile web)** `[partial]` `M` `web` — mobile-first breakpoints.
  _accept:_ core screens usable at 375px width. _test:_ playwright (mobile viewport). _xc:_ a11y.
- **NAV-1.3 — Nav structure for all screens** `[partial]` `S` `web` — routes/nav entries for every screen.
  _accept:_ every top-level screen is reachable from nav. _test:_ playwright. _xc:_ a11y.

### NAV-2 Command-K
- **NAV-2.1 — Command-K palette (cmdk/kbar)** `[new]` `M` `web` — global command palette.
  _skill:_ shadcn · _accept:_ Cmd-K opens; navigates to a chosen destination. _test:_ playwright. _xc:_ a11y.
- **NAV-2.2 — Search index (txns/accounts/categories)** `[new]` `M` `api` — backend search across entities.
  _deps:_ NAV-3.3 · _data:_ `GET /search?q=` over txns/accounts/categories. _accept:_ query returns matching entities of each type. _test:_ pytest. _xc:_ authz.
- **NAV-2.3 — Quick actions in palette** `[new]` `S` `web` — actions (connect, add txn, go to review) in palette.
  _deps:_ NAV-2.1 · _accept:_ selecting an action runs it. _test:_ playwright. _xc:_ a11y.

### NAV-3 Search & filters
- **NAV-3.1 — Transaction filter API (multi-dimension)** `[partial]` `M` `api` — server-side filtering (date/amount/category/account/type/flags/merchant).
  _data:_ extend `GET /transactions` query params + indexes on `(user_id, date)`, `(user_id, category)`, `(user_id, account_id)`. _accept:_ each documented filter param narrows results correctly. _test:_ pytest (per-dimension narrowing + combined filters). _xc:_ authz, money.
- **NAV-3.4 — Transaction filter UI (chips + panel)** `[new]` `M` `web` — filter chips + panel bound to URL state.
  _deps:_ NAV-3.2 · _accept:_ applying filters updates the list and the URL. _test:_ playwright. _xc:_ a11y.
- **NAV-3.2 — Saved filter views (URL state via nuqs)** `[new]` `M` `web` — shareable filter state in URL + saved views.
  _deps:_ NAV-3.1 · _accept:_ a filtered URL reproduces the same view on load. _test:_ playwright. _xc:_ authz, a11y.
- **NAV-3.3 — Full-text transaction search** `[new]` `M` `api` — text search over merchant/description/notes.
  _deps:_ PLT-2.1 · _data:_ Postgres trigram/FTS index on `ledger_events`. _accept:_ searching a merchant substring returns its transactions. _test:_ pytest. _xc:_ authz.

### NAV-4 Theming
- **NAV-4.1 — Light/dark theme (next-themes)** `[new]` `S` `web` — theme toggle + system default.
  _accept:_ toggling theme persists and respects system preference. _test:_ playwright. _xc:_ a11y.
- **NAV-4.2 — Design tokens + shadcn theme** `[partial]` `M` `web` — token set + component theme.
  _skill:_ shadcn, frontend-design · _accept:_ components use shared tokens; contrast meets WCAG AA. _test:_ vitest + manual. _xc:_ a11y.

### NAV-5 Transaction notes, tags & attachments
- **NAV-5.1 — Tag model + transaction tagging** `[new]` `M` `data` — freeform/user tags on transactions.
  _deps:_ PLT-2.1 · _data:_ `tags` + `transaction_tags` join; extend `TransactionUpdate`/`api-types`. _accept:_ adding/removing a tag persists and is filterable. _test:_ pytest. _xc:_ authz, idem.
- **NAV-5.2 — Transaction notes** `[new]` `S` `web` — per-transaction free-text note.
  _deps:_ NAV-5.3 · _accept:_ a saved note persists and shows on the transaction. _test:_ playwright. _xc:_ a11y.
- **NAV-5.3 — Notes/attachments persistence API** `[new]` `M` `api` — store notes + attachment refs.
  _deps:_ PLT-2.1, SEC-2.1 · _data:_ `note` column (encrypted) + attachment refs on transaction. _accept:_ note + attachment round-trip via API, owner-scoped. _test:_ pytest. _xc:_ authz, crypto.
- **NAV-5.4 — Attach file/receipt to transaction** `[new]` `S` `web` — attach an arbitrary file/receipt.
  _deps:_ RCP-1.2, NAV-5.3 · _accept:_ attaching a file links it to the transaction with signed access. _test:_ playwright. _xc:_ authz, a11y.

---

## NTF — Notifications & Push

### NTF-1 In-app
- **NTF-1.1 — In-app notification center** `[built]` `M` `web` — list of notifications.
  _data:_ `GET /notifications` → `NotificationRead`. _accept:_ center lists user notifications newest-first. _test:_ playwright + vitest. _xc:_ authz, a11y.
- **NTF-1.2 — Mark read / read-all** `[built]` `S` `web` — mark individual/all read.
  _data:_ `PATCH /notifications/{id}/read`, `PATCH /notifications/read-all`. _accept:_ marking read clears the unread badge. _test:_ playwright + pytest. _xc:_ authz, a11y.
- **NTF-1.3 — Notification types + entity deep-links** `[partial]` `M` `data` — typed notifications linking to entities.
  _data:_ `notification_events.entity_type/entity_id`. _accept:_ clicking a notification navigates to its entity. _test:_ pytest + playwright. _xc:_ authz.
- **NTF-1.4 — Unread badge + polling** `[partial]` `S` `web` — unread count + refresh.
  _data:_ `DashboardSummary.unread_notifications`. _accept:_ new notification increments the badge within poll interval. _test:_ vitest. _xc:_ a11y.

### NTF-2 Preferences
- **NTF-2.1 — Per-type notification preferences** `[new]` `M` `api` — opt in/out per channel per type.
  _deps:_ AUT-3.3 · _data:_ prefs in `user_preferences`. _accept:_ disabling a type suppresses its notifications. _test:_ pytest. _xc:_ authz.
- **NTF-2.2 — Quiet hours / digest settings** `[new]` `M` `api` — quiet windows + digest cadence.
  _deps:_ NTF-2.1 · _accept:_ notifications in quiet hours defer to digest. _test:_ pytest. _xc:_ idem.

### NTF-3 Web push
- **NTF-3.1 — Service worker + push subscription (VAPID)** `[new]` `M` `web` — register SW + subscribe with VAPID.
  _accept:_ granting permission stores a push subscription server-side. _test:_ manual + vitest (subscribe logic). _xc:_ authz, crypto, a11y.
- **NTF-3.3 — Push subscription storage + lifecycle** `[new]` `S` `api` — persist/expire subscriptions.
  _deps:_ NTF-3.1, PLT-2.1 · _data:_ `push_subscriptions`(user_id, endpoint, keys) unique `endpoint`. _accept:_ expired/invalid subscriptions are pruned on send failure. _test:_ pytest (`GF-REPLAY`: re-subscribe same endpoint → 1 row; 410-on-send prunes it). _xc:_ authz, idem.
- **NTF-3.2 — Web push send pipeline** `[new]` `M` `api` — send web push via the dispatch service.
  _deps:_ PLT-3.1, NTF-3.3 · _accept:_ a triggered event delivers a web push to subscribed devices. _test:_ pytest (mocked push). _xc:_ obs, idem.

### NTF-4 iOS push
- **NTF-4.1 — iOS push (APNs) registration** `[new]` `M` `ios` — register device token.
  _deps:_ IOS-1.2 · _accept:_ app registers and stores an APNs token. _test:_ manual. _xc:_ authz.
- **NTF-4.2 — iOS push send pipeline** `[new]` `M` `api` — send via APNs.
  _deps:_ PLT-3.1, NTF-4.1 · _accept:_ a triggered event delivers an APNs push. _test:_ pytest (mocked APNs). _xc:_ obs, idem.

### NTF-5 Delivery pipeline
- **NTF-5.1 — Multi-channel dispatch service** `[new]` `M` `api` — route a notification to in-app/web/iOS per prefs.
  _deps:_ NTF-2.1 · _accept:_ one event fans out only to enabled channels. _test:_ pytest. _xc:_ obs, idem.
- **NTF-5.2 — Digest builder (daily/weekly)** `[new]` `M` `api` — batch deferred notifications into digests.
  _deps:_ NTF-2.2, PLT-3.1 · _accept:_ deferred items aggregate into one digest at cadence. _test:_ pytest (N deferred items → 1 digest at cadence). _xc:_ idem, obs, rate.
- **NTF-5.3 — Event triggers (new txn, anomaly, bill due)** `[partial]` `M` `api` — central trigger → notification creation.
  _data:_ writes `notification_events` (dedup key per trigger+entity). _accept:_ each trigger type creates the right notification once. _test:_ pytest (`GF-REPLAY`: same trigger fired twice → 1 notification). _xc:_ idem, obs.

---

## IOS — iOS App

### IOS-1 Shell & auth
- **IOS-1.1 — SPIKE: iOS approach (React Native/Expo vs Swift vs PWA)** `[new]` `S` `research` — pick the stack.
  _accept:_ recommendation weighing code-reuse vs native (push, biometrics, share-ext) + a UI-test story (Detox for RN / XCUITest for Swift) so iOS isn't manual-only. _test:_ doc. _cost:_ $99/yr Apple Developer Program; dev time only for the spike. _decide-by:_ before IOS-1.2; exit = chosen stack + automated UI-test framework + reuse % estimate. _risk:_ stack choice gates all IOS work; decide before IOS-1.2.
- **IOS-1.2 — App shell + tab navigation** `[new]` `M` `ios` — tab bar + navigation skeleton.
  _deps:_ IOS-1.1 · _accept:_ tabs route between placeholder screens. _test:_ manual + unit. _xc:_ a11y.
- **IOS-1.5 — Design system + shared components (iOS)** `[new]` `M` `ios` — typography/colors/components matching web tokens.
  _deps:_ IOS-1.2, NAV-4.2 · _accept:_ shared component kit renders consistently. _test:_ manual + snapshot. _xc:_ a11y.
- **IOS-1.3 — Clerk auth on iOS** `[new]` `M` `ios` — native sign-in via Clerk.
  _skill:_ clerk-cli · _deps:_ IOS-1.4 · _accept:_ user signs in and reaches the dashboard tab. _test:_ manual + UI-test (per IOS-1.1 framework). _xc:_ authz, a11y.
- **IOS-1.4 — API client + session** `[new]` `M` `ios` — typed client + token handling.
  _deps:_ IOS-1.2 · _accept:_ authenticated requests succeed; 401 triggers refresh. _test:_ unit. _xc:_ authz.

### IOS-2 Parity screens
- **IOS-2.1 — Dashboard screen** `[new]` `M` `ios` — summary cards + activity.
  _deps:_ IOS-1.5, RPT-1.1 · _accept:_ shows the same summary metrics as web. _test:_ manual + snapshot. _xc:_ money, a11y.
- **IOS-2.2 — Transactions list (virtualized)** `[new]` `M` `ios` — performant infinite list.
  _deps:_ IOS-1.5, NAV-3.1 · _accept:_ scrolls thousands of txns smoothly with filters. _test:_ manual. _xc:_ a11y, money.
- **IOS-2.6 — Transaction detail + edit** `[new]` `M` `ios` — detail with category/flags/notes edit.
  _deps:_ IOS-2.2 · _accept:_ editing a txn persists via API. _test:_ manual. _xc:_ authz, money, a11y.
- **IOS-2.3 — Review queue (native swipe)** `[new]` `M` `ios` — native swipe review.
  _deps:_ IOS-1.5, REV-1.3 · _accept:_ swipe categorizes and advances the queue. _test:_ manual + UI-test. _xc:_ a11y.
- **IOS-2.4 — Accounts screen** `[new]` `M` `ios` — accounts + balances + connect.
  _deps:_ IOS-1.5 · _accept:_ lists accounts with balances; can launch connect. _test:_ manual. _xc:_ money, a11y.
- **IOS-2.5 — Settings screen** `[new]` `M` `ios` — profile/prefs/connections/sign-out.
  _deps:_ IOS-1.5 · _accept:_ settings mirror web prefs and persist. _test:_ manual. _xc:_ authz, a11y.

### IOS-3 Native capabilities
- **IOS-3.1 — Push notifications (APNs)** `[new]` `M` `ios` — receive + deep-link pushes.
  _deps:_ NTF-4.1 · _accept:_ a push opens the relevant screen. _test:_ manual. _xc:_ authz, a11y.
- **IOS-3.2 — Biometric app lock (FaceID)** `[new]` `M` `ios` — FaceID gate on launch.
  _accept:_ app requires biometric unlock when enabled. _test:_ manual. _xc:_ authz, a11y.
- **IOS-3.3 — Share extension (save receipt to app)** `[new]` `M` `ios` — share a receipt image into the app.
  _deps:_ RCP-1.1 · _accept:_ sharing an image creates a receipt record. _test:_ manual. _xc:_ authz, a11y.
- **IOS-3.4 — Offline read-only cache** `[new]` `M` `ios` — cache recent data for offline viewing.
  _deps:_ IOS-1.4 · _accept:_ recent dashboard/txns viewable offline; mutations queue or block. _test:_ manual + UI-test. _xc:_ idem, a11y.

### IOS-4 Distribution
- **IOS-4.1 — TestFlight build + CI** `[new]` `M` `infra` — automated TestFlight pipeline.
  _accept:_ a tagged build lands in TestFlight. _test:_ manual + doc. _xc:_ obs.
- **IOS-4.2 — App Store submission prep** `[new]` `S` `infra` — metadata/privacy nutrition/screenshots.
  _deps:_ IOS-4.1 · _accept:_ submission checklist complete incl. privacy disclosures. _test:_ doc. _risk:_ App Store financial-app review scrutiny; prep privacy + data-use disclosures early.

---

_End of v2. Subsequent passes (v3–v8) continue refining the whole tree per the quality bar in 00-README.md §4. Leaf IDs are stable; splits keep the original ID and add new sibling numbers._
