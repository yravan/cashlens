# Cash Lens — Feature Tree (Iterative Build Backlog)

> A hierarchical, atomized backlog for the entire Cash Lens vision. Each **leaf** is a
> bite-sized, agent-dispatchable task: 1–3 PRs, **≤ ~500 LOC**, reviewable by hand.

## 0. Status — COMPLETE (v8 final)

- **346 leaves** across **17 epics** / 90 feature groups. Sizes: 251 `M`, 95 `S` — **nothing above `M`** (all ≤ ~500 LOC).
- **9 versions produced:** v0 baseline + 8 full holistic refinement passes. Each pass re-attempted the whole tree; logs in `iterations/`, frozen snapshots in `iterations/snapshots/v0…v8`.
- **Final QA (independently re-verified): all green** — unique IDs, acyclic deps, 0 dangling deps, 100% of leaves carry `_accept:_` + `_test:_`, every `obs:` signal in-contract, every spike has cost + decide-by, every hypothesis perf target has `_benchmark-by:_`, and every §1 vision bullet + north-star question maps to ≥1 leaf (coverage matrix = index block F in `feature-tree.md`).
- **Where to start dispatching:** `feature-tree.md` → index **block E** (dispatch waves W0–W5) and the **first-12-PR slice**, then follow each leaf's `_deps:_`. Wave W0 has no blockers.
- **Not committed:** this folder is untracked in git. It's a planning artifact; commit it via the normal PR flow if you want it in history.

## 1. Product vision (north star)

Cash Lens is a **personal financial operating system** — not "prettier Monarch." The goal:
**see my net inflow and outflow (where & why) and smartly categorize my spending**, with a
single source of truth across every dollar in and out.

Differentiating wedge (the things generic PFM apps do badly):

- **True spend** — exclude transfers and card payments from real spending.
- **Reimbursements & receivables** — money I'm owed (group pay → Venmo back, work expenses).
- **Returns** — purchases I plan to return and the refund that should follow.
- **Receipts & line items** — itemize a purchase down to the single product/service.
- **Cross-source enrichment & dedup** — one purchase seen via bank + Venmo + receipt = one truth.
- **Smart LLM categorization** that **learns from corrections**.
- **Prediction & anomaly** — catch/predict forgotten subscriptions, overcharges, surprise bills.
- **Fragmented money** — bank, cards, Venmo/PayPal, 401k/Fidelity, Robinhood, Kalshi.
- **Review queue (Tinder-style)** for fast categorize/enrich/confirm.
- **Web + iOS**, Google/Clerk sign-in, push notifications.

North-star questions the product must answer: *Where did my money go? Where did it come from?
What is my true spending? What do I owe and what am I owed? What changed unexpectedly?
What is my financial state right now?*

## 2. Current repo grounding (what already exists — verified 2026-05-29)

- **Stack:** Next.js 16 App Router (Vercel) · FastAPI (Cloud Run, `uv`) · Neon Postgres · Clerk · Plaid. Envs: local / preview / staging / production.
- **Tables:** `users`, `plaid_items`, `financial_accounts`, `raw_transactions`, `ledger_events`, `notification_events`, `sync_runs`.
- **API:** `/me`, `/plaid/{create-link-token,exchange-public-token,webhook,sync-item}`, `/accounts`, `/transactions` (+`PATCH`), `/notifications` (+read/read-all).
- **Web screens:** dashboard, accounts, transactions, settings, login, sign-in.
- **Reusable web:** app-shell, plaid-connect, manual-sync, mark-all-read, transaction-editor.
- ⚠️ **No migration framework yet** — `db.py` uses raw `create_engine` + `Base` (likely `create_all`). Alembic is a foundational leaf (`PLT-2.1`).
- ⚠️ **Money stored as `Float`** — should migrate to integer minor units (`LDG-4.3`).
- ⚠️ **Provider = Plaid only today.** Provider abstraction + Plaid/Teller/SimpleFIN choice is a spike (`SRC-1.1`, `SRC-1.5`).

