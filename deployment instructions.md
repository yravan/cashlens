# Cash Lens Setup, Deployment, and Environment Guide

This guide is written for a non-technical Mac user.

It is organized around **environments**, not around every historical change we made to the repo.

If you follow it in order, you will end with:

- a local development setup for day-to-day work
- a clear understanding of what Vercel previews are safe for
- a production deployment path for the real app
- a docs site path for Read the Docs

## 1. The environment model

Cash Lens currently works best with this model:

| Environment | Purpose | Where it runs | Auth | Plaid | Database | Use real accounts? |
| --- | --- | --- | --- | --- | --- | --- |
| `local` | day-to-day development and sandbox testing | your Mac | Clerk development or demo mode | Sandbox | local SQLite by default, optional Neon dev URL | `No` |
| `preview` | pull request and UI review | Vercel preview deployments | usually same hosted auth wiring as production | not a safe sandbox | no separate hosted preview backend today | `No` |
| `production` | the real app | Vercel + Cloud Run | Clerk production | Plaid production when you are ready | Neon production | `Yes`, after the production checklist |

## 2. The most important rule

**Do all development and Plaid sandbox testing locally.**

Why:

- this repo has **one hosted backend** today
- Vercel previews do **not** have their own separate Cloud Run backend, separate Neon database, or separate Clerk verification key
- that means preview deployments are good for reviewing UI and frontend changes, but they are **not** a true staging environment

So the safe rule is:

- local = development and sandbox
- production = real hosted app
- preview = useful, but not your sandbox

If you later want a true staging environment, you would add:

- a second Cloud Run service
- a second Neon database or branch
- a second set of GitHub variables and secrets
- a second Clerk/Plaid environment plan

That is **not** part of the current repo setup.

## 3. What Cash Lens contains

Cash Lens has two main apps:

- `apps/web`: the website people open in the browser
- `apps/api`: the Python backend that stores data, talks to Plaid, and powers the dashboard

Other important pieces:

- `packages/api-types`: shared TypeScript types used by the frontend
- `docs`: MkDocs documentation source
- `.github/workflows/deploy-api.yml`: backend production deployment workflow
- `.github/workflows/ci.yml`: CI checks

## 4. Hosted production architecture

Production uses:

- **Frontend**: Vercel
- **Backend**: Google Cloud Run
- **Backend deploy trigger**: GitHub Actions
- **Backend secrets**: Google Secret Manager
- **Database**: Neon
- **Authentication**: Clerk
- **Bank connectivity**: Plaid
- **Docs hosting**: Read the Docs

## 5. Accounts you need

Create or sign into:

1. GitHub
2. Vercel
3. Neon
4. Clerk
5. Plaid
6. Google Cloud
7. Read the Docs

## 6. Install the tools on your Mac

Open the Terminal app.

If you do not have Homebrew yet, install it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install the tools:

```bash
brew install node pnpm gh google-cloud-sdk
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Close Terminal and open it again.

Confirm the tools exist:

```bash
node -v
pnpm -v
gh --version
gcloud --version
uv --version
```

## 7. Make sure the repo exists on GitHub

Go to the project folder:

```bash
cd /Users/yajvanravan/cashlens
```

Sign in to GitHub from Terminal:

```bash
gh auth login
```

Choose:

- `GitHub.com`
- `HTTPS`
- `Login with a web browser`

If you are starting from scratch and the repo does not exist yet:

```bash
gh repo create cashlens --public --source=. --remote=origin
```

If the repo already exists, you do not need to run that.

## 8. Local development: recommended day-to-day setup

This is the setup you should use for normal feature work and Plaid sandbox testing.

### 8A. Choose your local mode

You have two good local modes:

1. **Fast demo mode**
   - easiest way to start the app
   - no live Clerk or Plaid testing
   - good for UI work

2. **Full local sandbox mode**
   - Clerk development
   - Plaid Sandbox
   - best for realistic development

### 8B. Fast demo mode

If you only want the app running quickly:

- do **not** add Plaid or Clerk settings to the backend
- create this frontend file:

Create `/Users/yajvanravan/cashlens/apps/web/.env.local`:

```env
API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENABLE_CLERK=false
```

The backend will use:

- local SQLite
- demo mode
- seeded demo data

### 8C. Full local sandbox mode

This is the recommended local setup if you want realistic development.

#### 1. Create your Clerk application

Go to [https://clerk.com](https://clerk.com)

Create an app called `Cash Lens`.

For local development, use the **Clerk development instance**.

Copy:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

You also need the Clerk JWT verification key for the backend.

If the Clerk CLI is installed and logged in, the easiest path is:

```bash
clerk api /jwks
```

Copy the JSON output.

You will use that as `CLERK_JWT_KEY`.

#### 2. Create your Plaid Sandbox app

Go to [https://dashboard.plaid.com](https://dashboard.plaid.com)

Create a Plaid app and choose:

- environment: `Sandbox`
- product: `transactions`

Copy:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`

