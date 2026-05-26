# Deployment Guide Structure Cleanup

## What changed

The deployment guide was reorganized after the middle of the document became too fragmented around Google Cloud setup.

## Why this was changed

The user wanted:

- the Google Cloud setup compressed into one coherent section
- the downstream hosted-app steps preserved as their own sections
- the Vercel, Clerk, Plaid, and production smoke-test instructions easy to find again

## Implementation details

- collapsed the many small Google Cloud / GitHub Actions setup steps into one section with labeled subsections:
  - project values
  - API enablement
  - service accounts
  - IAM permissions
  - Workload Identity
  - Secret Manager
  - GitHub Actions secrets and variables
- kept the post-backend-deploy flow separate and visible:
  - first backend deploy
  - webhook updates
  - Vercel deployment
  - Clerk allowed URLs
  - production smoke test
  - Plaid production switch
  - troubleshooting

## Result

The guide now reads in three clearer phases:

1. local setup
2. one-time backend deployment infrastructure setup
3. hosted app rollout and post-deploy validation
