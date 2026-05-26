# Docs and Release Governance

## What changed

- Added MkDocs configuration in `mkdocs.yml`.
- Added Read the Docs configuration in `.readthedocs.yaml`.
- Added documentation requirements in `docs/requirements.txt`.
- Added top-level docs pages for architecture, deployment, contributing, versioning, and changelog guidance.
- Added root `CHANGELOG.md` and `VERSION`.
- Added `scripts/check-version-sync.sh`.
- Added a `docs` CI job that validates version sync and runs a strict MkDocs build.
- Added a repo skill for release hygiene.
- Updated the non-technical deployment guide with Read the Docs setup and release-note/versioning instructions.

## Why

The repo had good implementation notes, but not a durable public-facing documentation system or a canonical release-history workflow. That would become painful as the codebase and team habits grow.

## Key decisions

- Read the Docs uses the top-level `.readthedocs.yaml` and `mkdocs.yml` files instead of a custom docs pipeline.
- `CHANGELOG.md` and `VERSION` are the repo-wide release source of truth.
- CI now checks both docs validity and cross-file version consistency before merge.

## Validation

- `bash ./scripts/check-version-sync.sh`
- `uv run --with-requirements docs/requirements.txt mkdocs build --strict`
