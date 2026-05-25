# Cash Lens Deployment Instructions

This guide assumes:

- you are on a Mac
- you are not technical
- you want the app hosted in the way the research doc recommended:
  - frontend on Vercel
  - backend on Google Cloud Run
  - database on Neon
  - auth on Clerk
  - bank connections on Plaid

If you follow this guide from top to bottom, you should end with a working hosted MVP.

## 1. What you are deploying

Cash Lens has two apps:

- `apps/web`: the website people open in the browser
- `apps/api`: the Python backend that stores data, talks to Plaid, and powers the dashboard

The web app talks to the API.
The API talks to the database and Plaid.

## 2. Accounts you need to create

Create these accounts before touching the code:

1. GitHub
2. Vercel
3. Neon
4. Clerk
5. Plaid
6. Google Cloud

If you already have any of them, sign in instead of creating new ones.

## 3. Install the tools on your Mac

Open the Terminal app.

Install Homebrew if you do not already have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install the tools you need:

```bash
brew install node pnpm gh google-cloud-sdk
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Close Terminal.
Open Terminal again.

Check that the tools are installed:

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

Sign into GitHub from the terminal:

```bash
gh auth login
```

Choose:

- `GitHub.com`
- `HTTPS`
- `Login with a web browser`

Then create a private repo named `cashlens` if you do not already have one:

```bash
gh repo create cashlens --private --source=. --remote=origin
```

If you already created the repo on GitHub manually, connect it instead:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/cashlens.git
```

Then push:

```bash
git push -u origin main
```

If you specifically want to overwrite the remote branch:

```bash
git push --force origin main
```

Do not use `--force` unless you are sure the remote branch should be replaced by this local copy.

## 5. Create the Neon database

