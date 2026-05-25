# Implementation Log 01: Repo Foundation

## Objective

Create a greenfield monorepo skeleton from an almost-empty git repo while reusing official starters wherever that reduced custom work.

## Actions taken

1. Confirmed the repo only contained `.git` and no existing application code.
2. Read the planning sources:
   - `deep-research-report.md`
   - `cash_lens_mvp_spec.md`
   - `Cash Lens Architecture Roadmap.pdf`
3. Chose a two-app structure:
   - `apps/web`
   - `apps/api`
4. Used the official Next.js starter for the frontend.
5. Used `uv init` for the Python backend so the backend package manager matched the requested toolchain.

## Why this structure

- It aligns with the research recommendation.
- It isolates frontend and backend deploy concerns.
- It leaves room for `packages/api-types` and infra/docs without overcomplicating the MVP.

## Tooling choices

- Frontend package manager: `pnpm`
- Backend package manager: `uv`
- Python runtime environment: `apps/api/.venv`
- Shared repo docs at root

## Early issues encountered

- Shell globbing around route group folder names like `(app)` and `[...path]`
- network restrictions while scaffolding the Next.js starter
- `uv` cache writes pointing outside the writable sandbox

## Resolutions

- quoted route-group paths in shell commands
- requested the minimum escalation needed for package downloads
- redirected `uv` cache to `/private/tmp/uv-cache`
