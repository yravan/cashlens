---
name: cashlens-platform-ops
description: Use when working in the Cash Lens repo on deployments, auth, hosting, or third-party integrations involving GitHub, Google Cloud Run, Vercel, Neon, Clerk, or Plaid. Start by running `scripts/check-access.sh` to see which CLIs and credentials are available. Prefer CLI-first investigation with `gh`, `gcloud`, and `vercel`, use repo config and live service endpoints before asking the user for screenshots, and ask for exact values or login/token setup when Neon or Clerk dashboard-only state is needed.
---

# Cash Lens Platform Ops

This is the repo-specific operations skill for Cash Lens.

## Start here

1. Run `scripts/check-access.sh`.
2. Read [references/current-state.md](references/current-state.md) for the current repo and platform map.
3. Read [references/platform-playbooks.md](references/platform-playbooks.md) for the service you are touching.

## Working rules

- Prefer CLI and API verification over screenshots.
- Use exact repo files, workflow logs, deployed service URLs, and shell output first.
- For GitHub, Google Cloud, and Vercel, assume the CLI is the primary interface.
- For Neon and Clerk, first use repo env/config, deployed behavior, and official docs.
- If Neon or Clerk dashboard-only state is required and no CLI/API token is available, ask for one of:
  - a CLI login
  - an API token
  - the exact value to enter or read back
- Do not ask for screenshots unless there is no better path.

## Repo-specific priorities

- Backend deploy source of truth: `.github/workflows/deploy-api.yml`
- Frontend deploy source of truth: Vercel project for `apps/web`
- Backend runtime: Cloud Run
- Backend package manager: `uv`
- Local and hosted setup guide: `deployment instructions.md`
- Historical context: `implementation logs/`

## Common workflows

### Deploy triage

- Check `gh run list --workflow deploy-api.yml --limit 5`
- Inspect the failing run with `gh run view <run-id> --log-failed`
- For Cloud Run source deploy permission issues, verify the current default build service account with:
  - `gcloud builds get-default-service-account --project "$PROJECT_ID"`

### Frontend deploy triage

- Check Vercel deployment status first
- Confirm the production deployment is on the expected commit
- Verify whether the deployed HTML is using development or production Clerk keys when auth behavior is suspicious

### Auth or integration triage

- For Clerk issues, check:
  - `apps/web/lib/runtime.ts`
  - `apps/web/proxy.ts`
  - `apps/web/lib/session.ts`
- For Plaid issues, check:
  - `apps/api/src/cash_lens_api/routers/plaid.py`
  - `apps/api/src/cash_lens_api/services/plaid.py`
  - Cloud Run request logs

## When to re-read references

- Read [references/platform-playbooks.md](references/platform-playbooks.md) when switching services.
- Read [references/current-state.md](references/current-state.md) when you need exact project names, service names, or file paths.