1. Go to [https://neon.tech](https://neon.tech)
2. Create a new project
3. Choose a project name like `cash-lens`
4. Create the database

When Neon shows you the connection strings, copy both:

- the pooled connection string
- the direct connection string

Save them somewhere temporary.
You will need them later.

## 6. Create the Clerk app

1. Go to [https://clerk.com](https://clerk.com)
2. Create a new application
3. Name it `Cash Lens`
4. Keep the simplest sign-in method you want
5. Finish setup

In Clerk, copy:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Save both.

## 7. Create the Plaid app

1. Go to [https://dashboard.plaid.com](https://dashboard.plaid.com)
2. Create a new app
3. Choose Sandbox first
4. Add the `transactions` product
5. Do not add extra Plaid products unless you truly need them

Copy:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`

Also decide what your production webhook URL will be later.
For now you can leave that blank until the API is deployed.

## 8. Create the Google Cloud project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project called `cash-lens`
3. Make sure billing is enabled

Then enable these services:

- Cloud Run
- Cloud Build
- Secret Manager

You can enable them from the search bar in the Google Cloud console.

## 9. Sign into Google Cloud locally

Back in Terminal:

```bash
gcloud auth login
gcloud auth application-default login
```

Then set your project:

```bash
gcloud config set project YOUR_GCP_PROJECT_ID
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
./.venv/bin/python -m uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8000
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

## 12. Deploy the backend to Cloud Run

From Terminal:

```bash
cd /Users/yajvanravan/cashlens/apps/api
gcloud run deploy cash-lens-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

When prompted:

- choose a region such as `us-central1`
- allow unauthenticated access because the Next.js frontend will call it publicly over HTTPS

When deployment finishes, Google Cloud will show a URL like:

```txt
https://cash-lens-api-xxxxx-uc.a.run.app
```

Copy that URL.

## 13. Add backend environment variables in Cloud Run

In Google Cloud:

1. Open Cloud Run
2. Click the `cash-lens-api` service
3. Click `Edit & deploy new revision`
4. Open the environment variables section
5. Add these variables:

- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV`
- `PLAID_WEBHOOK_URL`
- `DEMO_MODE`
- `SEED_DEMO_DATA`

Use values like:

- `DATABASE_URL` = your Neon pooled URL
- `PLAID_ENV` = `sandbox` at first
- `DEMO_MODE` = `false`
- `SEED_DEMO_DATA` = `false`
- `PLAID_WEBHOOK_URL` = your final Cloud Run API webhook route, for example:
  - `https://cash-lens-api-xxxxx-uc.a.run.app/plaid/webhook`

Deploy the new revision.

## 14. Point Plaid webhook to the backend

In Plaid:

1. Open your Plaid app settings
2. Find the webhook URL field
3. Paste your Cloud Run webhook URL
4. Save changes

## 15. Deploy the frontend to Vercel

1. Go to [https://vercel.com](https://vercel.com)
2. Click `Add New Project`
3. Import the `cashlens` GitHub repo
4. Set the root directory to:

```txt
apps/web
```

5. In environment variables, add:

- `API_BASE_URL` = your Cloud Run API URL
- `NEXT_PUBLIC_API_BASE_URL` = your Cloud Run API URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = your Clerk publishable key
- `CLERK_SECRET_KEY` = your Clerk secret key

6. Click Deploy

When Vercel finishes, copy the site URL.

## 16. Set Clerk allowed URLs

In Clerk:

1. Open your application
2. Find the URLs / redirect / domains section
3. Add your Vercel production URL
4. Add your local URL too:
   - `http://127.0.0.1:3000`

This is important or Clerk sign-in can fail.

## 17. Update CORS if needed

The API already supports configurable origins.
If your deployed frontend uses a different hostname than expected, make sure the backend `allowed_origins` setting includes:

- your Vercel production URL
- `http://127.0.0.1:3000`

If needed, add:

```env
ALLOWED_ORIGINS=http://127.0.0.1:3000,https://YOUR-VERCEL-URL.vercel.app
```

to the Cloud Run service variables.

## 18. First production smoke test

After both deployments are live:

1. Open your Vercel site
2. Sign in with Clerk
3. Go to Settings
4. Click the Plaid connect button
5. Connect a sandbox bank
6. Open Dashboard, Accounts, and Transactions
7. Click manual sync
8. Edit a transaction in the review panel

If those all work, the MVP is live.

## 19. Switching from Plaid Sandbox to Plaid Production

Only do this after sandbox testing is stable.

### Backend changes

Change these environment variables in Cloud Run:

```env
PLAID_ENV=production
PLAID_CLIENT_ID=YOUR_PRODUCTION_CLIENT_ID
PLAID_SECRET=YOUR_PRODUCTION_SECRET
```

### Plaid dashboard changes

- make sure your production webhook URL is correct
- confirm the `transactions` product is enabled in production

Do not switch to production until you are comfortable with the sandbox behavior.

## 20. Common problems and exactly what they usually mean

### Problem: the website loads but shows sign-in errors

Usually means:

- Clerk keys were not added to Vercel
- Clerk redirect URLs do not include your Vercel domain
- Clerk middleware is not running because the deployment did not rebuild after env changes

What to do:

1. re-check Vercel env vars
2. re-check Clerk allowed URLs
3. trigger a redeploy in Vercel

### Problem: the website loads but account data is empty

Usually means:

- the API URL in Vercel is wrong
- the API deployment failed
- the database URL is wrong

What to do:

1. open the Cloud Run URL directly and check `/health`
2. confirm the API env vars
3. confirm the Neon URL works

### Problem: Plaid Link opens but connect fails

Usually means:

- wrong Plaid keys
- wrong environment (`sandbox` vs `production`)
- webhook or redirect config mismatch

What to do:

1. confirm `PLAID_ENV`
2. confirm client ID and secret
3. test with sandbox credentials first

### Problem: manual sync button does nothing

Usually means:

- the API request is failing
- the connected item was never stored correctly

What to do:

1. open Cloud Run logs
2. look for `/plaid/sync-item/...`
3. look for Plaid or database errors

## 21. Safe first-launch sequence

If you want the least stressful path, do it in this order:

1. run locally in demo mode
2. deploy the API
3. deploy the website
4. confirm the demo workspace works in production
5. turn on Clerk
6. test Clerk sign-in
7. turn on Plaid sandbox
8. test one sandbox institution
9. only then switch to live financial data

## 22. If you want the absolute easiest first deployment

Use the existing demo mode first.

That means:

- keep `DEMO_MODE=true`
- keep `SEED_DEMO_DATA=true`
- deploy the API
- deploy the website

This gives you a fully hosted product demo without setting up Clerk or Plaid on day one.

Then later, you can add real vendor credentials one system at a time.
