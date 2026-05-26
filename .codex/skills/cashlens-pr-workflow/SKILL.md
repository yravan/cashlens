---
name: cashlens-pr-workflow
description: Use when making code, docs, workflow, or infrastructure changes in the Cash Lens repo that should land through a branch, local validation, implementation-log update, and pull request instead of a direct push to main.
---

# Cash Lens PR Workflow

Use this skill whenever work in Cash Lens is headed toward a merge.

## Default flow

1. Work on a branch, never directly on `main`.
2. Scope the change as tightly as possible.
3. Run the smallest complete validation set that matches the change:
   - backend only: `make api-test`
   - frontend only: `make web-test`
   - cross-app or user-facing behavior: `make ci` or at minimum `make e2e`
4. Update the matching implementation log entry.
5. If the workflow changed, update an existing skill or add a new one.
6. Open or update a pull request.

## Repo-specific expectations

- Required GitHub checks are `api`, `web`, `e2e`, and `docs`.
- The PR template is part of the workflow; fill in validation and risk notes.
- Do not bypass failing checks by weakening assertions without documenting why.

## When to widen the validation set

- Run `make e2e` for auth, Plaid, proxy, navigation, or transaction-editing changes.
- Run both app suites for changes in shared types, runtime config, or deployment wiring.
- For GitHub Actions changes, validate the nearest local equivalent and then inspect the workflow file carefully before pushing.
