# GitHub-Based Backend Deployment Flow

## Goal

Stop deploying the backend from an arbitrary local machine state and switch to a commit-based deployment path driven by GitHub Actions.

## Problems addressed

1. Local `gcloud run deploy --source .` pushes whatever happens to be on disk, which is harder to audit and reproduce.
2. Local `.env` files were not ignored at the repo root, which created a real risk of secret leakage.
3. Runtime secrets were being described as manual Cloud Run variables rather than being managed through a safer secret store.

## Changes made

### Secret hygiene

- Added repo-wide ignore rules for:
  - `.env`
  - `.env.local`
  - `.env.*`
- Added ignore rules for temporary GitHub auth credentials:
  - `gha-creds-*.json`

### Backend build path

- Added `apps/api/Dockerfile`
- Added `apps/api/.dockerignore`
- Added `apps/api/.gcloudignore`

The container build uses `uv` directly so the production container path matches the project requirement that the Python backend use `uv` as the package manager.

### CI/CD

- Added `.github/workflows/deploy-api.yml`

This workflow:

- runs on pushes to `main` when backend files change
- also supports manual `workflow_dispatch`
- authenticates to Google Cloud through Workload Identity Federation
- deploys `apps/api` to Cloud Run from source
- injects runtime configuration from GitHub Actions variables and Secret Manager references

## Why Secret Manager is used here

GitHub Actions should control deployment, but application secrets should not live in GitHub if Google Cloud already has a first-class secret store for the running service.

This split keeps:

- deployment identity in GitHub Actions
- application runtime secrets in Google Secret Manager
- final secret injection in Cloud Run

## Operational result

After the one-time Google Cloud and GitHub setup, future backend deploys happen from committed code by pushing to `main`, instead of from a local terminal session.
