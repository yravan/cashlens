# Versioning and Releases

Cash Lens uses a simple repository-wide versioning scheme.

## Source of truth

- Root version file: `VERSION`
- Root JavaScript workspace package: `package.json`
- Human-readable release notes: `CHANGELOG.md`
- App package versions that should stay aligned:
  - `apps/api/pyproject.toml`
  - `apps/web/package.json`
  - `packages/api-types/package.json`

## Current policy

- Use Semantic Versioning for product-facing releases.
- Keep an `Unreleased` section at the top of `CHANGELOG.md`.
- When cutting a release, move the shipped entries from `Unreleased` into a dated release section.

## Release checklist

1. Update `VERSION`.
2. Update `package.json` version.
3. Update `apps/api/pyproject.toml` version.
4. Update `apps/web/package.json` version.
5. Update `packages/api-types/package.json` version.
6. Move the relevant notes from `CHANGELOG.md` `Unreleased` into a new release section.
7. Run `make docs-build` to confirm version sync and docs validity.
8. Tag the release in Git when you are ready to publish that version.

## Automation guardrail

The repo includes `scripts/check-version-sync.sh`, and the `docs` CI job runs it. If one version is bumped without the others, CI should fail before merge.
