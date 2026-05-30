# Repo Workflow Foundation

## What changed

- Added repo-level `AGENTS.md` and `CLAUDE.md`.
- Added `CODEOWNERS`, PR template, issue templates, and Dependabot config.
- Added repo engineering docs for testing strategy and pull-request workflow.
- Added a root `Makefile` with canonical validation commands.
- Added new repo-native skills:
  - `cashlens-pr-workflow`
  - `cashlens-testing-playbook`
  - `cashlens-db-evolution`
  - `cashlens-skill-capture`

## Why

The repo previously had no durable contribution workflow. Changes depended on chat context and one-off memory, which does not scale once multiple features, migrations, and integrations start landing.

## Important design decisions

- `main` is now treated as merge-only by convention before GitHub protections are applied.
- The repo skill set captures the recurring workflows instead of burying them inside docs alone.
- The “capture the capture” rule is explicit: when a workflow repeats or changes, the skill itself must be updated and that update must be logged.

## Long-term impact

Future Codex or Claude sessions should have a stable default workflow even when the product surface expands well beyond the MVP.
