# Release skill monorepo sync

- Date: 2026-05-25
- Area: skills, versioning, release workflow

## What changed

- Updated the repo-local `cashlens-release-hygiene` skill so it now includes:
  - `package.json`
  - `packages/api-types/package.json`
  - the monorepo-specific note that the root workspace package and shared type package are part of the same product version contract

## Why

- The skill existed already, but after the root monorepo migration it still only named the older app-level version files.
- That meant future agents could follow the skill and still miss part of the new version-sync surface area.

## Result

- Future repo-aware agent sessions now have release/versioning guidance that matches the current monorepo layout.
- CI still acts as the hard enforcement layer through `scripts/check-version-sync.sh` and `make docs-build`.
