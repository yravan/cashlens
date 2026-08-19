# CLAUDE.md — Cash Lens

Ledger-first personal finance app. Read `specs/vision.md` for the product thesis and `FEATURES.md` for the feature tree — the tree is the single source of truth for scope and priorities.

## Working model

- The unit of work is ONE leaf node from FEATURES.md. Stay inside it: 1–3 PRs, roughly ≤500 changed lines, reviewable in one sitting.
- Research before building: every leaf starts with a survey of how production systems and open-source projects solve the same problem — at least 10 sources for a simple leaf, up to 50 for a complex one (implementations, libraries, docs, post-mortems). Prefer assembling proven libraries and patterns over custom code; write custom code only where this product's wedge demands it. Open the PR with a prior-art note: what you found, adopted, and rejected.
- Before coding, restate the leaf's scope. Anything beyond the node's description is scope creep — note it in the PR instead of building it.
- Don't refactor neighboring code or touch other leaves' territory in the same PR.
- If implementation reveals the tree is wrong (bad split, missing dependency), update FEATURES.md in its own small commit and say so in the PR.
- After the leaf PR is opened, an independent simplification pass reviews it with fresh eyes (no builder context): condense and aggressively simplify the diff — same behavior, same tests, fewer lines — pushed to the same PR before founder review.

## Code style

- Comments, docstrings, and prose in code: minimum, ideally zero. Code explains itself through names and structure; comment only a constraint the code can't express. Never narrate what a line does or restate it in English.

## Security — the defining tenet

One person's complete financial life lives in this system. Every leaf is built like that's true, because it is.

- Least data, least privilege: store only what the feature needs; request the narrowest provider scopes that work.
- Secrets and provider tokens are encrypted at rest and never appear in the browser, logs, fixtures, or test output.
- Any surface touching user data ships with a cross-user isolation test: user B can never read user A's anything.
- All input is validated at the boundary; queries and commands are never assembled from raw input.
- A new dependency is a security decision — prefer maintained, widely used ones, and keep scanning green.
- If a leaf introduces new risk surface (uploads, webhooks, background jobs), name it in the PR with its mitigation.

## Stack & commands

Chosen in leaf 1.1.1 (survey in that PR): **pnpm workspace** (root scripts delegate to apps); **apps/web** is **Next.js 16** (App Router, TypeScript, Tailwind v4, ESLint 9 flat config) with **Clerk** as the managed auth provider (Google-only sign-in). E2E tests are **Playwright** against a production build on port 3100 and the real Clerk development instance. YOU MUST keep this section current as the stack lands: exact dev-server, test, lint, and typecheck commands, per app, as used in CI.

- web (run from repo root, or inside `apps/web` without the filter): `pnpm dev` · `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck` · `pnpm build`
- Env: copy `apps/web/.env.example` to `apps/web/.env.local` and fill the Clerk dev keys (`npx clerk@latest env pull` — the CLI is linked to the "Cash Lens" Clerk app). E2E tests need them, plus the database below.
- Database (chosen in leaf 1.1.2): **PostgreSQL 16** in Docker (`compose.yaml`, host port 5433) with **Drizzle ORM** and committed SQL migrations (`apps/web/db/migrations`). Setup: `pnpm db:up` then `pnpm db:setup` (idempotently creates roles + database, runs migrations; any Postgres 16+ works — point the `DATABASE_URL*` vars at it). Schema change: edit `apps/web/lib/db/schema.ts` → `pnpm db:generate` → commit the SQL → `pnpm db:migrate`. Full reset: `docker compose down -v`, then `pnpm db:up && pnpm db:setup`.
- Data scoping (leaf 1.1.2 — binding on every later leaf): the app connects as the non-owner role `cashlens_app`; every user-owned table declares RLS policies in the schema keyed on `current_setting('app.clerk_user_id', true)` and gets `FORCE ROW LEVEL SECURITY` in its migration (the e2e coverage test fails any public table without it). All user-data access goes through `lib/data` DAL functions that derive the user from `auth()` — never from caller input — inside `withRequestScope`. The db client is importable only within `lib/db`/`lib/data` (ESLint-enforced).
- The middleware file is `proxy.ts` (Next 16 renamed `middleware.ts`); it is an optimistic gate only — every protected page and route handler re-checks `auth()` itself (CVE-2025-29927 lesson).
- Production (leaf 1.3, runbook + go-live checklist: `docs/production.md`): **Vercel** (project `cashlens`, root directory `apps/web`) deploys `main` only — `apps/web/vercel.json` skips non-production builds until leaf 10.6 and builds with `pnpm deploy:build`, which applies committed migrations as `cashlens_owner` (gated on `VERCEL_ENV=production`, direct URL) before `next build`, so a failed migration fails the deploy. Database is **Neon** (direct account, never Marketplace; same two-role model; runtime `DATABASE_URL` uses the `-pooler` host, owner/superuser URLs stay direct; all prod URLs pin `?sslmode=verify-full`). NEVER create roles in a provider console — console roles silently get `BYPASSRLS` (neondatabase/neon#12926); `pnpm db:setup` is the only role source and fails closed on `rolbypassrls`. `GET /api/health` reports app+db (200/503, public). DB fail-fast budgets: 5s connect / 20s client query / 15s statement / 30s idle-in-transaction (role-level).

## Testing policy (non-negotiable)

Tests exist to catch regressions in behavior users care about — not to demonstrate that code was written.

**Write tests at the seams:**

- Most coverage: API-level tests hitting real endpoints with a real local database.
- A few real-browser end-to-end tests for the money paths: sign in → connect → transactions appear → cash-flow numbers are right.
- Unit tests only where real logic lives — transfer matching, dedup, splits math, recurring detection, rules. Those deserve exhaustive cases.

**Banned (fake tests):**

- NEVER mock code this repo owns. Mock only true externals (Plaid, Gmail, the LLM) — behind the same interface production uses, with realistic sandbox/recorded fixtures.
- No render-without-crashing, element-is-visible, or snapshot-only tests. Every test asserts a behavior or a number.
- No sleeps to fix flaky tests — fix the race. No skipping or quarantining a test to get green.
- Don't test the framework (routing resolves, ORM persists). Test what this codebase decided.

**Determinism:** tests run against the seeded fixture dataset (known users, accounts, transactions with known totals) and a frozen clock, so assertions are exact — `true_spend == 1234.56`, never `> 0`.

**Prove the test works:** a new test must fail when the behavior it guards is broken. If you never saw it red, you don't know that it tests anything.

## Definition of done — every leaf, before claiming complete

1. Lint, typecheck, and the FULL test suite pass locally — paste the output, don't assert it.
2. Run the actual app and exercise the feature once as a user would.
3. New behavior has tests per the policy above. If you had to edit existing assertions, explain why in the PR.
4. Security rules hold — including the isolation test wherever user data is touched.
5. CI is green on the PR.

## Repository etiquette

- NEVER merge a PR. The founder personally reviews and merges every PR. Open it, report it, stop — even if all checks are green.
- Branch per leaf: `leaf/<node-id>-short-name` (e.g. `leaf/2.1.3-initial-backfill`).
- PR title starts with the node ID. Body: what the node promises, what shipped, evidence (test output), anything deferred.
- Never commit secrets. Env files stay untracked; `.gitignore` already covers them.
