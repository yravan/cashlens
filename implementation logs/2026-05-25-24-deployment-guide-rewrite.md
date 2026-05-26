# Deployment guide rewrite

- Date: 2026-05-25
- Area: deployment docs, environment model, skills

## What changed

- Rewrote `deployment instructions.md` from a long chronological setup log into an environment-based guide.
- Organized the guide around:
  - local development
  - preview deployments
  - production deployment
  - docs hosting
  - release basics
  - troubleshooting
- Added a clear warning that the repo currently has one hosted backend, so Vercel previews are not a true staging environment.
- Updated `docs/deployment.md` to match the new environment model.

## Why

- The previous deployment guide had become hard to follow because new sections were appended over time.
- The most important operational truth for this repo is not “what order we discovered things in,” but “which environment is safe for which kind of work.”
- This rewrite makes the intended workflow explicit:
  - local for dev and sandbox
  - preview for UI review
  - production for the real app

## Result

- Future setup work should be easier to follow for non-technical users.
- The guide now matches the repo’s actual architecture and current operational expectations.
