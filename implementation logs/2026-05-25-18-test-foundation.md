# Test Foundation

## What changed

- Backend:
  - added `pytest` and `ruff` as `uv` dev dependencies
  - added seeded integration tests for `/health` and `/dashboard`
  - added security tests for bearer-token parsing and Clerk token verification
- Frontend:
  - added Vitest + Testing Library
  - added Playwright smoke tests
  - added stable `data-testid` hooks only for the user-critical Plaid and manual-sync actions
  - added `typecheck`, `test`, and `e2e` scripts
- CI:
  - added `api`, `web`, and `e2e` jobs in `.github/workflows/ci.yml`

## Anti-brittle testing choices

- No pixel or layout assertions were added.
- Playwright uses roles, labels, and only a tiny number of stable test ids.
- The transaction editor smoke test asserts that review changes persist, not that any element sits in a specific place.

## Environment work needed to make this stable

- Locked frontend installs to the committed lockfile via `trust-lockfile=true` so `pnpm` supply-chain checks do not randomly block CI on a reviewed private lockfile.
- Explicitly ignored `@clerk/shared` build scripts in the workspace policy because the project runs correctly without them and the repo already ignores similar install-time scripts.
- Moved Playwright onto dedicated ports and a production `next start` server so it does not collide with an already-running local `next dev`.
- Forced Playwright’s backend harness into demo mode by blanking Plaid credentials so tests do not accidentally inherit a developer’s live local environment.

## Validation

- `uv run ruff check src tests`
- `uv run pytest`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test --run`
- `pnpm build`
- `pnpm e2e`
