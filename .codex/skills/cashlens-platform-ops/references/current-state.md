# Current State

## Repo

- GitHub repo: `yravan/cashlens`
- Primary branch: `main`
- GitHub Actions environment for Stage 1 hosted deploys: `staging`
- Backend app root: `apps/api`
- Frontend app root: `apps/web`
- Shared deploy workflow: `.github/workflows/deploy-api.yml`

## Hosting

- Backend platform: Google Cloud Run
- Frontend platform: Vercel
- Current staging backend service name: `cash-lens-api`
- Backend region: `us-central1`
- Latest known GCP project: `cashlens-492517`
- Current staging Vercel project: `cashlens`
- Current staging frontend URL: `https://cashlens-pied.vercel.app`

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

## Verified local CLI access

Last verified on `2026-05-29`:

- `gh`
  - authenticated as `yravan`
- `gcloud`
  - active project `cashlens-492517`
  - active account `yajvanravan@gmail.com`
  - default build service account `647780281169-compute@developer.gserviceaccount.com`
- `vercel`
  - authenticated as `yravan`
  - accessible project `cashlens`
  - latest known staged frontend URL `https://cashlens-pied.vercel.app`
- `neon`
  - CLI installed
  - authenticated as `yajvanravan@gmail.com`
  - default org context saved in repo-local `.neon`
  - current project `cash-lens` (`steep-mud-19438224`)
- `clerk`
  - CLI installed
  - authenticated
  - linked app `Cash Lens`
  - development instance `ins_3EEkaSlJe7c2suikEqMyklUAjUG`
  - production instance not created yet

## Dynamic values to verify live

Do not assume these are stable. Check them at runtime:

- current Cloud Run URL
- current Vercel production URL
- current default build service account
- whether Vercel production is using Clerk development or production keys
- whether the logged-in Vercel, Neon, and Clerk accounts are still the same
- whether the current hosted stack is still correctly treated as staging
