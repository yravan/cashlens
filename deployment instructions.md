# Cash Lens Zero-to-One Deployment Guide

This guide is written for a non-technical Mac user.

It assumes you want to build Cash Lens in **two hosted stages**:

1. make the **first deployment**
   - this becomes your **staging** environment
   - safe for sandbox testing and hosted QA
2. make the **second deployment**
   - this becomes your **production** environment
   - this is the hardened environment for your real personal financial data

That is the safest way to go from zero to one.

## 1. The short version

You are building four environments over time:

| Environment | Purpose | Use real personal data? |
| --- | --- | --- |
| `local` | coding and debugging on your Mac | `No` |
| `preview` | temporary Vercel branch / PR links | `No` |
| `staging` | first hosted deployment | `No` |
| `production` | second hosted deployment | `Yes` |

The order is:

1. set up local development
2. create the first hosted deployment
3. treat that first hosted deployment as staging
4. create a second, separate production deployment

## 2. The security rule that matters most

When you reach production, staging and production should **not** share:

- database
- encryption key
- Plaid secrets
- Clerk verification key
- Cloud Run service
- Vercel project

That separation is what protects you when production starts holding your real data.

## 3. What the repo supports today

Today the repo already has:

- one frontend app in `apps/web`
- one backend app in `apps/api`
- one backend deploy workflow in `.github/workflows/deploy-api.yml`

That existing backend deploy path should be treated as the basis for the **first hosted deployment**, which becomes staging.

## 4. Stage 0: local setup

Do this once before any hosted deployment.

### 4A. Accounts you need

Make sure you have accounts for:

1. GitHub
2. Vercel
3. Neon
4. Clerk
5. Plaid
6. Google Cloud
7. Read the Docs

### 4B. Install tools on your Mac

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

### 4C. GitHub repo check

Go to the project:

```bash
cd /Users/yajvanravan/cashlens
```

Log into GitHub CLI if needed:

```bash
gh auth login
```

### 4D. Local demo mode

For the fastest local startup, create `/Users/yajvanravan/cashlens/apps/web/.env.local`:

```env
API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENABLE_CLERK=false
```

### 4E. Local full sandbox mode

This is the realistic local development setup.

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

Use `localhost`, not `127.0.0.1`, for Clerk locally.

### 4F. Run locally

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

### 4G. Validate locally

```bash
cd /Users/yajvanravan/cashlens
make api-test
make web-test
make e2e
make docs-build
```

## 5. Stage 1: first hosted deployment

This first hosted deployment becomes **staging**.

Do not put your real personal financial data in it.

Its job is:

- hosted integration testing
- sandbox Plaid testing
- auth and deployment validation
- safe QA before real production exists

### 5A. What Stage 1 should use

Stage 1 should use:

- Vercel for the frontend
- Cloud Run for the backend
- Neon for a staging database
- Clerk non-production setup
- Plaid `sandbox`
- fake or test data only

### 5B. Staging naming recommendation

Use these names for the first deployment:

- Cloud Run service: `cash-lens-api`
- runtime service account: `cash-lens-runtime`
- deployer service account: `cash-lens-github-deployer`
- Neon database: your staging database
- Vercel project: your existing `cashlens` frontend deployment

### 5C. Create the staging database in Neon

