---
name: cashlens-neon-ops
description: Use when working in the Cash Lens repo on Neon database tasks such as project inspection, branch and connection-string checks, database access validation, or backend database configuration. Prefer the Neon CLI and repo config before asking for dashboard screenshots.
---

# Cash Lens Neon Ops

Use this skill for Cash Lens Neon work.

## Start here

1. Run `neon me` to confirm auth.
2. Read [references/current-neon-state.md](references/current-neon-state.md).
3. If the task involves app connectivity, compare Neon state against:
   - `apps/api/.env`
   - Secret Manager mapping in `deployment instructions.md`

## Default workflow

- Prefer the Neon CLI first.
- Use exact connection-string and project/branch state rather than screenshots.
- Cross-check backend errors with the configured `DATABASE_URL`.

## High-value commands

```bash
neon me
neon projects list
neon branches list
neon connection-string
neon databases list
neon roles list
```

## Typical tasks

- confirm the intended Neon project
- verify the active branch and connection string
- verify whether backend failures are due to bad credentials, wrong branch, or IP/VPC restrictions
- compare hosted secret values against local env configuration

## When to escalate to the user

- before changing production branch/database settings with non-obvious consequences
- when multiple Neon projects exist and the intended target is unclear
