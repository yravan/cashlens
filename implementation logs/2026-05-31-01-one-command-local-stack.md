# One-command local stack (PLT-1.1)

- Date: 2026-05-31
- Area: local developer workflow, infra, docs
- Leaf: PLT-1.1 — One-command local stack (size M, layer infra)

## Acceptance

`make dev` brings up api + web + Postgres in demo mode with one command, and the
backend `/health` endpoint goes green within 60s, proven by a smoke script.

## What changed

- Added `docker-compose.yml` providing local Postgres (`postgres:16-alpine`) with
  credentials/db that match the backend's default local `DATABASE_URL`
  (`postgresql+psycopg2://cashlens:cashlens@127.0.0.1:5432/cashlens`).
- Added `scripts/dev-stack.sh`: orchestrates Postgres (docker compose) + FastAPI
  (`uv`, port 8000) + Next.js dev server (`pnpm`, port 3000) in demo mode, and
  tears all three down together on exit. Exits with a clear message if the
  Docker daemon is unavailable.
- Added `scripts/dev-smoke.sh`: polls `/health` until it returns a healthy
  status, failing after a 60s budget (configurable). In managed mode
  (`CASHLENS_SMOKE_MANAGE_STACK=1`) it brings the stack up/down itself and skips
  gracefully (exit 0) when Docker is unavailable, so it stays CI-safe.
- Added `make dev` and `make dev-smoke` targets (with `api-bootstrap` +
  `web-install` deps on `dev`).
- Added `docs/local-stack.md` (wired into `mkdocs.yml` nav) and a README
  "One-command local stack" section.

## Why

- New contributors needed a single command to run the whole stack locally
  against real Postgres, with an executable health proof.

## Cross-cutting (obs)

- The backend continues to emit/observe `http.server.duration` via existing
  middleware; no backend application code was touched, so this is not regressed.

## Validation

- `make docs-build` — version sync passed (`0.0.0`); mkdocs `--strict` build
  succeeded including the new `local-stack.md` page.
- `make api-test` — ruff clean; 9 pytest tests passed (no backend regression).
- `make -n dev` / `make -n dev-smoke` — dry-runs show expected recipes.
- `scripts/dev-smoke.sh` exercised three ways without Docker:
  - green path against a stub `/health` returning `{"status":"ok"}` → exit 0.
  - fail path (nothing listening, short timeout) → exit 1.
  - managed mode with Docker daemon down → graceful SKIP, exit 0.
- Docker daemon was NOT running in this environment, so a live `make dev` +
  `make dev-smoke` run was not executed here; the smoke script's polling and
  skip behavior were verified independently as above. Reviewers with Docker can
  run `make dev` then `make dev-smoke` (or `CASHLENS_SMOKE_MANAGE_STACK=1 make
  dev-smoke`) to see `/health` go green end-to-end.

## Risk / assumptions

- Requires a running Docker daemon for Postgres; documented in README and
  `docs/local-stack.md`. Without Docker, `make dev` exits with a clear message.
- Assumes the backend reads `DATABASE_URL` (it does, via pydantic Settings with
  `psycopg2` already a dependency). Compose credentials must stay in sync with
  the default `DATABASE_URL`; this coupling is documented in both files.