1. Go to [https://neon.tech](https://neon.tech)
2. Create a project or branch for staging
3. Copy the pooled connection string

This value becomes the staging `DATABASE_URL`.

### 5D. Create the staging Clerk app / instance

For the first hosted deployment, use a non-production Clerk setup.

That means:

- Clerk development instance is acceptable for early staging
- or a dedicated non-production Clerk app if you prefer cleaner separation

You need:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- Clerk JWKS / verification key for the backend

### 5E. Create the staging Plaid app

In Plaid:

1. create or use a Sandbox app
2. enable the `transactions` product
3. copy:
   - `PLAID_CLIENT_ID`
   - `PLAID_SECRET`

### 5F. Create the Google Cloud project for staging

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Create a project
3. Enable billing

Then log in locally:

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_GCP_PROJECT_ID
gcloud auth application-default set-quota-project YOUR_GCP_PROJECT_ID
```

### 5G. Enable Google Cloud APIs

```bash
export PROJECT_ID="YOUR_GCP_PROJECT_ID"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export GITHUB_REPO="yravan/cashlens"
export BUILD_SERVICE_ACCOUNT="$(gcloud builds get-default-service-account --project "$PROJECT_ID")"

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

### 5H. Create the staging service accounts

```bash
gcloud iam service-accounts create cash-lens-runtime \
  --project "$PROJECT_ID" \
  --display-name "Cash Lens staging runtime"

gcloud iam service-accounts create cash-lens-github-deployer \
  --project "$PROJECT_ID" \
  --display-name "Cash Lens staging GitHub deployer"
```

### 5I. Grant staging IAM permissions

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

If `BUILD_SERVICE_ACCOUNT` is a user-managed service account such as `PROJECT_NUMBER-compute@developer.gserviceaccount.com`, also run:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "${BUILD_SERVICE_ACCOUNT}" \
  --project "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### 5J. Create Workload Identity for the staging deploy

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

Get the provider name:

```bash
gcloud iam workload-identity-pools providers describe "cash-lens" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="github" \
  --format="value(name)"
```

### 5K. Create staging secrets in Secret Manager

Create these secrets:

1. `cash-lens-database-url`
2. `cash-lens-app-encryption-key`
3. `cash-lens-clerk-jwt-key`
4. `cash-lens-plaid-client-id`
5. `cash-lens-plaid-secret`

Use:

- staging Neon pooled URL
- staging encryption key
- staging Clerk verification key
- Plaid sandbox client ID
- Plaid sandbox secret

### 5L. Give the staging runtime service account access to secrets

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

### 5M. Add GitHub Actions secrets for staging

Open:

- [https://github.com/yravan/cashlens/settings/environments](https://github.com/yravan/cashlens/settings/environments)

Create or open the `staging` environment, then under `Environment secrets` create:

1. `GCP_PROJECT_ID`
2. `GCP_WORKLOAD_IDENTITY_PROVIDER`
3. `GCP_SERVICE_ACCOUNT`

Use:

- `GCP_PROJECT_ID` = your staging GCP project ID
- `GCP_WORKLOAD_IDENTITY_PROVIDER` = the full provider name from Stage 1
- `GCP_SERVICE_ACCOUNT` = `cash-lens-github-deployer@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com`

### 5N. Add GitHub Actions variables for staging

Open:

- [https://github.com/yravan/cashlens/settings/environments](https://github.com/yravan/cashlens/settings/environments)

Open the `staging` environment, then under `Environment variables` create:

1. `APP_BASE_URL`
2. `ALLOWED_ORIGINS`
3. `PLAID_ENV`
4. `PLAID_WEBHOOK_URL`

Start with:

- `APP_BASE_URL` = temporary staging frontend URL or `http://localhost:3000`
- `ALLOWED_ORIGINS` = `http://localhost:3000`
- `PLAID_ENV` = `sandbox`
- `PLAID_WEBHOOK_URL` = blank for now

### 5O. Deploy the staging backend

The repo already has the backend workflow:

- `.github/workflows/deploy-api.yml`

For this guide, treat it as the **staging backend workflow**.

Merge to `main` or run the workflow manually from GitHub Actions.

When it succeeds, copy the Cloud Run URL.

It will look like:

```txt
https://cash-lens-api-xxxxx-uc.a.run.app
```

This becomes your **staging backend URL**.

### 5P. Create the staging frontend in Vercel

In Vercel:

1. create or import a project from the GitHub repo
2. set **Root Directory** to:

```txt
apps/web
```

3. use the install command:

```txt
pnpm install --frozen-lockfile --ignore-scripts
```

The repo also already includes:

- `apps/web/vercel.json`

### 5Q. Add staging frontend environment variables in Vercel

Add:

- `API_BASE_URL` = staging Cloud Run URL
- `NEXT_PUBLIC_API_BASE_URL` = staging Cloud Run URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = staging Clerk publishable key
- `CLERK_SECRET_KEY` = staging Clerk secret key
- `ENABLE_CLERK` = `true`

### 5R. Finish staging wiring

After the staging frontend deploys:

1. copy the staging Vercel URL
2. update the GitHub `staging` environment variables:
   - `APP_BASE_URL`
   - `ALLOWED_ORIGINS`
3. set:
   - `PLAID_WEBHOOK_URL` = `https://YOUR-STAGING-CLOUD-RUN-URL/plaid/webhook`
4. rerun the staging backend workflow once

### 5S. What preview means after Stage 1

After the first deployment exists:

- Vercel branch / PR URLs are just **preview**
- your stable hosted environment is **staging**

Use preview for:

- frontend review
- checking if a branch builds

Use staging for:

- hosted QA
- sandbox Plaid testing
- testing auth and backend integration

### 5T. Staging smoke test

After Stage 1 is complete:

1. open the staging Vercel URL
2. sign in
3. go to Settings
4. connect a Plaid sandbox institution
5. open Dashboard, Accounts, and Transactions
6. click manual sync
7. edit a transaction

If that works, your first deployment is complete and you now have staging.

## 6. Stage 2: second hosted deployment

This second hosted deployment becomes **production**.

This is the environment that should eventually hold your real personal financial data.

### 6A. The goal of Stage 2

You are not “upgrading staging.”

You are creating a **second deployment** that is deliberately separate from staging.

### 6B. What Stage 2 must have separately

Production needs its own:

- Cloud Run service
- runtime service account
- deployer service account
- Secret Manager secret set
- Neon database
- Vercel project
- Clerk production instance
- Plaid production credentials

### 6C. Recommended production names

Use:

- Cloud Run service: `cash-lens-api-prod`
- runtime service account: `cash-lens-runtime-prod`
- deployer service account: `cash-lens-github-deployer-prod`
- Vercel project: `cashlens-prod`
- secret names:
  - `cash-lens-prod-database-url`
  - `cash-lens-prod-app-encryption-key`
  - `cash-lens-prod-clerk-jwt-key`
  - `cash-lens-prod-plaid-client-id`
  - `cash-lens-prod-plaid-secret`

### 6D. Create the production database in Neon

Create a separate production database target.

Best practice:

- separate Neon project for production

Acceptable simpler option:

- clearly separate production branch or database

Copy the production pooled connection string.

### 6E. Create the Clerk production instance

In Clerk:

1. create or switch to the production instance
2. copy:
   - production publishable key
   - production secret key
3. get the production JWKS / backend verification key

Production backend must verify the production Clerk instance only.

### 6F. Create the Plaid production app / credentials

In Plaid:

1. make sure you have production access
2. enable the `transactions` product for production
3. copy:
   - production `PLAID_CLIENT_ID`
   - production `PLAID_SECRET`

### 6G. Create production Google Cloud resources

You have two good options:

1. same GCP project as staging, but separate services and secrets
2. separate GCP project for production

Strongest separation:

- separate GCP project

Simpler setup:

- same GCP project, separate resource names

This guide assumes the simpler route:

- same GCP project
- separate production resource names

### 6H. Create production service accounts

```bash
gcloud iam service-accounts create cash-lens-runtime-prod \
  --project "$PROJECT_ID" \
  --display-name "Cash Lens production runtime"

gcloud iam service-accounts create cash-lens-github-deployer-prod \
  --project "$PROJECT_ID" \
  --display-name "Cash Lens production GitHub deployer"
```

### 6I. Grant production IAM permissions

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer-prod@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer-prod@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.sourceDeveloper"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer-prod@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/serviceusage.serviceUsageConsumer"

gcloud iam service-accounts add-iam-policy-binding \
  "cash-lens-runtime-prod@$PROJECT_ID.iam.gserviceaccount.com" \
  --project "$PROJECT_ID" \
  --member="serviceAccount:cash-lens-github-deployer-prod@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

If needed, also grant production deployer `roles/iam.serviceAccountUser` on the active build service account, using the same pattern as staging.

### 6J. Create production secrets in Secret Manager

Create:

1. `cash-lens-prod-database-url`
2. `cash-lens-prod-app-encryption-key`
3. `cash-lens-prod-clerk-jwt-key`
4. `cash-lens-prod-plaid-client-id`
5. `cash-lens-prod-plaid-secret`

Use:

- production Neon pooled URL
- a **new** production encryption key
- production Clerk verification key
- production Plaid client ID
- production Plaid secret

Do **not** reuse the staging encryption key.

### 6K. Give the production runtime account access to production secrets

```bash
for SECRET_NAME in \
  cash-lens-prod-database-url \
  cash-lens-prod-app-encryption-key \
  cash-lens-prod-clerk-jwt-key \
  cash-lens-prod-plaid-client-id \
  cash-lens-prod-plaid-secret
do
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --project "$PROJECT_ID" \
    --member="serviceAccount:cash-lens-runtime-prod@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

### 6L. Create the production backend deploy path

The repo now has two production workflows:

- `.github/workflows/deploy-api-production.yml`
- `.github/workflows/deploy-web-production.yml`

The old workflow stays as staging:

- `.github/workflows/deploy-api.yml`

The new production backend workflow is already wired to expect:

- Cloud Run service `cash-lens-api-prod`
- runtime service account `cash-lens-runtime-prod`
- production secret names in Secret Manager
- production environment values from a GitHub environment named `production`

The new production frontend workflow is already wired to expect:

- a second Vercel project
- a Vercel access token
- that second project's `orgId`
- that second project's `projectId`

That means you do **not** need to give production frontend secrets to GitHub Actions. Those stay in Vercel.

### 6M. Create production GitHub secrets and variables

In GitHub, create a separate environment named `production`.

Open:

- [https://github.com/yravan/cashlens/settings/environments](https://github.com/yravan/cashlens/settings/environments)

Then:

1. click `New environment`
2. name it `production`
3. open that environment
4. add the secrets and variables below

Use **environment-level** values, not repo-level values. GitHub's docs for environment secrets and variables are here:

- [Managing environments for deployment](https://docs.github.com/en/actions/reference/environments)
- [Secrets in GitHub Actions](https://docs.github.com/en/actions/concepts/security/about-secrets)

### 6N. Put these exact values into Google Secret Manager

Create these five production secrets in Google Secret Manager:

1. `cash-lens-prod-database-url`
2. `cash-lens-prod-app-encryption-key`
3. `cash-lens-prod-clerk-jwt-key`
4. `cash-lens-prod-plaid-client-id`
5. `cash-lens-prod-plaid-secret`

Where to get each one:

| Secret Manager secret name | What value goes inside it | Where to get it |
| --- | --- | --- |
| `cash-lens-prod-database-url` | your production Postgres connection string | In Neon, open your **production** project or branch, click `Connect`, and copy the **pooled** connection string. Neon recommends pooled connections for app workloads. See [Neon connection details](https://neon.com/docs/get-started-with-neon/connect-neon) and [Neon connection pooling](https://neon.com/docs/connect/connection-pooling). |
| `cash-lens-prod-app-encryption-key` | a brand-new random string | Generate it yourself on your Mac: `openssl rand -hex 32` |
| `cash-lens-prod-clerk-jwt-key` | the full JWKS JSON for your Clerk production instance | In Clerk, switch to the **Production** instance, confirm the production domain, then open `https://YOUR_CLERK_DOMAIN/.well-known/jwks.json` in your browser and copy the full JSON. Clerk's manual verification docs use a JWKS public key for token verification. See [Deploy your Clerk app to production](https://clerk.com/docs/deployments/overview) and [Manual JWT verification](https://clerk.com/docs/reference/node/networkless-token-verification). |
| `cash-lens-prod-plaid-client-id` | your Plaid production `client_id` | In the Plaid Dashboard, use the production app / production keys area and copy the live `client_id`. Plaid says live `client_id` and `secret` are provided in the Dashboard once access is granted. See [Plaid API overview](https://plaid.com/docs/api/) and [Production access](https://plaid.com/core-exchange/docs/production-access/). |
| `cash-lens-prod-plaid-secret` | your Plaid production `secret` | Same place as above in the Plaid Dashboard production keys area. |

Do **not** reuse the staging encryption key.

### 6O. Create the second Vercel project for production

In Vercel:

1. create a **second** project
2. name it something obvious, for example `cashlens-prod`
3. set **Root Directory** to:

```txt
apps/web
```

4. set install command to:

```txt
pnpm install --frozen-lockfile --ignore-scripts
```

5. after the project exists, open `Settings -> Git`
6. click `Disconnect` under the connected Git repository

Disconnecting the Git repo is the safest option here because it ensures this second Vercel project only deploys when you manually run the production workflow. Vercel documents the disconnect flow here:

- [Vercel Git settings](https://vercel.com/docs/project-configuration/git-settings)

### 6P. Add production frontend environment variables in Vercel

Open the second Vercel project, then go to:

- `Settings -> Environment Variables`

Create:

1. `API_BASE_URL`
2. `NEXT_PUBLIC_API_BASE_URL`
3. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
4. `CLERK_SECRET_KEY`
5. `ENABLE_CLERK`

Use:

- `API_BASE_URL` = your production Cloud Run URL from the production backend workflow
- `NEXT_PUBLIC_API_BASE_URL` = the same production Cloud Run URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = your Clerk **production** publishable key (`pk_live_...`)
- `CLERK_SECRET_KEY` = your Clerk **production** secret key (`sk_live_...`)
- `ENABLE_CLERK` = `true`

Where to get the Clerk keys:

- In Clerk, switch to the **Production** instance
- open the API keys page
- copy the publishable key and secret key

Clerk's current env var docs for Next.js are here:

- [Clerk Publishable and Secret Keys](https://clerk.com/docs/upgrade-guides/api-keys)

### 6Q. Add production GitHub environment secrets

Open:

- [https://github.com/yravan/cashlens/settings/environments](https://github.com/yravan/cashlens/settings/environments)

Select the `production` environment, then under `Environment secrets`, add:

1. `GCP_PROJECT_ID`
2. `GCP_WORKLOAD_IDENTITY_PROVIDER`
3. `GCP_SERVICE_ACCOUNT`
4. `VERCEL_TOKEN`

Use:

- `GCP_PROJECT_ID` = your production Google Cloud project ID
- `GCP_WORKLOAD_IDENTITY_PROVIDER` = the full provider name returned by:

```bash
gcloud iam workload-identity-pools providers describe "cash-lens" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="github" \
  --format="value(name)"
```

- `GCP_SERVICE_ACCOUNT` = `cash-lens-github-deployer-prod@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com`
- `VERCEL_TOKEN` = a Vercel access token created from `Personal Account -> Settings -> Tokens -> Create`

Vercel's token docs are here:

- [How do I use a Vercel API Access Token?](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token)

### 6R. Add production GitHub environment variables

In the same GitHub `production` environment, under `Environment variables`, add:

1. `APP_BASE_URL`
2. `ALLOWED_ORIGINS`
3. `PLAID_ENV`
4. `PLAID_WEBHOOK_URL`
5. `VERCEL_ORG_ID`
6. `VERCEL_PROJECT_ID`

Use:

- `APP_BASE_URL` = if you already know the final production frontend URL, use it; otherwise temporarily use `https://placeholder.invalid`
- `ALLOWED_ORIGINS` = match `APP_BASE_URL`; if you are using the placeholder, set `https://placeholder.invalid`
- `PLAID_ENV` = `production`
- `PLAID_WEBHOOK_URL` = leave blank until the production backend exists, then fill `https://YOUR-PRODUCTION-CLOUD-RUN-URL/plaid/webhook`
- `VERCEL_ORG_ID` = the `orgId` for your second Vercel project
- `VERCEL_PROJECT_ID` = the `projectId` for your second Vercel project

The easiest exact way to get `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` is:

```bash
cd /Users/yajvanravan/cashlens/apps/web
vercel link --yes --project cashlens-prod --scope YOUR_VERCEL_SCOPE
```

Then open:

- `/Users/yajvanravan/cashlens/apps/web/.vercel/project.json`

Copy:

- `orgId` -> GitHub variable `VERCEL_ORG_ID`
- `projectId` -> GitHub variable `VERCEL_PROJECT_ID`

Vercel documents this CLI linking flow here:

- [vercel link](https://vercel.com/docs/cli/link)
- [Vercel CLI global options](https://vercel.com/docs/cli/global-options)

### 6S. Run the production backend workflow

Open GitHub Actions and manually run:

- `.github/workflows/deploy-api-production.yml`

Use:

- `git_ref = main`

That creates the second Cloud Run service:

- `cash-lens-api-prod`

When it succeeds, copy the Cloud Run URL.

### 6T. Update Vercel production env vars, then run the production frontend workflow

Now that you have the production backend URL:

1. go back to the second Vercel project
2. set:
   - `API_BASE_URL`
   - `NEXT_PUBLIC_API_BASE_URL`
3. redeploy through GitHub Actions by manually running:
   - `.github/workflows/deploy-web-production.yml`
4. use:
   - `git_ref = main`

That creates the second frontend production deployment without relying on Vercel Git auto-deploy.

### 6U. Finish the webhook and rerun the production backend workflow once

After the second Vercel project is live:

1. copy the real production frontend URL
2. update GitHub `production` environment variables:
   - `APP_BASE_URL`
   - `ALLOWED_ORIGINS`
3. update:
   - `PLAID_WEBHOOK_URL` = `https://YOUR-PRODUCTION-CLOUD-RUN-URL/plaid/webhook`
4. paste that same webhook URL into the Plaid Dashboard
5. rerun `.github/workflows/deploy-api-production.yml`

### 6V. Production smoke test

Before using real accounts broadly:

1. open the production Vercel URL
2. sign in with production auth
3. verify the backend is live
4. verify dashboard pages load
5. verify Plaid Link opens
6. do the smallest safe real-world test you are comfortable with

### 6W. Production security checklist

Before trusting production with real personal data, all of these should be true:

1. staging and production do not share a database
2. staging and production do not share an encryption key
3. staging and production do not share Plaid secrets
4. staging and production do not share Clerk verification keys
5. production uses Clerk production keys
6. production uses Plaid production credentials
7. production webhook verification is enabled
8. demo mode is disabled in production
9. seed demo data is disabled in production
10. staging remains sandbox-only

## 7. How to use the environments after both stages exist

Once both stages are complete:

1. do day-to-day work locally
2. use preview for frontend review
3. use staging for hosted testing
4. deploy to production separately and intentionally

## 8. Read the Docs setup

If you want to use the Read the Docs community service, the GitHub repo must be **public**.

This repo is already prepared with:

- `.readthedocs.yaml`
- `mkdocs.yml`
- `docs/`

### 8A. Test docs locally

```bash
cd /Users/yajvanravan/cashlens
make docs-build
```

### 8B. Local docs preview

```bash
cd /Users/yajvanravan/cashlens
make docs-serve
```

Then open:

- [http://127.0.0.1:8000](http://127.0.0.1:8000)

### 8C. Import on Read the Docs

1. Go to [https://readthedocs.com](https://readthedocs.com)
2. Sign in with GitHub
3. Import the `cashlens` repo

## 9. Changelog and versioning

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

## 10. Troubleshooting

### I only have the first deployment

That is fine.

In this guide:

- first deployment = staging
- second deployment = production

### Preview feels strange

That is expected.

Preview is not your stable hosted test environment.

That role belongs to staging.

### Production would share staging secrets

Stop and fix it first.

That is the exact situation this two-stage rollout is meant to avoid.

## 11. The simplest safe operating loop

Use this mental model:

1. local for building
2. preview for quick review
3. first deployment for staging
4. second deployment for production
