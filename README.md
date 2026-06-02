# Cash Lens

Cash Lens is a ledger-first personal finance MVP with:

- `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`: root JavaScript monorepo workspace
- `apps/web`: Next.js 16 App Router frontend
- `apps/api`: FastAPI backend managed with `uv`
- `packages/api-types`: shared TypeScript API contract package
- `spec history`: frozen spec snapshots from the planning docs
- `implementation logs`: technical build notes for each major implementation step
- `.codex/skills`: repo-native agent skills for repeated development workflows
- `docs`: MkDocs-based documentation source for local builds and Read the Docs hosting
- `CHANGELOG.md` and `VERSION`: release-history and versioning source of truth

## What is implemented

- Dashboard with total cash, credit, inflow, outflow, and true spend
- Accounts page with institution cards and manual sync actions
- Transactions page with filters and an editable review panel
- Settings page with auth mode, Plaid connect, sync, and notification controls
- FastAPI API for dashboard, accounts, transactions, notifications, and Plaid-shaped sync flows
- Demo-ready seeded data mode so the app works without external secrets
- Optional Clerk-ready and Plaid-ready integration shape for production credentials

## Development workflow

- `main` is intended to stay protected and merge-only via pull request.
- Required GitHub checks live in `.github/workflows/ci.yml`.
- Backend CD remains in `.github/workflows/deploy-api.yml`.
- Vercel continues to handle frontend CD from `main`.
- Documentation is built from `docs/` with MkDocs and can be hosted on Read the Docs using `.readthedocs.yaml`.
- Agent workflow conventions live in [AGENTS.md](/Users/yajvanravan/cashlens/AGENTS.md) and the repo skills under [/.codex/skills](/Users/yajvanravan/cashlens/.codex/skills).

## Local development

### One-command local stack

Bring up api + web + Postgres in demo mode with a single command:

```bash
cd /Users/yajvanravan/cashlens
make dev
```

This reuses a cashlens-usable Postgres if one is already reachable, otherwise
runs Postgres in a `docker-compose.yml` container (requires Docker). It then
starts the FastAPI backend (default `http://127.0.0.1:8000`) and the Next.js dev
server (default `http://127.0.0.1:3000`), falling back to the next free port and
printing the actual ports if a default is busy. If `5432` is held by another
Postgres (e.g. Homebrew), the cashlens container comes up on the next free port
instead of aborting.

On `Ctrl-C` only api/web stop — **Postgres stays warm** between runs. Use
`make dev-down` to remove the Postgres container for a clean slate. In a second
terminal, verify the backend is healthy:

```bash
make dev-smoke   # polls the actual /health port until green, fails after 60s
```

See [docs/local-stack.md](/Users/yajvanravan/cashlens/docs/local-stack.md) for
configuration and the Docker requirement. The individual backend and frontend
run patterns below remain available for running a single service.

### Backend

```bash
cd /Users/yajvanravan/cashlens/apps/api
UV_CACHE_DIR=/private/tmp/uv-cache uv sync --group dev
uv run uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd /Users/yajvanravan/cashlens
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @cashlens/web exec next dev --webpack --hostname 127.0.0.1 --port 3000
```

### Canonical validation commands

```bash
cd /Users/yajvanravan/cashlens
make api-test
make web-test
make e2e
make docs-build
```

### Backend tests against Postgres

By default `make api-test` runs the backend suite against SQLite (fast). To run
the same suite against **Postgres 16** (matching Neon's major version), reuse the
`docker-compose.yml` Postgres service:

```bash
cd /Users/yajvanravan/cashlens
make api-test-postgres   # brings up Postgres 16, runs pytest, tears it down
```

This requires Docker and picks the next free host port if `5432` is already in
use. The suite selects its backend from `DATABASE_URL`, so you can also point it
at any reachable Postgres directly:

```bash
cd /Users/yajvanravan/cashlens/apps/api
DATABASE_URL="postgresql+psycopg2://cashlens:cashlens@127.0.0.1:5432/cashlens" uv run pytest
```

CI runs both backends automatically (see the `api-tests` matrix in
[.github/workflows/ci.yml](/Users/yajvanravan/cashlens/.github/workflows/ci.yml)).

## Verification

- `make api-test` runs `ruff` and `pytest` for the FastAPI app (SQLite).
- `make api-test-postgres` runs the same suite against a Postgres 16 container.
- `make web-test` runs lint, typecheck, Vitest, and the production Next build.
- `make e2e` runs Playwright smoke coverage against local backend and frontend servers in demo mode.
- `make docs-build` validates the MkDocs documentation and version sync rules.
- Pull requests must satisfy the GitHub `api`, `web`, `e2e`, and `docs` checks before merge.
- Root `pnpm` is now the canonical JavaScript workspace entrypoint; `apps/web` is no longer treated as a standalone lockfile root.

- Backend imports and endpoint smoke tests passed with `fastapi.testclient`
- Frontend lint passed with `pnpm lint`
- Frontend production build passed with `pnpm exec next build --webpack`
- Browser verification confirmed dashboard rendering, manual sync, demo institution connect, and transaction editing

## Deployment

The backend is set up for GitHub-based Cloud Run deployments from `.github/workflows/deploy-api.yml`, and the Python container uses `uv` inside [apps/api/Dockerfile](/Users/yajvanravan/cashlens/apps/api/Dockerfile).

See [deployment instructions.md](/Users/yajvanravan/cashlens/deployment instructions.md) for the full non-technical walkthrough, including GitHub Actions, Workload Identity Federation, Secret Manager, Cloud Run, and Vercel.

See the engineering guides for long-term development conventions:

- [Testing strategy](/Users/yajvanravan/cashlens/docs/engineering/testing-strategy.md)
- [Pull request workflow](/Users/yajvanravan/cashlens/docs/engineering/pull-request-workflow.md)
- [Versioning and releases](/Users/yajvanravan/cashlens/docs/versioning.md)
