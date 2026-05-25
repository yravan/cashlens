# Cash Lens Deployment Instructions

This guide assumes:

- you are on a Mac
- you are not technical
- you want the app hosted the way this repo is now designed:
  - frontend on Vercel
  - backend on Google Cloud Run
  - backend deployments triggered from GitHub Actions
  - backend secrets stored in Google Secret Manager
  - database on Neon
  - auth on Clerk
  - bank connections on Plaid

If you follow this guide from top to bottom, you should end with:

- a working hosted MVP
- a backend that deploys from GitHub instead of your laptop
- secrets stored outside the code repo

## 1. What you are deploying

Cash Lens has two apps:

- `apps/web`: the website people open in the browser
- `apps/api`: the Python backend that stores data, talks to Plaid, and powers the dashboard

The website talks to the API.
The API talks to Neon and Plaid.

## 2. Accounts you need

Create or sign into:

1. GitHub
2. Vercel
3. Neon
4. Clerk
5. Plaid
6. Google Cloud

## 3. Install the tools on your Mac

Open the Terminal app.

Install Homebrew if needed:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install the tools:

```bash
brew install node pnpm gh google-cloud-sdk
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Close Terminal.
Open Terminal again.

Confirm the tools exist:

```bash
node -v
pnpm -v
gh --version
gcloud --version
uv --version
```

## 4. Put the code on GitHub

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

If the repo does not exist yet:

```bash
gh repo create cashlens --private --source=. --remote=origin
```

If the repo already exists:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/cashlens.git
```

Then push:

```bash
git push -u origin main
```

If you intentionally need to overwrite the remote branch:

```bash
git push --force origin main
```

## 5. Create the Neon database

