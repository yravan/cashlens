---
name: cashlens-release-hygiene
description: Use when changing Cash Lens versions, release notes, documentation site setup, or changelog content, especially when a change should keep VERSION, package versions, CHANGELOG.md, and release docs in sync.
---

# Cash Lens Release Hygiene

Use this skill when release metadata changes, even if no code ships.

## Required sync points

- `VERSION`
- `CHANGELOG.md`
- `apps/api/pyproject.toml`
- `apps/web/package.json`

## Default workflow

1. Keep new unreleased work under `CHANGELOG.md` in `Unreleased`.
2. When cutting a release, bump all version files together.
3. Run `make docs-build` to verify the version-sync script and MkDocs build.
4. Update any docs page that describes the current release process if the workflow changed.
5. Add an implementation-log entry if the release or docs workflow itself changed.

## Notes

- Do not bump only one app version unless the repo intentionally moves away from a single product version.
- Prefer small, readable changelog entries over commit-message dumps.
