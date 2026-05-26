# Current State

## Repo

- GitHub repo: `yravan/cashlens`
- Primary branch: `main`
- Backend app root: `apps/api`
- Frontend app root: `apps/web`
- Shared deploy workflow: `.github/workflows/deploy-api.yml`

## Hosting

- Backend platform: Google Cloud Run
- Frontend platform: Vercel
- Backend service name: `cash-lens-api`
- Backend region: `us-central1`
- Latest known GCP project: `cashlens-492517`

## Important local files

- Deployment guide: `deployment instructions.md`
- Implementation history: `implementation logs/`
- Backend env example source: `apps/api/.env`
- Frontend env example source: `apps/web/.env.local`

## High-value runtime routes

- Backend health: `/health`
- Backend docs: `/docs`
- Plaid create-link-token: `/plaid/create-link-token`
- Plaid exchange-public-token: `/plaid/exchange-public-token`
- Plaid webhook: `/plaid/webhook`

## Dynamic values to verify live

Do not assume these are stable. Check them at runtime:

- current Cloud Run URL
- current Vercel production URL
- current default build service account
- whether Vercel production is using Clerk development or production keys
- whether Neon and Clerk CLIs are installed locally
