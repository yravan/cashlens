# Cash Lens Platform Ops Skill

## Goal

Create a repo-scoped skill so future Codex work on this project can rely more on:

- CLI checks
- repo state
- live service inspection

instead of asking the user for screenshots.

## What was added

- `.codex/skills/cashlens-platform-ops/SKILL.md`
- `.codex/skills/cashlens-platform-ops/references/current-state.md`
- `.codex/skills/cashlens-platform-ops/references/platform-playbooks.md`
- `.codex/skills/cashlens-platform-ops/scripts/check-access.sh`

## Design choices

- kept the skill repo-specific instead of generic
- made `gh`, `gcloud`, and `vercel` the first-class interfaces because those CLIs are installed here
- handled Neon and Clerk honestly:
  - no local CLI installed by default
  - prefer env/config, deployed behavior, and exact values over screenshots
- added a single access-check script so the first step is deterministic

## Important limitation

Skills can encode workflow and context, but they do not create credentials or dashboard access by themselves.

That means:

- if a CLI is already logged in, the skill helps Codex use it immediately
- if a service still requires a login or token, the skill helps Codex ask for the minimum exact thing needed instead of screenshots
