# Cash Lens Pull Request Workflow

This repo is set up for branch-first development.

## Standard flow

1. Create a branch from `main`.
2. Make the smallest coherent change you can.
3. Run the relevant local checks:
   - `make api-test`
   - `make web-test`
   - `make e2e` for user-facing or full-stack changes
   - `make docs-build` when docs, versions, or release notes changed
4. Update implementation logs and any affected repo skills.
5. Open a pull request.
6. Merge only after the required GitHub checks pass.

## Why this matters

- `main` should stay deployable.
- Required checks map directly to the repo’s real safety nets: `api`, `web`, `e2e`, and `docs`.
- PRs preserve context for design choices, rollout concerns, and future debugging.
- The root workspace keeps JavaScript dependency management, shared packages, and lockfile changes visible in one place.

## Skill capture rule

If a workflow repeats, is easy to forget, or caused avoidable confusion:

1. Update an existing skill or add a new one in `.codex/skills/`.
2. Mention that change in the implementation log for the same task.
3. If the workflow also matters to Claude or humans, reflect it in `AGENTS.md` or the relevant engineering doc.

## Future feature guidance

- Schema or migration work should call out rollout order and rollback assumptions.
- External integrations should name the exact environments touched.
- LLM or classification changes should document their invariants and fallback behavior in the PR description.
- Release-oriented work should keep `VERSION`, `CHANGELOG.md`, and surfaced package versions in sync.
