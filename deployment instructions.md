# Cash Lens Staging and Production Deployment Guide

This guide assumes:

- you already have **one hosted deployment**
- that current hosted deployment should now be treated as **staging**
- you want to add a **second, separate production deployment** before putting personal financial data into the app

This guide is written for a non-technical Mac user.

## 1. The short answer

You do **not** need to throw away your current deployment.

Instead:

- keep your current hosted app as **staging**
- keep using Vercel branch and pull-request URLs as **preview**
- create a **second, separate production stack** for real data

That second production stack should have its **own**:

- frontend deployment
- backend service
- database
- secrets
- Clerk production instance
- Plaid production credentials

That separation is the important security boundary.

## 2. The environment model

Cash Lens should now be thought about in four environments:

| Environment | What it is for | Where it runs | Auth | Plaid | Database | Real personal data? |
| --- | --- | --- | --- | --- | --- | --- |
| `local` | day-to-day development and debugging | your Mac | Clerk development or demo mode | Sandbox | local SQLite or optional Neon dev URL | `No` |
| `preview` | temporary branch / PR review links | Vercel preview URLs | same frontend wiring as staging unless you build something fancier later | do not rely on it for Plaid testing | should be treated as non-isolated | `No` |
| `staging` | your current hosted app | Vercel + Cloud Run | non-production / test auth setup | Sandbox | staging database | `No` |
| `production` | real live app | second Vercel project + second Cloud Run service | Clerk production | Plaid production | production database | `Yes` |

## 3. What you already have

Today, the repo already supports a **single hosted backend deployment workflow**:

- backend deploy workflow: `.github/workflows/deploy-api.yml`
- frontend deploy target: Vercel project for `apps/web`

For this guide, treat that existing hosted deployment as **staging**.

That means:

- the current Cloud Run service is your staging backend
- the current Vercel production URL is your staging frontend
- any current sandbox or development credentials belong to staging

## 4. What production means in this guide

Production does **not** mean:

- the same deployment with a few environment variables flipped

Production **does** mean:

- a second backend service
- a second frontend deployment target
- a second secret set
- a second database
- production auth and production Plaid credentials

If you are going to store your own financial data, do **not** share the staging database or staging secrets with production.

## 5. The most important rule

Your current hosted deployment is now a **testing environment**, not the final destination.

Use the environments like this:

- `local`: real implementation work, debugging, and most Plaid sandbox testing
- `preview`: quick UI review only
- `staging`: full hosted testing with non-production credentials
- `production`: real personal use

## 6. Current architecture and what needs to change

### What exists now

- one GitHub Actions backend deploy workflow
- one Cloud Run service target
- one runtime service account pattern
- one Vercel hosted app
- one set of GitHub deployment variables
- one set of Secret Manager secret names

### What needs to exist before real production use

- one **staging** backend service
- one **production** backend service
- one **staging** frontend deployment
- one **production** frontend deployment
- one **staging** database
- one **production** database
- one **staging** secret set
- one **production** secret set

## 7. Recommended naming

You do not have to use these exact names, but it will make life much easier if you do.

### Backend services

- staging Cloud Run service: `cash-lens-api`
- production Cloud Run service: `cash-lens-api-prod`

### Runtime service accounts

- staging runtime service account: `cash-lens-runtime`
- production runtime service account: `cash-lens-runtime-prod`

### GitHub deployer service accounts

- staging deployer: `cash-lens-github-deployer`
- production deployer: `cash-lens-github-deployer-prod`

### Secret names

Staging:

- `cash-lens-database-url`
- `cash-lens-app-encryption-key`
- `cash-lens-clerk-jwt-key`
- `cash-lens-plaid-client-id`
- `cash-lens-plaid-secret`

Production:

- `cash-lens-prod-database-url`
- `cash-lens-prod-app-encryption-key`
- `cash-lens-prod-clerk-jwt-key`
- `cash-lens-prod-plaid-client-id`
- `cash-lens-prod-plaid-secret`

### Vercel projects

- staging frontend project: keep your existing Vercel project
- production frontend project: create a second Vercel project, for example `cashlens-prod`

### Databases

- staging database: your existing Neon database or branch
- production database: a second Neon database or a clearly separate production project / branch

## 8. Preview vs staging

These are not the same thing.

### Preview

Preview means:

- temporary Vercel links created from branches or pull requests
- useful for layout, copy, and basic click-through review

Preview should **not** be trusted for:

- Plaid test flows
- real auth confidence
- data isolation assumptions

### Staging

Staging means:

- one stable, hosted environment
- a real Cloud Run backend
- a real Vercel frontend
- safe test credentials and safe test data

That is what your current hosted deployment should become conceptually.

## 9. Local development still matters

Even after you have staging and production, the safest day-to-day workflow is still:

1. build locally
2. test locally
3. use previews for quick frontend review
4. use staging for hosted integration testing
5. use production only for the real app

## 10. Local setup

You still need local development for daily work.

### 10A. Tool install on Mac

If you do not have Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install tools:

