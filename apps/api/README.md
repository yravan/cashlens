## Cash Lens API

This FastAPI app powers the Cash Lens MVP.

### Highlights

- SQLAlchemy data model for users, Plaid items, accounts, raw transactions, ledger events, notifications, and sync runs
- Demo-first seeding so the product works without live credentials
- Optional live Plaid path when `PLAID_CLIENT_ID` and `PLAID_SECRET` are configured
- Header-based auth bridge designed for a Next.js proxy layer

### Run locally

```bash
cd /Users/yajvanravan/cashlens/apps/api
UV_CACHE_DIR=/private/tmp/uv-cache uv sync
uv run uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8000
```

### Important env vars

- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV`
- `PLAID_WEBHOOK_URL`

If the Plaid keys are omitted, the API runs in demo mode and seeds a realistic single-user workspace.

### GitHub deployment

The production deployment path is GitHub-based:

- GitHub Actions workflow: `.github/workflows/deploy-api.yml`
- Cloud Run source deployment target: `apps/api`
- Runtime secrets source: Google Secret Manager
- Container build file: `apps/api/Dockerfile`