1. Go to [https://neon.tech](https://neon.tech)
2. Create a new project
3. Name it something like `cash-lens`
4. Create the database

When Neon shows the connection strings, copy the pooled connection string.

You will use that as `DATABASE_URL`.

## 6. Create the Clerk app

1. Go to [https://clerk.com](https://clerk.com)
2. Create a new application
3. Name it `Cash Lens`
4. Keep the simplest sign-in method you want
5. Finish setup

Copy:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

## 7. Create the Plaid app

1. Go to [https://dashboard.plaid.com](https://dashboard.plaid.com)
2. Create a new app
3. Choose Sandbox first
4. Enable the `transactions` product

Copy:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`

Do not worry about the webhook URL yet.
You will add that after the backend is deployed.

## 8. Create the Google Cloud project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Enable billing for that project

Pick a project ID.
Example:

```txt
cashlens-492517
```

## 9. Sign into Google Cloud locally

Back in Terminal:

```bash
gcloud auth login
gcloud auth application-default login
```

Then set your project:

```bash
gcloud config set project YOUR_GCP_PROJECT_ID
gcloud auth application-default set-quota-project YOUR_GCP_PROJECT_ID
```

## 10. Create your local environment files

### Backend `.env`

Create `/Users/yajvanravan/cashlens/apps/api/.env` with:

```env
DATABASE_URL=YOUR_NEON_POOLED_URL
APP_ENCRYPTION_KEY=CHANGE_THIS_TO_A_LONG_RANDOM_SECRET
PLAID_CLIENT_ID=YOUR_PLAID_CLIENT_ID
PLAID_SECRET=YOUR_PLAID_SECRET
PLAID_ENV=sandbox
PLAID_WEBHOOK_URL=
DEMO_MODE=false
SEED_DEMO_DATA=false
```

Use a long random value for `APP_ENCRYPTION_KEY`.

### Frontend `.env.local`

Create `/Users/yajvanravan/cashlens/apps/web/.env.local` with:

```env
API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=YOUR_CLERK_SECRET_KEY
```

## 11. Test locally before deploying

### Backend

```bash
cd /Users/yajvanravan/cashlens/apps/api
UV_CACHE_DIR=/private/tmp/uv-cache uv sync
uv run uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8000
```

Leave that running.

### Frontend

Open a second Terminal window:

```bash
cd /Users/yajvanravan/cashlens/apps/web
pnpm install
pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3000
```

Then open:

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

If you see the dashboard, local setup is working.

## 12. Enable the Google Cloud APIs needed for GitHub-based deploys

In Terminal:

```bash
export PROJECT_ID="YOUR_GCP_PROJECT_ID"

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

## 13. Collect your Google Cloud project number

You need both the project ID and the project number.

Run:

```bash
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
echo "$PROJECT_NUMBER"
```

## 14. Create the Cloud Run runtime service account

This is the identity the running backend will use inside Google Cloud.

Create it:

```bash
gcloud iam service-accounts create cash-lens-runtime \
  --project "$PROJECT_ID" \
  --display-name "Cash Lens Cloud Run runtime"
```

Its email will be:

```txt
cash-lens-runtime@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com
```

## 15. Create the GitHub deployer service account

This is the identity GitHub Actions will impersonate when it deploys the backend.

Create it:

```bash
gcloud iam service-accounts create cash-lens-github-deployer \
  --project "$PROJECT_ID" \
  --display-name "Cash Lens GitHub deployer"
```

Its email will be:

```txt
cash-lens-github-deployer@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com
```

## 16. Grant the GitHub deployer the required Google Cloud permissions

Run these commands:

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
```

## 17. Grant the Cloud Build service account permission to build source deployments

Cloud Run source deployments use Cloud Build behind the scenes.

Run:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.builder"
```

## 18. Create the Workload Identity pool and provider for GitHub Actions

This is what lets GitHub deploy to Google Cloud without storing a long-lived Google key in GitHub.

Create the pool:

```bash
gcloud iam workload-identity-pools create "github" \
  --project="$PROJECT_ID" \
  --location="global" \
  --display-name="GitHub Actions Pool"
```

Create the provider:

```bash
gcloud iam workload-identity-pools providers create-oidc "cash-lens" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="Cash Lens GitHub Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='yravan/cashlens'"
```

If you renamed the GitHub repo, replace `yravan/cashlens` with your real `OWNER/REPO`.

## 19. Allow that GitHub repo to impersonate the deployer service account

Run:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "cash-lens-github-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --project "$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/yravan/cashlens"
```

Again, if your repo name is different, replace `yravan/cashlens`.

## 20. Get the full Workload Identity provider name

Run:

```bash
gcloud iam workload-identity-pools providers describe "cash-lens" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="github" \
  --format="value(name)"
```

The result will look like:

```txt
projects/123456789/locations/global/workloadIdentityPools/github/providers/cash-lens
```

Copy that value.

## 21. Create the runtime secrets in Google Secret Manager

Create these four secrets:

1. `cash-lens-database-url`
2. `cash-lens-app-encryption-key`
3. `cash-lens-plaid-client-id`
4. `cash-lens-plaid-secret`

You can do this in the Google Cloud console:

1. Open Secret Manager
2. Click `Create Secret`
3. Use the exact names above
4. Paste the matching values

Mapping:

- `cash-lens-database-url` = your Neon pooled URL
- `cash-lens-app-encryption-key` = your long random encryption key
- `cash-lens-plaid-client-id` = your Plaid client ID
- `cash-lens-plaid-secret` = your Plaid secret

## 22. Give the runtime service account access to those secrets

The running API needs permission to read the secrets at runtime.

Run:

```bash
for SECRET_NAME in \
  cash-lens-database-url \
  cash-lens-app-encryption-key \
  cash-lens-plaid-client-id \
  cash-lens-plaid-secret
do
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --project "$PROJECT_ID" \
    --member="serviceAccount:cash-lens-runtime@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

## 23. Add the Google auth secrets to GitHub Actions

Go to your GitHub repo:

- [https://github.com/yravan/cashlens/settings/secrets/actions](https://github.com/yravan/cashlens/settings/secrets/actions)

Add these repository secrets:

1. `GCP_PROJECT_ID`
2. `GCP_WORKLOAD_IDENTITY_PROVIDER`
3. `GCP_SERVICE_ACCOUNT`

Use these values:

- `GCP_PROJECT_ID` = your Google Cloud project ID
- `GCP_WORKLOAD_IDENTITY_PROVIDER` = the full provider name from step 20
- `GCP_SERVICE_ACCOUNT` = `cash-lens-github-deployer@YOUR_GCP_PROJECT_ID.iam.gserviceaccount.com`

## 24. Add the GitHub Actions repository variables

Go to:

- [https://github.com/yravan/cashlens/settings/variables/actions](https://github.com/yravan/cashlens/settings/variables/actions)

Add these repository variables:

1. `APP_BASE_URL`
2. `ALLOWED_ORIGINS`
3. `PLAID_ENV`
4. `PLAID_WEBHOOK_URL`

What to put in them:

- `APP_BASE_URL`
  - if you already know your Vercel production URL, use it
  - otherwise temporarily use `http://127.0.0.1:3000`
- `ALLOWED_ORIGINS`
  - start with `http://127.0.0.1:3000`
  - later change it to include your Vercel URL
- `PLAID_ENV`
  - set to `sandbox` first
- `PLAID_WEBHOOK_URL`
  - you can leave this blank for the very first backend deploy
  - after the backend exists, change it to:
    - `https://YOUR-CLOUD-RUN-URL/plaid/webhook`

## 25. Make sure the backend workflow file is in GitHub

This repo now includes:

- `.github/workflows/deploy-api.yml`
- `apps/api/Dockerfile`

Push those files:

```bash
cd /Users/yajvanravan/cashlens
git add .
git commit -m "Add GitHub-based Cloud Run backend deployment"
git push origin main
```

## 26. Watch the first backend deployment in GitHub Actions

Go to:

- [https://github.com/yravan/cashlens/actions](https://github.com/yravan/cashlens/actions)

Open the workflow named:

- `Deploy API to Cloud Run`

If it succeeds, it will print the deployed Cloud Run URL.

It will look like:

```txt
https://cash-lens-api-xxxxx-uc.a.run.app
```

Copy that URL.

## 27. Update the GitHub variables now that the backend URL exists

Set:

- `PLAID_WEBHOOK_URL` = `https://YOUR-CLOUD-RUN-URL/plaid/webhook`

If you also know your frontend URL already, set:

- `APP_BASE_URL` = your Vercel production URL
- `ALLOWED_ORIGINS` = `https://YOUR-VERCEL-URL.vercel.app,http://127.0.0.1:3000`

After updating variables, go back to GitHub Actions and rerun the backend workflow once.

## 28. Point Plaid to the backend webhook

In Plaid:

1. Open your Plaid app settings
2. Find the webhook URL field
3. Paste:
   - `https://YOUR-CLOUD-RUN-URL/plaid/webhook`
4. Save

## 29. Deploy the frontend to Vercel

1. Go to [https://vercel.com](https://vercel.com)
2. Click `Add New Project`
3. Import the `cashlens` GitHub repo
4. Set the root directory to:

```txt
apps/web
```

5. Add these Vercel environment variables:

- `API_BASE_URL` = your Cloud Run backend URL
- `NEXT_PUBLIC_API_BASE_URL` = your Cloud Run backend URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = your Clerk publishable key
- `CLERK_SECRET_KEY` = your Clerk secret key

6. Click Deploy

When Vercel finishes, copy the site URL.

## 30. Update the GitHub backend variables for the real frontend URL

Once Vercel gives you the real production URL, go back to GitHub repository variables and update:

- `APP_BASE_URL`
- `ALLOWED_ORIGINS`

Example:

- `APP_BASE_URL` = `https://cashlens-yourteam.vercel.app`
- `ALLOWED_ORIGINS` = `https://cashlens-yourteam.vercel.app,http://127.0.0.1:3000`

Then rerun the backend GitHub Actions workflow once so Cloud Run gets the new values.

## 31. Set Clerk allowed URLs

In Clerk:

1. Open your application
2. Find the URLs / redirect / domains section
3. Add your Vercel production URL
4. Add your local URL:
   - `http://127.0.0.1:3000`

This matters because Clerk sign-in can fail if the deployed domain is not allowed.

## 32. First production smoke test

After both deployments are live:

1. Open your Vercel site
2. Sign in with Clerk
3. Go to Settings
4. Click the Plaid connect button
5. Connect a sandbox bank
6. Open Dashboard, Accounts, and Transactions
7. Click manual sync
8. Edit a transaction in the review panel

If those work, the MVP is live.

## 33. What happens from now on

From this point forward:

- frontend changes deploy through Vercel when GitHub updates
- backend changes deploy through GitHub Actions when `apps/api` changes on `main`

That means you should no longer think of the backend deploy as "something you run from your laptop".
The GitHub repo becomes the deployment source of truth.

## 34. Switching Plaid from Sandbox to Production

Only do this after sandbox testing feels stable.

Change:

- the GitHub repository variable `PLAID_ENV` from `sandbox` to `production`

Update the Secret Manager secret values for:

- `cash-lens-plaid-client-id`
- `cash-lens-plaid-secret`

Then rerun the backend workflow.

Also verify in Plaid:

- the `transactions` product is enabled in production
- the webhook URL is still correct

## 35. Common problems and what they usually mean

### Problem: GitHub Actions fails before deploy

Usually means:

- the Workload Identity provider value is wrong
- the deployer service account email is wrong
- IAM permissions have not propagated yet

What to do:

1. re-check the three GitHub repository secrets
2. wait 5 minutes
3. rerun the workflow

### Problem: backend deploy works but the site cannot read data

Usually means:

- the Vercel API URL is wrong
- `ALLOWED_ORIGINS` is wrong
- the backend cannot read one of its secrets

What to do:

1. open the Cloud Run URL and check `/health`
2. confirm `ALLOWED_ORIGINS`
3. confirm the runtime service account has Secret Manager access

### Problem: Plaid Link opens but connect fails

Usually means:

- wrong Plaid keys
- wrong Plaid environment
- missing or wrong webhook URL

What to do:

1. confirm `PLAID_ENV`
2. confirm the secret values in Secret Manager
3. confirm the Plaid dashboard webhook URL

### Problem: Clerk sign-in works locally but not in production

Usually means:

- Clerk allowed URLs do not include the Vercel domain
- Vercel env vars were added after deploy and the site was not redeployed

What to do:

1. re-check Clerk allowed URLs
2. re-check Vercel env vars
3. trigger a Vercel redeploy

## 36. Safe first-launch sequence

If you want the least stressful path, do it in this order:

1. local test
2. backend GitHub deploy
3. frontend Vercel deploy
4. Clerk production sign-in test
5. Plaid sandbox test
6. one real end-to-end smoke test
7. only then consider Plaid production