```bash
brew install node pnpm gh google-cloud-sdk
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Confirm:

```bash
node -v
pnpm -v
gh --version
gcloud --version
uv --version
```

### 10B. Fast local demo mode

Create `/Users/yajvanravan/cashlens/apps/web/.env.local`:

```env
API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENABLE_CLERK=false
```

### 10C. Full local sandbox mode

Create `/Users/yajvanravan/cashlens/apps/api/.env`:

```env
APP_ENCRYPTION_KEY=CHANGE_THIS_TO_A_LONG_RANDOM_SECRET
CLERK_JWT_KEY=PASTE_THE_CLERK_JWKS_JSON_HERE
PLAID_CLIENT_ID=YOUR_PLAID_CLIENT_ID
PLAID_SECRET=YOUR_PLAID_SECRET
PLAID_ENV=sandbox
PLAID_WEBHOOK_URL=
DEMO_MODE=false
SEED_DEMO_DATA=false
VERIFY_PLAID_WEBHOOKS=false
```

Create `/Users/yajvanravan/cashlens/apps/web/.env.local`:

```env
API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=YOUR_CLERK_SECRET_KEY
ENABLE_CLERK=true
```

Use `localhost`, not `127.0.0.1`, when testing Clerk locally.

### 10D. Run locally

Backend:

```bash
cd /Users/yajvanravan/cashlens/apps/api
UV_CACHE_DIR=/private/tmp/uv-cache uv sync --group dev
uv run uvicorn cash_lens_api.main:app --host localhost --port 8000
```

Frontend:

```bash
cd /Users/yajvanravan/cashlens
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @cashlens/web exec next dev --webpack --hostname localhost --port 3000
```

Open:

- [http://localhost:3000](http://localhost:3000)

### 10E. Local validation

```bash
cd /Users/yajvanravan/cashlens
make api-test
make web-test
make e2e
make docs-build
```

## 11. How to treat the deployment you already have

Your current hosted deployment should be renamed in your head to **staging**.

That means:

- keep it on safe test credentials
- keep Plaid on `sandbox`
- keep it off your real personal data
- use it for hosted integration testing

If your current staging app still uses mixed dev settings, that is okay for now.

The important thing is:

- do **not** promote that same exact secret set into real personal-data production
- instead, build a separate production stack

## 12. What a true staging environment should contain

Staging should use:

- a staging Vercel project or your current existing Vercel deployment
- the current Cloud Run service
- a staging database
- non-production Clerk configuration
- Plaid `sandbox`
- safe fake or test data only

Staging should never contain:

- your real Plaid production credentials
- your real production Clerk setup
- your real personal financial data

## 13. What a true production environment should contain

Production should use:

- a second Vercel project
- a second Cloud Run service
- a second database
- a separate production secret set
- Clerk production
- Plaid production
- your real domain

Production should not share:

- the staging database
- the staging Plaid credentials
- the staging Clerk verification key
- the staging encryption key

## 14. Production setup overview

The safest path is:

1. keep existing hosted app as staging
2. create a second database for production
3. create a second Cloud Run service for production
4. create a second Vercel project for production
5. create a second set of production secrets
6. switch production auth to Clerk production
7. switch production Plaid to Plaid production
8. test production with a minimal real rollout

## 15. Production backend: one-time setup

These steps create the second backend deployment.

### 15A. Google Cloud project choice

You have two valid options:

1. use the **same GCP project** as staging, but create a second Cloud Run service and second secret set
2. use a **separate GCP project** for production

For strongest separation, a separate GCP project is cleaner.

For simplicity, many small teams keep both in one GCP project and separate them by:

- service names
- service accounts
- secret names

This guide assumes the simpler path:

- same GCP project
- separate staging and production resources inside it

### 15B. Production backend resources you need

Create:

- Cloud Run service: `cash-lens-api-prod`
- runtime service account: `cash-lens-runtime-prod`
- deployer service account: `cash-lens-github-deployer-prod`

You can reuse the same Workload Identity pool if you want.

### 15C. Production secrets you need

Create these secrets in Google Secret Manager:

1. `cash-lens-prod-database-url`
2. `cash-lens-prod-app-encryption-key`
3. `cash-lens-prod-clerk-jwt-key`
4. `cash-lens-prod-plaid-client-id`
5. `cash-lens-prod-plaid-secret`

Use these values:

- production Neon database URL
- a new production encryption key
- Clerk production JWT verification key
- Plaid production client ID
- Plaid production secret

Do **not** reuse the staging encryption key.

### 15D. Production database

In Neon, create a separate production database target.

That can be:

- a second Neon project
- or a clearly separate production branch / database setup

For personal financial data, a separate production project is cleaner.

### 15E. Production Clerk

Create or activate the Clerk **production instance**.

Production backend should verify that production instance only.

### 15F. Production Plaid

Production must use:

- Plaid production credentials
- Plaid production webhook configuration

Do not reuse staging Plaid sandbox credentials.

## 16. Production frontend: one-time setup

Create a second Vercel project for production.

### 16A. Why a second Vercel project

This gives you clear separation between:

- the staging hosted app you already have
- the real production hosted app

That is much less error-prone than trying to make one Vercel project behave as both.

### 16B. Production Vercel setup

In Vercel:

1. create a new project
2. import the same GitHub repo
3. set **Root Directory** to:

```txt
apps/web
```

4. use the install command:

```txt
pnpm install --frozen-lockfile --ignore-scripts
```

The repo already includes:

- `apps/web/vercel.json`

### 16C. Production frontend environment variables

For the production Vercel project, add:

- `API_BASE_URL` = production Cloud Run URL
- `NEXT_PUBLIC_API_BASE_URL` = production Cloud Run URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = Clerk production publishable key
- `CLERK_SECRET_KEY` = Clerk production secret key
- `ENABLE_CLERK` = `true`

## 17. How to handle preview after this rewrite

Preview should hang off **staging**, not production.

That means:

- branch and PR Vercel previews should stay harmless
- do not wire them to real production secrets
- do not use them for real financial testing

The safest mental model is:

- preview is a convenience layer on top of staging-style frontend review

## 18. The current GitHub backend workflow

Right now the repo contains one backend deploy workflow:

- `.github/workflows/deploy-api.yml`

For this rewritten guide, treat that workflow as the **staging backend workflow**.

That means it conceptually belongs to staging, even if the file still says “production” in some places.

Before true production rollout, you should add a second production backend deploy path.

That can be done in one of two ways:

1. duplicate the workflow with production-specific names and secrets
2. replace it with a parameterized staging/production deployment system

For most teams, the simpler path is:

- keep the current workflow for staging
- add a second workflow for production later

## 19. Production GitHub configuration you will need

When you create the second backend deploy path, production should have its own:

- service account
- secret names
- Cloud Run service name
- backend URL values
- Plaid webhook URL value

If you keep both staging and production in one repo, the cleanest GitHub setup is:

- one staging deploy workflow
- one production deploy workflow
- separate GitHub environments or separate secret / variable names

## 20. Production deployment sequence

When you are ready to create the second deployment, do it in this order:

1. create the production Neon database
2. create the production Clerk instance and collect keys
3. create the production Plaid credentials
4. create production Secret Manager secrets
5. create the production Cloud Run service and runtime service account
6. create the production Vercel project
7. point the production frontend to the production backend URL
8. set the production Plaid webhook URL
9. smoke test the production app with controlled checks
10. only then consider connecting real accounts

## 21. Production security checklist

Before you use real personal data, all of these should be true:

1. staging and production do not share a database
2. staging and production do not share an encryption key
3. staging and production do not share Plaid secrets
4. staging and production do not share Clerk verification keys
5. production uses Clerk production keys
6. production uses Plaid production credentials
7. production webhook verification is enabled
8. demo mode is disabled in production
9. seed demo data is disabled in production
10. staging remains safe for testing only

## 22. How to use the environments day to day

Use this as your default loop:

1. build locally
2. test locally
3. use preview for quick frontend review
4. use staging for hosted integration testing
5. merge
6. deploy staging updates
7. deploy production separately only when you intentionally want to promote a known-good change

## 23. Read the Docs setup

If you want to use the Read the Docs community service, the GitHub repo must be **public**.

This repo is already prepared with:

- `.readthedocs.yaml`
- `mkdocs.yml`
- `docs/`

### 23A. Test docs locally

```bash
cd /Users/yajvanravan/cashlens
make docs-build
```

### 23B. Local docs preview

```bash
cd /Users/yajvanravan/cashlens
make docs-serve
```

Then open:

- [http://127.0.0.1:8000](http://127.0.0.1:8000)

### 23C. Import on Read the Docs

1. Go to [https://readthedocs.com](https://readthedocs.com)
2. Sign in with GitHub
3. Import the `cashlens` repo

## 24. Changelog and versioning

The version files that must stay aligned are:

- `VERSION`
- `CHANGELOG.md`
- `package.json`
- `apps/api/pyproject.toml`
- `apps/web/package.json`
- `packages/api-types/package.json`

Keep new work in the `Unreleased` section of `CHANGELOG.md`.

When cutting a release:

1. choose the version number
2. update all version files
3. move shipped notes from `Unreleased` into a dated release section
4. run:

```bash
cd /Users/yajvanravan/cashlens
make docs-build
```

## 25. Troubleshooting

### Preview feels weird

That is expected.

Preview is not meant to be the authoritative integration-test environment.

### Staging works, but production does not exist yet

That is also expected if you have only completed the first hosted deployment so far.

This guide assumes:

- current deployment = staging
- second deployment still needs to be created for production

### Production would be sharing staging secrets

Stop there and fix it first.

That is exactly what this guide is trying to prevent.

## 26. The shortest safe operating loop

If you want the simplest safe mental model, use this:

1. local for building
2. preview for quick review
3. staging for hosted testing
4. production as a separate, hardened deployment
