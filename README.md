# Cash Lens

Cash Lens is a ledger-first personal finance MVP with:

- `apps/web`: Next.js 16 App Router frontend
- `apps/api`: FastAPI backend managed with `uv`
- `packages/api-types`: shared TypeScript API contracts
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

### Backend

```bash
cd /Users/yajvanravan/cashlens/apps/api
UV_CACHE_DIR=/private/tmp/uv-cache uv sync --group dev
uv run uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd /Users/yajvanravan/cashlens/apps/web
pnpm install --frozen-lockfile --trust-lockfile --ignore-scripts
pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3000
```

### Canonical validation commands

```bash
cd /Users/yajvanravan/cashlens
make api-test
make web-test
make e2e
make docs-build
```

## Verification

- `make api-test` runs `ruff` and `pytest` for the FastAPI app.
- `make web-test` runs lint, typecheck, Vitest, and the production Next build.
- `make e2e` runs Playwright smoke coverage against local backend and frontend servers in demo mode.
- `make docs-build` validates the MkDocs documentation and version sync rules.
- Pull requests must satisfy the GitHub `api`, `web`, `e2e`, and `docs` checks before merge.

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
