# Deployment Overview

Cash Lens currently uses a simple environment model:

- **Local**: day-to-day development and Plaid sandbox testing
- **Preview**: Vercel PR previews for UI review only
- **Production**: Vercel frontend plus Cloud Run backend

## Important operational truth

There is currently **one hosted backend**.

That means:

- local is where development and sandbox testing should happen
- preview is useful, but not a true hosted staging environment
- production is the only hosted backend environment

## Hosted production targets

- **Frontend**: Vercel
- **Backend**: Google Cloud Run via GitHub Actions

## Source-of-truth guide

The full non-technical walkthrough lives here:

- [`deployment instructions.md`](https://github.com/yravan/cashlens/blob/main/deployment%20instructions.md)

That guide now covers:

- the local / preview / production environment model
- local setup for demo mode and full sandbox mode
- Cloud Run backend setup
- Vercel production setup
- Clerk and Plaid production cutover
- Read the Docs setup
- changelog and versioning basics
