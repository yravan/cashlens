# Staging and production deployment guide rewrite

- Date: 2026-05-29
- Area: deployment docs, platform ops guidance, agent rules

## What changed

- Rewrote `deployment instructions.md` around a four-environment model:
  - local
  - preview
  - staging
  - production
- Changed the core assumption of the guide from:
  - one hosted environment called production
  to:
  - the current hosted deployment is staging
  - a second hardened deployment is required for real production use
- Updated `docs/deployment.md` to match the new deployment model.
- Updated the `cashlens-platform-ops` skill so future operational work uses the same language.
- Added an architecture guardrail to `AGENTS.md` that staging and production must stay separate once production exists.

## Why

- The earlier guide was accurate for a one-hosted-environment setup, but confusing for the current goal.
- The user now wants a true staging environment and a second true production environment before using personal financial data.
- Calling the current hosted deployment “production” blurred the difference between:
  - hosted testing
  - real personal-data production

## Result

- The repo documentation now matches the intended deployment strategy more honestly.
- Future infra work can build a second production deploy path without re-explaining the environment model each time.
