# Deployment Overview

Cash Lens now documents deployment as a **two-stage hosted rollout**:

1. **First deployment** = staging
2. **Second deployment** = production

The supporting environments are:

- **Local**: day-to-day development and Plaid sandbox testing
- **Preview**: Vercel PR previews for quick frontend review
- **Staging**: the first hosted deployment
- **Production**: the second, separate hardened deployment

## Core idea

The first hosted deployment should be safe for:

- sandbox Plaid testing
- hosted QA
- deployment validation

The second hosted deployment should be the environment for:

- Clerk production
- Plaid production
- real personal financial data

Those two hosted environments should not share secrets or a database.

## Source-of-truth guide

The full walkthrough lives here:

- [`deployment instructions.md`](https://github.com/yravan/cashlens/blob/main/deployment%20instructions.md)

That guide now walks through:

- Stage 0 local setup
- Stage 1 first deployment as staging
- Stage 2 second deployment as production
- the manual production backend workflow in `.github/workflows/deploy-api-production.yml`
- the manual production frontend workflow in `.github/workflows/deploy-web-production.yml`
- docs hosting, versioning, and troubleshooting
