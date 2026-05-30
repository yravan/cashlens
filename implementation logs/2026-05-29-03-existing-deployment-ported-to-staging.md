# Existing deployment ported to staging

- Date: 2026-05-29
- Area: deployment workflow, live staging port, platform state

## What changed

- Reframed the existing single hosted deployment as the official Stage 1 staging environment.
- Updated `.github/workflows/deploy-api.yml` so the backend workflow is explicitly a staging deploy workflow.
- Changed the deployed backend environment target from `ENVIRONMENT=production` to `ENVIRONMENT=staging`.
- Added a backend test that keeps docs enabled in staging while preserving the production docs lockout.
- Added `.neon` to `.gitignore` because the Neon CLI now saves repo-local organization context there.
- Refreshed the platform-ops current-state reference to describe the existing hosted deployment as staging.
- Refreshed `apps/api/uv.lock` so the editable backend package version matches the repo's current `0.0.0` baseline during validation.

## Why

- The live hosted app was already behaving like staging because it used sandbox Plaid and non-production data, but it was still labeled and deployed like a single production environment.
- Before adding a second real production deployment, the current deployment needs to become an explicit staging environment in both code and infrastructure.

## Result

- Future backend deploys can target staging intentionally.
- The repo’s deployment model is now closer to the zero-to-one rollout described in the docs.
- A later Stage 2 production deployment can be added without redefining the existing hosted app again.
