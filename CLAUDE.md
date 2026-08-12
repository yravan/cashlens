# CLAUDE.md — Cash Lens

Ledger-first personal finance app. Read `specs/vision.md` for the product thesis and `FEATURES.md` for the feature tree — the tree is the single source of truth for scope and priorities.

## Working model

- The unit of work is ONE leaf node from FEATURES.md. Stay inside it: 1–3 PRs, roughly ≤500 changed lines, reviewable in one sitting.
- Research before building: every leaf starts with a survey of how production systems and open-source projects solve the same problem. Prefer assembling proven libraries and patterns over custom code; write custom code only where this product's wedge demands it. Open the PR with a short prior-art note: what you found, adopted, and rejected.
- Before coding, restate the leaf's scope. Anything beyond the node's description is scope creep — note it in the PR instead of building it.
- Don't refactor neighboring code or touch other leaves' territory in the same PR.
- If implementation reveals the tree is wrong (bad split, missing dependency), update FEATURES.md in its own small commit and say so in the PR.

## Security — the defining tenet

One person's complete financial life lives in this system. Every leaf is built like that's true, because it is.

- Least data, least privilege: store only what the feature needs; request the narrowest provider scopes that work.
- Secrets and provider tokens are encrypted at rest and never appear in the browser, logs, fixtures, or test output.
- Any surface touching user data ships with a cross-user isolation test: user B can never read user A's anything.
- All input is validated at the boundary; queries and commands are never assembled from raw input.
- A new dependency is a security decision — prefer maintained, widely used ones, and keep scanning green.
- If a leaf introduces new risk surface (uploads, webhooks, background jobs), name it in the PR with its mitigation.

## Stack & commands

Not chosen yet — the first foundation leaves decide it. YOU MUST keep this section current as the stack lands: exact dev-server, test, lint, and typecheck commands, per app, as used in CI.

<!-- Fill in, e.g.:
- web: `pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck`
- api: `<run>` · `<test>` · `<lint>` · `<typecheck>`
-->

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

- Branch per leaf: `leaf/<node-id>-short-name` (e.g. `leaf/2.1.3-initial-backfill`).
- PR title starts with the node ID. Body: what the node promises, what shipped, evidence (test output), anything deferred.
- Never commit secrets. Env files stay untracked; `.gitignore` already covers them.
