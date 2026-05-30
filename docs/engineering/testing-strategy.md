# Cash Lens Testing Strategy

Cash Lens should stay safe to refactor even as the UI, data model, and product surface expand.

## Principles

- Test user outcomes and domain invariants first.
- Keep fast tests close to the code they protect.
- Treat end-to-end tests as smoke coverage for key flows, not a screenshot harness.
- Avoid assertions tied to pixel sizes, DOM nesting, animation timing, or presentation-only copy unless the bug is explicitly visual.

## Current layers

### Backend

- `pytest` covers API behavior and security helpers.
- `ruff` catches import drift and Python correctness issues early.
- Demo-mode integration tests verify the seeded workspace and auth-safe defaults.

### Frontend

- Vitest + Testing Library cover environment wiring and component behavior.
- TypeScript typecheck remains a required gate alongside lint.
- Playwright smoke tests verify the local demo workspace, demo Plaid handoff, and transaction editing without hard-coding layout details.

## Selector policy

- Prefer `getByRole`, `getByLabel`, and visible business language.
- Use a small number of stable `data-testid` attributes for cross-flow controls whose copy may legitimately evolve.
- Do not key tests off Tailwind classes, CSS selectors, or positional DOM assumptions.

## How this should evolve

### Database and migrations

- Add migration rehearsal tests before shipping structural schema changes.
- Add idempotency tests for backfills and sync jobs.
- Keep fixtures small but representative of real financial edge cases.

### Dedup, sync, and backfills

- Assert invariants like “no double ledger event,” “cursor resumes safely,” and “re-running the job is safe.”
- Prefer explicit fixture corpora over broad snapshots.

### LLM-driven features

- Test structured outputs, guardrails, and fallback behavior instead of exact prose.
- Keep provider calls mocked in PR CI.
- Move heavier eval suites to scheduled or opt-in workflows when they become expensive.

## Merge gate expectation

Any PR that changes product behavior should leave at least one of these stronger than before:

- a unit or integration invariant
- a smoke e2e path
- a repo workflow skill or engineering guide
