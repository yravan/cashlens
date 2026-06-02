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

## Revision — 2026-06-01 (review fixes)

PR #22 review found `make dev` failed on machines that already run a Postgres on
5432 (raw `port is already allocated`, plus a teardown trap that stopped a
container the user already had) and was confusing when 8000/3000 were busy.
Revised to make the stack robust and warm-reusable, without touching app code.

### What changed

- Added `scripts/dev-lib.sh`: pure, injectable-probe helpers — `port_is_free`,
  `find_free_port` (scan upward), `db_url_port`, `db_url_with_port`, and
  `decide_postgres_provisioning` (reuse-server | reuse-container |
  create-container <port>). Logic is split out so it is unit-testable without
  Docker via `*_PROBE` indirection.
- Added `scripts/dev-lib.test.sh` (+ `make dev-stack-test`): 13 deterministic,
  CI-safe unit tests (no Docker/live ports) covering free-port selection, URL
  port rewrite, and all provisioning-decision branches incl. the
  Homebrew-on-5432 alt-port case.
- Rewrote `scripts/dev-stack.sh`:
  - Postgres: reuse a cashlens-usable server at `DATABASE_URL` (psql probe) →
    else start/reuse the warm `cashlens-postgres` container → else compose-create
    it; if 5432 is held by another Postgres, create on the next free host port
    (via new `CASHLENS_PG_HOST_PORT` in `docker-compose.yml`) and rewrite
    `DATABASE_URL` to match, printing the port.
  - Teardown keeps Postgres warm: Ctrl-C stops only api/web; the cleanup trap is
    armed only AFTER a successful start (so a failed startup can't stop the
    user's pre-existing container). Children run under job-control (`set -m`) and
    are killed by process group so uvicorn/next grandchildren don't leak.
  - api/web port fallback: scan upward from `API_PORT`/`WEB_PORT`, print actual
    ports, point web's `API_BASE_URL` at the actual api port, and write a small
    `.dev-stack.runtime` file with the actual ports/health URL.
  - Removed the bash-4.3 `wait -n` dependency — replaced with a portable poll
    loop that runs on macOS system bash 3.2.
- Added `scripts/dev-down.sh` + `make dev-down`: stop/remove the cashlens
  Postgres container for a clean slate (keeps the data volume unless
  `--volumes`/`CASHLENS_DOWN_VOLUMES=1`).
- `scripts/dev-smoke.sh` now resolves the health URL from `.dev-stack.runtime`
  (actual api port) instead of hardcoding 8000, and tears down via process-group
  kill + `dev-down.sh` in managed mode.
- Docs/README updated for reuse/keep-warm, host-port + api/web port fallback, and
  `make dev-down`.

### Corrected observability note

The earlier "Cross-cutting (obs)" claim that the backend "emits/observes
`http.server.duration`" is **inaccurate** — verified against `apps/api/src`: the
only middleware is CORS and there is no metrics/OpenTelemetry instrumentation. No
such metric exists today. The obs constraint for this leaf holds only because the
local stack touches no application code (it neither adds nor removes
instrumentation). `docs/local-stack.md` was corrected to state this accurately.

### Validation (2026-06-01)

- `make dev-stack-test` — 13 passed, 0 failed under system bash 3.2.
- `make api-test` — ruff clean; 9 pytest passed (no backend regression).
- `make docs-build` — version sync passed (`0.0.0`); mkdocs `--strict` built.
- `make -n dev` / `make -n dev-down` — expected recipes.
- `scripts/dev-smoke.sh` green (stub `/health` → exit 0), fail (nothing
  listening → exit 1), skip (managed mode, Docker down → exit 0); runtime-file
  health-URL resolution verified (actual port and default fallback).
- Real-probe verification on the maintainer-like machine (Homebrew
  `postgresql@16` on 5432, Docker daemon down): `pg_server_is_usable` correctly
  reports NOT usable (no `cashlens` role), `port_is_free 5432` → BUSY, and
  `decide_postgres_provisioning` returns `create-container 5433` — i.e. it falls
  back to an alt port instead of the old raw bind error.
- Docker daemon was unavailable in this environment, so a full live `make dev`
  was not run; the new logic is proven by the CI-safe unit tests plus the
  real-probe checks above. Reviewers with Docker can run `make dev` (warm reuse
  on a second run) and `make dev-smoke`.