## 3. How this backlog was built — iteration protocol

This file set is the product of **9 complete passes** over the *same* tree:

- **v0** — baseline authored by Claude from the vision + repo + repo skills.
- **v1 … v8** — **8 full holistic refinement passes.** Each pass re-attempts the **entire**
  tree in one step (it is NOT assigned one narrow aspect). Every pass must improve the whole
  thing against the **quality bar** in §4.

Artifacts:

- `feature-tree.md` — **the canonical living document.** Always the latest/best version.
- `iterations/iteration-NN.md` — per-pass change log: what changed, leaf-count delta, decisions, open questions, and a self-critique that seeds the next pass.
- `iterations/snapshots/vNN-feature-tree.md` — frozen snapshot of the tree after each pass (full version history; lets you diff progress).

## 4. Quality bar — applied to the WHOLE tree on every pass

1. **Coverage** — every vision bullet (§1) and every table-stakes PFM feature maps to ≥1 leaf.
2. **Atomicity & sizing** — every leaf ≤ ~500 LOC / 1–3 PRs. Split anything bigger; merge trivia.
3. **Hierarchy** — Epic → Feature group → atomic Leaf. Roughly MECE; no orphan concepts.
4. **Dependencies** — `deps:` edges so the tree is buildable in order; no cycles.
5. **Data/API grounding** — name the schema/endpoint/shared-type delta; migration-safe + idempotent (`db-evolution`).
6. **Acceptance & tests** — crisp acceptance criteria + the test layer that proves it (`testing-playbook`).
7. **Cross-cutting** — server-verified identity (no spoofable headers), encrypted tokens at rest, privacy, observability, error/retry, rate limits, a11y, multi-currency.
8. **Risk & spikes** — flag ambiguity; convert unknowns into explicit `research` leaves.
9. **Agent-readiness** — each leaf reads as a self-contained brief an agent can execute cold.

## 5. Leaf format & legend

```
- **<ID> — <Imperative title>** `[status]` `size` `layer` — one-line scope.
  _deps:_ <ID, …> · _skill:_ <skill> · _acceptance:_ <one line> (added by later passes)
```

- **ID:** `EPIC-<group>.<leaf>` (e.g. `SRC-2.3`). **Stable across iterations — never renumber.**
- **status:** `[built]` exists now · `[partial]` partly exists · `[new]` not started.
- **size:** `S` < 150 LOC (1 PR) · `M` 150–350 LOC (1 PR) · `L` 350–500 LOC (1–2 PRs). Nothing exceeds `L`.
- **layer:** `api` · `web` · `ios` · `infra` · `data` · `shared` (types) · `research` (spike, no prod code).

## 6. Epics

| Code | Epic | Theme |
|------|------|-------|
| PLT | Platform, Environments & Delivery | runtime, migrations, jobs, CI/CD, observability |
| SEC | Security, Privacy, Data & Compliance | identity security, encryption, data rights |
| AUT | Identity, Auth & Sessions | Clerk/Google sign-in, sessions, user record |
| ONB | Onboarding & Registration | first-run, connect-first-account, personalization |
| SRC | Source Connections | provider framework + bank, Venmo, PayPal, investments, Gmail, SMS |
| ING | Ingestion & Sync Engine | backfill, incremental sync, webhooks, raw storage |
| LDG | Ledger Core & Normalization | raw→ledger, true-spend, balances, net worth, money types |
| ENR | Enrichment, Matching & Dedup | merchant cleanup, cross-source match, dedup, splitting |
| RCP | Receipts, Invoices & Line Items | capture, OCR/parse, line items, invoices |
| CAT | Categorization & Rules | taxonomy, rules engine, LLM categorize, learning |
| OWE | Receivables, Returns & Obligations | reimbursements, group pay, returns, bills, future txns |
| INT | Intelligence: Recurring, Prediction & Anomaly | recurring, subscriptions, forecast, anomaly |
| RPT | Analytics, Reports & Insights | dashboard, cash flow, category, net worth, tax, budgets |
| REV | Review Queue (Tinder UI) | queue build, swipe review, card actions |
| NAV | App Shell, Search & Navigation | shell, Command-K, filters, theming |
| NTF | Notifications & Push | in-app, prefs, web push, iOS push, delivery |
| IOS | iOS App | shell, parity screens, native capabilities, distribution |

