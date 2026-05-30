# Contributing

Cash Lens now uses a branch-first, PR-first workflow.

## Default loop

1. Create a branch from `main`.
2. Make the smallest coherent change you can.
3. Run the relevant validation commands.
4. Update docs, implementation logs, and repo skills when the workflow changes.
5. Open a pull request.
6. Merge only after the required checks pass.

## Validation commands

```bash
make api-test
make web-test
make e2e
make docs-build
```

## Important habits

- Avoid direct pushes to `main`.
- Prefer behavior-based tests over layout-based tests.
- Treat `CHANGELOG.md` and `VERSION` as part of the release workflow.
- Use the repo root as the JavaScript workspace entrypoint; avoid treating `apps/web` like a standalone package root.
- If a workflow repeats, capture it in `.codex/skills/` and note that capture in `implementation logs/`.
