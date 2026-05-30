# Production deploy workflows and secret handoff

## Why this change exists

Cash Lens already had a staged first hosted deployment, but the repo did not yet contain a real second deployment path for production. The user also asked for a security-conscious handoff where the agent would avoid reading or inspecting any live secret values and would instead explain exactly what to gather and where to paste it.

## What changed

1. Added a manual production backend workflow:
   - `.github/workflows/deploy-api-production.yml`
   - deploys to `cash-lens-api-prod`
   - reads production values from the GitHub `production` environment
   - reads production runtime secrets from `cash-lens-prod-*` Secret Manager names

2. Added a manual production frontend workflow:
   - `.github/workflows/deploy-web-production.yml`
   - builds `apps/web` with the Vercel CLI
   - deploys to Vercel production using `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`
   - keeps production frontend release manual instead of auto-deploying from `main`

3. Rewrote the Stage 2 deployment guide sections to be explicit about:
   - which values are secrets
   - which values are plain IDs
   - exactly where each value comes from
   - exactly where each value must be pasted

4. Fixed a staging-doc mismatch:
   - Stage 1 now correctly points at GitHub environment-level secrets and variables for `staging`, matching the existing workflow behavior

5. Updated the platform ops skill:
   - it now knows about the separate production workflows
   - it includes a "secret-handoff mode" rule for future insecure-session requests

## Guardrail followed

For this change, the repo was treated as an insecure session in the sense requested by the user:

- no live secret values were read
- no local secret files were opened
- no hosted environment-variable values were inspected
- work was limited to repo code, workflow wiring, and official docs

## Validation

- YAML workflows were reviewed against the existing GitHub Actions patterns already used in the repo
- docs will be validated with `make docs-build`
- local YAML parsing was added as a syntax sanity check
