# Root monorepo workspace

- Date: 2026-05-25
- Area: developer workflow, workspace layout, CI

## What changed

- Added a root `package.json`, `pnpm-workspace.yaml`, and root-managed `pnpm-lock.yaml` workflow for the JavaScript side of the repo.
- Promoted `packages/api-types` into a real workspace package and wired the web app to consume it as `@cashlens/api-types`.
- Moved `pnpm` install, lint, typecheck, build, and e2e entrypoints to the repo root and updated the Makefile and GitHub Actions workflow to use that root workspace.
- Updated docs, deployment instructions, version-sync checks, CODEOWNERS, and agent guidance to treat the root as the canonical JavaScript workspace entrypoint.
- Added an app-local `apps/web/vercel.json` install command override so Vercel keeps working with the root pnpm workspace and pnpm's ignored-build policy.
- Removed the non-portable `trust-lockfile` install flag so the same workspace install command works across local pnpm, GitHub Actions, and Vercel.

## Why

- The repo had already grown into a polyglot monorepo shape, but the JavaScript workspace still behaved like a standalone app living under `apps/web`.
- That split made shared packages like `packages/api-types` feel unofficial and made the lockfile, workspace settings, and install commands harder to reason about.
- A root-managed workspace gives one place for JavaScript dependency updates, lockfile review, and future package growth without interfering with the Python `uv` backend workflow.

## Follow-on expectations

- Future TypeScript packages should live under `packages/` and join the root workspace instead of inventing local lockfiles.
- Root `pnpm` commands or `make` targets should be preferred over ad hoc installs inside `apps/web`.
- Release work now needs to keep `VERSION`, the root `package.json`, `apps/web/package.json`, `packages/api-types/package.json`, and `apps/api/pyproject.toml` aligned.
