# CLI Access Verified

## Goal

Verify that the machine now has real CLI access for the main hosted services and record that state inside the Cash Lens platform ops skill.

## Verified access

- Vercel CLI
  - installed
  - authenticated as `yravan`
  - can list the `cashlens` project
- Neon CLI
  - installed
  - authenticated as `yajvanravan@gmail.com`
- Clerk CLI
  - installed
  - authenticated
  - linked to the `Cash Lens` application
  - linked development instance present
  - production instance not created yet

## Skill updates

- updated `references/current-state.md` with the verified CLI baseline
- updated `references/platform-playbooks.md` so Neon and Clerk are treated as active CLI surfaces instead of dashboard-only fallbacks
- updated `scripts/check-access.sh` to verify:
  - Vercel auth and visible projects
  - Neon auth
  - Clerk auth and linked app state

## Why this matters

Future Codex work in this repo can now default much more aggressively to:

- `vercel`
- `neon`
- `clerk`

instead of asking the user for screenshots or UI navigation help.
