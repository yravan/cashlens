# Deployment Overview

Cash Lens should now be thought about as four environments:

- **Local**: day-to-day development and Plaid sandbox testing
- **Preview**: Vercel PR previews for quick frontend review
- **Staging**: the current hosted deployment you already have
- **Production**: a second, separate hardened deployment for real financial data

## Important operational truth

The repo currently has one hosted deploy path in `.github/workflows/deploy-api.yml`.

For now, treat that hosted path as **staging**.

The production environment in this model is **not** “the same deployment with flipped secrets.” It should become:

- a second Cloud Run service
- a second Vercel project
- a second database
- a second secret set
- Clerk production
- Plaid production

## Safe environment usage

- use **local** for implementation work
- use **preview** for UI review
- use **staging** for hosted non-production testing
- use **production** only after it is fully separated and hardened

## Source-of-truth guide

The full walkthrough lives here:

- [`deployment instructions.md`](https://github.com/yravan/cashlens/blob/main/deployment%20instructions.md)

That guide now covers:

- local / preview / staging / production
- how to reinterpret the existing deployment as staging
- what must be separate before production holds personal data
- the second-deployment production rollout path
- docs hosting, versioning, and troubleshooting