#### 3. Create your backend local environment file

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

Notes:

- if you do **not** set `DATABASE_URL`, the backend uses a local SQLite file at `apps/api/cashlens.db`
- that is the easiest local database setup
- if you prefer a hosted dev database, you may add:

```env
DATABASE_URL=YOUR_NEON_DEV_DATABASE_URL
```

#### 4. Create your frontend local environment file

Create `/Users/yajvanravan/cashlens/apps/web/.env.local`:

```env
API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=YOUR_CLERK_SECRET_KEY
ENABLE_CLERK=true
```

Important:

- use `localhost`, not `127.0.0.1`, when testing Clerk locally
- Clerk development mode uses a browser-bound local handshake and `localhost` is the safer path

### 8D. Start the local backend

Open Terminal:

```bash
cd /Users/yajvanravan/cashlens/apps/api
UV_CACHE_DIR=/private/tmp/uv-cache uv sync --group dev
uv run uvicorn cash_lens_api.main:app --host localhost --port 8000
```

Leave that window running.

### 8E. Start the local frontend

Open a second Terminal window:

```bash
cd /Users/yajvanravan/cashlens
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @cashlens/web exec next dev --webpack --hostname localhost --port 3000
```

Open:

- [http://localhost:3000](http://localhost:3000)

### 8F. Local validation commands

From the repo root:

```bash
cd /Users/yajvanravan/cashlens
make api-test
make web-test
make e2e
make docs-build
```

Use these as your normal safety checks.

## 9. Preview deployments: what they are and what they are not

Vercel creates preview deployments from branches and pull requests.

That is helpful for:

- checking layout changes
- checking copy changes
- checking whether the branch builds on Vercel
- sharing a UI preview with someone else

That is **not** the same as having a staging backend.

### 9A. Safe preview usage

Use previews for:

- visual review
- navigation review
- frontend sanity checking
- confirming the branch still deploys on Vercel

### 9B. Unsafe preview usage

Do **not** use previews for:

- connecting real bank accounts
- doing Plaid sandbox experiments once production contains real data
- assuming preview has isolated auth, database, or backend secrets

### 9C. Why

Today, the hosted backend is production-only.

That means the preview frontend does **not** get:

- its own Cloud Run service
- its own Neon database
- its own Secret Manager secrets
- its own Clerk verification key

If you want a true hosted staging setup later, treat that as a separate future project.

## 10. Production setup: one-time infrastructure

This section is for the real hosted app.

### 10A. Neon production database

1. Go to [https://neon.tech](https://neon.tech)
2. Create a new project
3. Name it something like `cash-lens`
4. Create the database

Copy the **pooled connection string**.

That will become `DATABASE_URL` in Secret Manager.

### 10B. Plaid production plan

Start with Plaid Sandbox first.

Only switch Plaid to production after the app is stable and the production checklist later in this guide is complete.

### 10C. Google Cloud project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Enable billing

Choose a project ID.

Example:

```txt
cashlens-492517
```

### 10D. Sign into Google Cloud locally

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_GCP_PROJECT_ID
gcloud auth application-default set-quota-project YOUR_GCP_PROJECT_ID
```

## 11. Production backend deployment setup

The backend deploys from GitHub Actions to Cloud Run.

This section is the one-time setup for that.

### 11A. Save your project values

```bash
export PROJECT_ID="YOUR_GCP_PROJECT_ID"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export GITHUB_REPO="yravan/cashlens"
export BUILD_SERVICE_ACCOUNT="$(gcloud builds get-default-service-account --project "$PROJECT_ID")"
```

If your GitHub owner or repo name is different, replace `yravan/cashlens`.

### 11B. Enable the required Google Cloud APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project "$PROJECT_ID"
```

### 11C. Create the service accounts

```bash
gcloud iam service-accounts create cash-lens-runtime \
  --project "$PROJECT_ID" \
  --display-name "Cash Lens Cloud Run runtime"

gcloud iam service-accounts create cash-lens-github-deployer \
  --project "$PROJECT_ID" \
  --display-name "Cash Lens GitHub deployer"
```

### 11D. Grant the required IAM permissions

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.sourceDeveloper"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/serviceusage.serviceUsageConsumer"

gcloud iam service-accounts add-iam-policy-binding \
  "cash-lens-runtime@$PROJECT_ID.iam.gserviceaccount.com" \
  --project "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SERVICE_ACCOUNT}" \
  --role="roles/run.builder"
```

If `BUILD_SERVICE_ACCOUNT` is a user-managed service account such as:

```txt
PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

also run:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "${BUILD_SERVICE_ACCOUNT}" \
  --project "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

If the build service account is the legacy Google-managed Cloud Build account:

```txt
PROJECT_NUMBER@cloudbuild.gserviceaccount.com
```

skip that last command.

### 11E. Create Workload Identity for GitHub Actions

```bash
gcloud iam workload-identity-pools create "github" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions Pool"

gcloud iam workload-identity-pools providers create-oidc "cash-lens" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="Cash Lens GitHub Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='${GITHUB_REPO}'"

gcloud iam service-accounts add-iam-policy-binding \
  "cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --project "$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}"
```

### 11F. Copy the Workload Identity provider name

```bash
gcloud iam workload-identity-pools providers describe "cash-lens" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="github" \
  --format="value(name)"
```

Copy the output.

It will look like:

```txt
projects/123456789/locations/global/workloadIdentityPools/github/providers/cash-lens
```

## 12. Production secrets and GitHub configuration

### 12A. Create the Secret Manager secrets

Create these Google Secret Manager secrets:

1. `cash-lens-database-url`
2. `cash-lens-app-encryption-key`
3. `cash-lens-clerk-jwt-key`
4. `cash-lens-plaid-client-id`
5. `cash-lens-plaid-secret`

Use these values:

- `cash-lens-database-url` = your Neon production pooled URL
- `cash-lens-app-encryption-key` = your long random encryption key
- `cash-lens-clerk-jwt-key` = the Clerk JWT verification key for the Clerk instance used by production
- `cash-lens-plaid-client-id` = your Plaid client ID
- `cash-lens-plaid-secret` = your Plaid secret

### 12B. Give the runtime service account access to the secrets

```bash
for SECRET_NAME in \
  cash-lens-database-url \
  cash-lens-app-encryption-key \
  cash-lens-clerk-jwt-key \
  cash-lens-plaid-client-id \
  cash-lens-plaid-secret
do
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --project "$PROJECT_ID" \
    --member="serviceAccount:cash-lens-runtime@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

### 12C. Add GitHub Actions secrets

Open:

- [https://github.com/yravan/cashlens/settings/secrets/actions](https://github.com/yravan/cashlens/settings/secrets/actions)

Create these repository secrets:

1. `GCP_PROJECT_ID`
2. `GCP_WORKLOAD_IDENTITY_PROVIDER`
3. `GCP_SERVICE_ACCOUNT`

Use:

- `GCP_PROJECT_ID` = your Google Cloud project ID
- `GCP_WORKLOAD_IDENTITY_PROVIDER` = the full provider name from step 11F
- `GCP_SERVICE_ACCOUNT` = `cash-lens-github-deployer@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com`

### 12D. Add GitHub Actions variables

Open:

- [https://github.com/yravan/cashlens/settings/variables/actions](https://github.com/yravan/cashlens/settings/variables/actions)

Create these repository variables:

1. `APP_BASE_URL`
2. `ALLOWED_ORIGINS`
3. `PLAID_ENV`
4. `PLAID_WEBHOOK_URL`

Use:

- `APP_BASE_URL` = your future production frontend URL, or temporarily `http://localhost:3000`
- `ALLOWED_ORIGINS` = `http://localhost:3000` at first, then later include the real Vercel production URL
- `PLAID_ENV` = `sandbox` at first
- `PLAID_WEBHOOK_URL` = leave blank until the backend has a real Cloud Run URL

## 13. First production backend deploy

The repo already contains the backend deploy workflow:

- `.github/workflows/deploy-api.yml`

Push the branch you want merged, then merge to `main`.

After that, go to:

- [https://github.com/yravan/cashlens/actions](https://github.com/yravan/cashlens/actions)

Open:

- `Deploy API to Cloud Run`

When it succeeds, copy the Cloud Run URL.

It will look like:

```txt
https://cash-lens-api-xxxxx-uc.a.run.app
```

Then update the GitHub variable:

- `PLAID_WEBHOOK_URL` = `https://YOUR-CLOUD-RUN-URL/plaid/webhook`

If you already know the frontend production URL, also update:

- `APP_BASE_URL`
- `ALLOWED_ORIGINS`

Then rerun the backend workflow once.

## 14. Production frontend setup on Vercel

### 14A. Create or import the Vercel project

1. Go to [https://vercel.com](https://vercel.com)
2. Click `Add New Project`
3. Import the `cashlens` GitHub repo
4. Set the **Root Directory** to:

```txt
apps/web
```

This stays correct even though the repo is now a monorepo.

### 14B. Set the Vercel install command

In Vercel, use:

```txt
pnpm install --frozen-lockfile --ignore-scripts
```

The repo also includes:

- `apps/web/vercel.json`

which sets that install command for the project.

### 14C. Add Vercel environment variables

For **Production**, add:

- `API_BASE_URL` = your Cloud Run backend URL
- `NEXT_PUBLIC_API_BASE_URL` = your Cloud Run backend URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = your Clerk production publishable key when you are ready for real production auth
- `CLERK_SECRET_KEY` = your Clerk production secret key when you are ready for real production auth
- `ENABLE_CLERK` = `true`

For **Preview**, you may also add the same variables if you want previews to build and render correctly.

Important:

- doing that does **not** create a separate preview backend
- preview is still not a sandbox environment

### 14D. Deploy production

After the Vercel variables are saved:

1. deploy the app
2. copy the production URL
3. update the GitHub backend variables:
   - `APP_BASE_URL`
   - `ALLOWED_ORIGINS`
4. rerun the backend deploy so Cloud Run gets the new values

## 15. Clerk production setup

### 15A. Development vs production

Use this rule:

- local = Clerk development
- preview = only for review, not for isolated auth testing
- production = Clerk production

### 15B. Before real production launch

Before you connect real accounts:

1. create or switch to the Clerk **Production** instance
2. add the real Vercel production URL in Clerk’s domain / allowed URL area
3. put the Clerk production keys in the **Vercel Production** environment
4. update the backend Secret Manager value `cash-lens-clerk-jwt-key` to match that same production Clerk instance
5. rerun the backend workflow

## 16. Plaid webhook setup

Once Cloud Run is deployed, set the Plaid webhook URL to:

```txt
https://YOUR-CLOUD-RUN-URL/plaid/webhook
```

Do this in two places:

1. the Plaid dashboard
2. the GitHub variable `PLAID_WEBHOOK_URL`

## 17. Production smoke test

After the backend and frontend are live:

1. open the production Vercel URL
2. sign in
3. go to Settings
4. open the Plaid flow
5. connect a sandbox bank first
6. open Dashboard, Accounts, and Transactions
7. click manual sync
8. edit a transaction in the review panel

If those work, production hosting is healthy.

## 18. Checklist before connecting real accounts

Do **not** connect real accounts until all of these are true:

1. local sandbox testing feels stable
2. production Vercel deploy works
3. production Cloud Run deploy works
4. Clerk production instance is in use for production
5. `cash-lens-clerk-jwt-key` matches the production Clerk instance
6. Plaid production credentials are ready
7. GitHub variable `PLAID_ENV` is changed from `sandbox` to `production`
8. backend deploy is rerun after those changes

## 19. Switching Plaid from Sandbox to Production

Only do this after the checklist above is complete.

Change:

- GitHub repository variable `PLAID_ENV` from `sandbox` to `production`

Update these Secret Manager secrets if needed:

- `cash-lens-clerk-jwt-key`
- `cash-lens-plaid-client-id`
- `cash-lens-plaid-secret`

Then rerun the backend deployment workflow.

Also verify in Plaid:

- the `transactions` product is enabled in production
- the production webhook URL is correct

## 20. Read the Docs setup

If you want to use the Read the Docs community service, the GitHub repo must be **public**.

This repo is already prepared for Read the Docs with:

- `.readthedocs.yaml`
- `mkdocs.yml`
- `docs/`

### 20A. Test docs locally first

```bash
cd /Users/yajvanravan/cashlens
make docs-build
```

If you want a local preview:

```bash
cd /Users/yajvanravan/cashlens
make docs-serve
```

Then open:

- [http://127.0.0.1:8000](http://127.0.0.1:8000)

### 20B. Create the Read the Docs project

1. Go to [https://readthedocs.com](https://readthedocs.com)
2. Sign in with GitHub
3. Import the `cashlens` repo
4. Finish the import flow

Read the Docs should automatically detect the repo’s top-level `.readthedocs.yaml`.

## 21. Changelog and versioning

The files that matter are:

- `VERSION`
- `CHANGELOG.md`
- `package.json`
- `apps/api/pyproject.toml`
- `apps/web/package.json`
- `packages/api-types/package.json`

The rule is:

- keep all version files aligned
- put new work in the `Unreleased` section of `CHANGELOG.md`

When cutting a release:

1. choose the new version number
2. update all version files
3. move shipped notes from `Unreleased` into a dated release section
4. run:

```bash
cd /Users/yajvanravan/cashlens
make docs-build
```

That verifies:

- version alignment
- changelog structure
- docs build health

## 22. Troubleshooting

### Local: Clerk sign-in works badly or hangs

Usually means:

- you used `127.0.0.1` instead of `localhost`
- `CLERK_JWT_KEY` is missing in the backend
- frontend and backend are not using matching Clerk development credentials

### Local: backend returns 401 during Clerk testing

Usually means:

- `CLERK_JWT_KEY` is missing or wrong in `apps/api/.env`

### GitHub Actions: backend deploy fails

Usually means:

- Workload Identity provider value is wrong
- deployer service account email is wrong
- IAM permissions have not propagated yet

### GitHub Actions: “caller does not have permission to act as service account”

Usually means:

- the GitHub deployer can start the deploy
- but it cannot act as the current build service account or runtime service account

Re-check:

- `gcloud builds get-default-service-account --project "$PROJECT_ID"`
- `roles/run.builder`
- `roles/iam.serviceAccountUser`

### Vercel preview works, but it feels unsafe for testing real flows

That is expected.

Preview is not a separate backend environment in this repo today.

### Production frontend works, but backend requests return 401

Usually means:

- Vercel and Cloud Run are using different Clerk instances
- `cash-lens-clerk-jwt-key` does not match the frontend Clerk keys

### Plaid Link opens but account connection fails

Usually means:

- wrong Plaid keys
- wrong `PLAID_ENV`
- wrong webhook URL

## 23. The shortest safe operating loop

If you want the simplest ongoing workflow, use this:

1. build and test locally
2. do Plaid sandbox testing locally
3. use Vercel previews only for frontend review
4. merge to `main`
5. let Cloud Run and Vercel handle production deploys
6. only use production for the real app
