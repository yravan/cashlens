# GitHub PR Guardrails

## What changed

Applied GitHub-side protections to `main`:

- required status checks:
  - `api`
  - `web`
  - `e2e`
- strict status checks enabled
- pull requests required for `main`
- required approving review count set to `0`
- stale reviews dismissed on new pushes
- conversation resolution required
- force-pushes disabled
- branch deletions disabled
- admin enforcement enabled
- automatic branch deletion after merge enabled at the repo level

## Why the review count is zero

Cash Lens is currently a solo-maintainer repo. Requiring a second human approval would block all merges. The protection therefore enforces PRs and checks without pretending there is already a two-person review system.

## Operational effect

- Direct pushes to `main` are blocked, including for admins.
- The new CI workflow is now the gate for merges.
- Feature work should land through branches and PRs from this point onward.
