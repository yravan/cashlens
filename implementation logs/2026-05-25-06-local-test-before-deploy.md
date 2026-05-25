# Local Test Before Deploy

## Goal

Run the step-11 local verification flow before deployment and capture what works, what fails, and what that means operationally.

## Environment used

- backend package manager: `uv`
- backend local config: one run with the real Postgres-oriented `.env`, one temporary smoke run with demo-mode overrides
- frontend local config: one run with the current Clerk-enabled `.env.local`, one temporary smoke run with Clerk disabled via process-level overrides only

## Real-config results

### Backend

Using the current backend `.env`:

- `uv sync` completed successfully after adding the missing Postgres driver dependency
- `uv run uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8000` started cleanly
- `GET /health` returned `200`
- `GET /dashboard` with a synthetic authenticated header set returned `200`

Interpretation:

- the API can boot against the configured Neon database
- the dashboard route works when valid auth headers are present

### Frontend

Using the current Clerk-enabled `.env.local`:

- Next.js dev server started successfully on port `3000`
- static asset requests such as `/favicon.ico` returned `200`
- the login route did not return within the test timeout window

Interpretation:

- the frontend server itself is healthy
- the hanging behavior is specific to the Clerk-enabled request/render path, not to Next.js startup or port binding

## Temporary end-to-end smoke run

To confirm the full product stack still works locally independent of the Clerk issue, a temporary smoke stack was started without changing checked-in env files:

- backend on `127.0.0.1:8001` with:
  - `DEMO_MODE=true`
  - `SEED_DEMO_DATA=true`
- frontend on `127.0.0.1:3000` with:
  - `API_BASE_URL=http://127.0.0.1:8001`
  - `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8001`
  - Clerk env vars blanked at process launch

Results:

- frontend `/dashboard` responded successfully
- rendered dashboard HTML contained:
  - `Demo-ready`
  - `Total cash`
  - `True spend`
  - `Accounts snapshot`
- in-app browser verification succeeded and showed the seeded dashboard UI

## What this means

The application is locally valid as a full stack system. The remaining pre-deploy blocker is not the core app implementation; it is the current Clerk-enabled local auth path.

## Recommended next step

Resolve the Clerk local-render issue before treating the production-style local test as fully green. If needed, deployment can still proceed for the backend independently because the API boot path and Postgres connectivity are confirmed.
