# GCloud And Neon Skills

## Goal

Add repo-local Cash Lens skills for Google Cloud and Neon so future Codex work can use narrower, service-specific guidance instead of overloading the broader platform ops skill.

## What was added

- `.codex/skills/cashlens-gcloud-ops/`
- `.codex/skills/cashlens-neon-ops/`

## Why this approach

- no clean installable `gcloud` skill was visible in the current active catalog
- a Neon-related plugin bundle existed on disk, but not as an active session skill
- repo-local skills are deterministic and immediately useful for this codebase

## Scope

- `cashlens-gcloud-ops`
  - Cloud Run deploys
  - IAM and build service account debugging
  - runtime inspection
- `cashlens-neon-ops`
  - Neon CLI workflows
  - project/branch/connection-string validation
  - database configuration checks against app env and hosted secrets
