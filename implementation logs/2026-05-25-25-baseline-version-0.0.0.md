# Baseline version 0.0.0

- Date: 2026-05-25
- Area: release metadata, changelog, version sync

## What changed

- Set the repo-wide product version to `0.0.0`.
- Updated all required sync points:
  - `VERSION`
  - root `package.json`
  - `apps/web/package.json`
  - `packages/api-types/package.json`
  - `apps/api/pyproject.toml`
- Updated surfaced backend version strings in:
  - `apps/api/src/cash_lens_api/__init__.py`
  - `apps/api/src/cash_lens_api/main.py`
- Rewrote the changelog so the current repository state is captured as the initial `0.0.0` release, leaving `Unreleased` empty for future work.
- Updated `docs/changelog.md` to reflect the new current repo version.

## Why

- The repo had already accumulated MVP functionality plus engineering foundations, but the requested baseline version for the current state is `0.0.0`.
- Keeping one coherent initial release is cleaner than preserving a higher historical version and then moving backward.

## Result

- Version metadata is aligned across the monorepo again.
- Future work can accumulate under `Unreleased` on top of a clear `0.0.0` baseline.
