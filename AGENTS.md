# Cash Lens Agent Guide

This repo uses pull-request-first development and keeps repeated workflows in repo-native skills.

## Core rules

- Never push directly to `main`. Work on a branch, run the relevant validation commands, and merge through a pull request.
- When working in `apps/web`, also follow [apps/web/AGENTS.md](/Users/yajvanravan/cashlens/apps/web/AGENTS.md).
- Keep implementation logs current in [implementation logs](/Users/yajvanravan/cashlens/implementation%20logs) whenever a change meaningfully alters architecture, deployment, testing, or developer workflow.
- If a workflow repeats twice or a new repo-specific habit emerges, update an existing skill or add a new one under [/.codex/skills](/Users/yajvanravan/cashlens/.codex/skills), then note that update in the implementation log. This capture rule is itself a standing workflow requirement.

## Validation expectations

- Backend: `make api-test`
- Frontend unit/type/lint: `make web-test`
- Browser smoke: `make e2e`
- Docs and version sync: `make docs-build`
- Full stack before merge when touching cross-app flows: `make ci`

## Testing philosophy

- Favor user outcomes and domain invariants over layout specifics.
- Prefer semantic selectors and stable labels. Use a small number of `data-testid` attributes only for user-critical controls whose copy may change.
- For future database, backfill, dedup, or LLM work, add idempotency and migration-safe tests rather than relying on snapshots.

## Long-term architecture guardrails

- Backend package management stays on `uv`.
- New CI checks should map cleanly to branch-protection required checks.
- Production auth and secret handling must stay server-verified; do not reintroduce spoofable header-based identity.
- Release work should update `VERSION`, `CHANGELOG.md`, and any surfaced app package versions together.