## 7. Skills & tools available to implementation agents

When an agent picks up a leaf, it should invoke the relevant skill(s). Catalog:

**Repo-native (`.codex/skills/`)**
- `cashlens-db-evolution` — any schema/migration/dedup/backfill/replay change. Requires upgrade-safety + idempotency tests.
- `cashlens-testing-playbook` — choosing pytest vs Vitest vs Playwright; invariant-style tests; no brittle layout asserts.
- `cashlens-platform-ops` — deploy/auth/hosting (GitHub, Cloud Run, Vercel, Neon, Clerk, Plaid). Start with `scripts/check-access.sh`.
- `cashlens-pr-workflow` — branch → validate (`make api-test`/`web-test`/`e2e`/`ci`) → impl log → PR. Required checks: api, web, e2e, docs.
- `cashlens-release-hygiene` — keep VERSION/CHANGELOG/package.json/pyproject in sync.
- `cashlens-gcloud-ops`, `cashlens-neon-ops` — Cloud Run / Neon specifics.
- `cashlens-skill-capture` — capture a new repeated workflow as a skill.

**Auth / platform**
- `clerk-cli` — Clerk auth setup (web + iOS), production instance.
- vercel `auth` — Clerk/Next.js middleware auth patterns.
- vercel `env-vars`, `deployments-cicd`, `vercel-cli`, `vercel-functions` — config, CI/CD, cron, serverless.
- vercel `vercel-storage` — Blob (receipt images), Neon Postgres, Redis.

**Frontend**
- `frontend-design` — distinctive, production-grade UI (avoid generic AI aesthetics).
- vercel `shadcn` — component install/compose/theming.
- vercel `nextjs` — App Router, Server Components/Actions, middleware/proxy.
- vercel `react-best-practices` — TSX quality checklist (hooks, a11y, perf, TS).

**AI / LLM (categorization, receipt parsing, chat, prediction)**
- vercel `ai-sdk` — text gen, **structured output**, tool calling, agents, streaming, embeddings.
- vercel `ai-gateway` — model routing, failover, **cost tracking** (important for batch categorize/OCR).
- vercel `chat-sdk` — multi-platform chat bots (if a chat/assistant screen is built).

**Messaging / ingestion**
- `imessage` (access/configure) — iMessage channel access for SMS receipt ingestion spike.

**Process (use proactively)**
- `brainstorming` (before building a feature), `writing-plans`, `test-driven-development`,
  `systematic-debugging`, `subagent-driven-development`, `dispatching-parallel-agents`,
  `verification-before-completion`.

**Research tools:** `WebSearch` / `WebFetch` — vendor feasibility (Venmo/PayPal/Teller/SimpleFIN
APIs, OCR vendors, LLM pricing) and best-in-class PFM feature parity.

## 8. Invariants (must hold across every iteration)

- **Never delete a leaf** without recording why in the iteration log. **IDs are stable.**
- Each pass **preserves or grows coverage**; report the leaf-count delta.
- **Server-verified identity only** — never reintroduce spoofable header-based identity.
- **Encrypted provider tokens at rest**; staging and production stay separate (service, DB, secrets).
- Persistent-data leaves are **migration-safe and idempotent** (no data loss / no double-apply on replay).
- Money is **never** compared/stored as binary floats once `LDG-4.3` lands.
