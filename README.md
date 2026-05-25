# Cash Lens

Cash Lens is a ledger-first personal finance MVP with:

- `apps/web`: Next.js 16 App Router frontend
- `apps/api`: FastAPI backend managed with `uv`
- `packages/api-types`: shared TypeScript API contracts
- `spec history`: frozen spec snapshots from the planning docs
- `implementation logs`: technical build notes for each major implementation step

## What is implemented

- Dashboard with total cash, credit, inflow, outflow, and true spend
- Accounts page with institution cards and manual sync actions
- Transactions page with filters and an editable review panel
- Settings page with auth mode, Plaid connect, sync, and notification controls
- FastAPI API for dashboard, accounts, transactions, notifications, and Plaid-shaped sync flows
- Demo-ready seeded data mode so the app works without external secrets
- Optional Clerk-ready and Plaid-ready integration shape for production credentials

## Local development

### Backend

```bash
cd /Users/yajvanravan/cashlens/apps/api
UV_CACHE_DIR=/private/tmp/uv-cache uv sync
./.venv/bin/python -m uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd /Users/yajvanravan/cashlens/apps/web
pnpm install
pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3000
```

## Verification completed

- Backend imports and endpoint smoke tests passed with `fastapi.testclient`
- Frontend lint passed with `pnpm lint`
- Frontend production build passed with `pnpm exec next build --webpack`
- Browser verification confirmed dashboard rendering, manual sync, demo institution connect, and transaction editing

## Deployment

See [deployment instructions.md](/Users/yajvanravan/cashlens/deployment instructions.md) for a non-technical walkthrough.
