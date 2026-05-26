# Deployment Overview

Cash Lens has two production deployment targets:

- **Frontend**: Vercel
- **Backend**: Google Cloud Run via GitHub Actions

## Source-of-truth guide

The detailed non-technical deployment walkthrough lives in the repository file below:

- [`deployment instructions.md`](https://github.com/yravan/cashlens/blob/main/deployment%20instructions.md)

That guide covers:

- GitHub setup
- Neon database setup
- Clerk setup
- Plaid setup
- Google Cloud and Cloud Run setup
- Vercel deployment
- frontend and backend environment variables
- production smoke testing
- Read the Docs setup for documentation hosting

## Operational expectation

- `main` should stay deployable.
- Backend deploys are triggered from GitHub, not from an individual laptop.
- Frontend deploys come from Vercel’s Git integration.
- Documentation builds should stay green in CI before enabling Read the Docs on the repo.
