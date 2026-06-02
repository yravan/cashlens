#!/usr/bin/env bash
#
# dev-stack.sh — one-command local stack for Cash Lens (PLT-1.1).
#
# Brings up, in demo mode:
#   1. Postgres — reused if a cashlens-usable server already answers at
#      DATABASE_URL; else the warm `cashlens-postgres` container is reused;
#      else a fresh container is created (on the next free port if 5432 is
#      held by some other Postgres, e.g. a Homebrew install).
#   2. The FastAPI backend (uv), pointed at that Postgres.
#   3. The Next.js dev server (pnpm), pointed at the actual api port.
#
# On Ctrl-C the api/web process groups are stopped but Postgres is left
# running (warm between runs). `make dev-down` removes the container for a
# clean slate. This reuses the run patterns in README "Local development".
#
# If the Docker daemon is unavailable AND no usable Postgres is already
# reachable, this exits with a clear, actionable message.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/dev-lib.sh
. "$REPO_ROOT/scripts/dev-lib.sh"

export DATABASE_URL="${DATABASE_URL:-postgresql+psycopg2://cashlens:cashlens@127.0.0.1:5432/cashlens}"
export DEMO_MODE="${DEMO_MODE:-true}"
export SEED_DEMO_DATA="${SEED_DEMO_DATA:-true}"
export ENVIRONMENT="${ENVIRONMENT:-development}"
UV_CACHE_DIR="${UV_CACHE_DIR:-/private/tmp/uv-cache}"
export UV_CACHE_DIR

API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8000}"
WEB_HOST="${WEB_HOST:-127.0.0.1}"
WEB_PORT="${WEB_PORT:-3000}"

CONTAINER_NAME="cashlens-postgres"
RUNTIME_FILE="${CASHLENS_RUNTIME_FILE:-$REPO_ROOT/.dev-stack.runtime}"

log() { printf '[dev-stack] %s\n' "$*"; }

# --- real probes used by decide_postgres_provisioning -----------------------

# Build a libpq URL (psql understands no SQLAlchemy "+driver") from DATABASE_URL.
psql_url() { printf '%s\n' "$DATABASE_URL" | sed -E 's#^postgresql\+[a-z0-9]+://#postgresql://#'; }

# Exit 0 if a cashlens-usable Postgres answers at DATABASE_URL (connect + the
# cashlens db/role work). Requires psql; without it we cannot prove usability,
# so we conservatively report "not usable".
pg_server_is_usable() {
  command -v psql >/dev/null 2>&1 || return 1
  PGCONNECT_TIMEOUT=3 psql "$(psql_url)" -tAc 'select 1' >/dev/null 2>&1
}

# Exit 0 if the cashlens-postgres container exists (running or stopped).
pg_container_exists() {
  docker ps -a --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}' 2>/dev/null \
    | grep -q "^${CONTAINER_NAME}$"
}

# --- Postgres provisioning ---------------------------------------------------

POSTGRES_STARTED_CONTAINER=0
ensure_postgres() {
  if pg_server_is_usable; then
    log "reusing existing cashlens-usable Postgres at DATABASE_URL (no container)."
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    log "ERROR: no cashlens-usable Postgres at DATABASE_URL and Docker is unavailable."
    log "       Start Docker (e.g. open Docker Desktop) and re-run 'make dev',"
    log "       or point DATABASE_URL at a reachable cashlens Postgres."
    exit 1
  fi

  local decision verb port
  decision="$(decide_postgres_provisioning)"
  verb="${decision%% *}"
  port="${decision#* }"

  if [ "$verb" = "reuse-container" ]; then
    log "reusing warm '${CONTAINER_NAME}' container (data persists; no re-seed)."
    docker start "$CONTAINER_NAME" >/dev/null
    POSTGRES_STARTED_CONTAINER=1
    return 0
  fi

  # create-container <port>
  if [ "$port" != "$(db_url_port "$DATABASE_URL")" ]; then
    log "host port $(db_url_port "$DATABASE_URL") is held by another Postgres; using port ${port} for the cashlens container."
    DATABASE_URL="$(db_url_with_port "$DATABASE_URL" "$port")"
    export DATABASE_URL
  fi
  log "creating Postgres container on port ${port} (DATABASE_URL=${DATABASE_URL})..."
  CASHLENS_PG_HOST_PORT="$port" docker compose up -d postgres
  POSTGRES_STARTED_CONTAINER=1
}

wait_for_postgres() {
  log "waiting for Postgres to be ready..."
  local i
  for i in $(seq 1 30); do
    if pg_server_is_usable; then
      log "Postgres is ready."
      return 0
    fi
    if [ "$POSTGRES_STARTED_CONTAINER" = "1" ] \
      && docker exec "$CONTAINER_NAME" pg_isready -U cashlens -d cashlens >/dev/null 2>&1; then
      log "Postgres is ready."
      return 0
    fi
    sleep 1
  done
  log "WARNING: Postgres did not report ready within 30s; continuing anyway."
}

# --- app processes -----------------------------------------------------------

PIDS=""
TRAP_ARMED=0
cleanup() {
  [ "$TRAP_ARMED" = "1" ] || return 0
  log "stopping api/web (Postgres left running; use 'make dev-down' for a clean slate)..."
  local pid
  for pid in $PIDS; do
    # Kill the whole process group so uvicorn/next grandchildren don't leak.
    kill -- "-${pid}" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in $PIDS; do
    wait "$pid" 2>/dev/null || true
  done
  rm -f "$RUNTIME_FILE" 2>/dev/null || true
  log "api/web stopped."
}

ensure_postgres
wait_for_postgres

# Pick actual api/web ports, falling back upward if occupied.
ACTUAL_API_PORT="$(find_free_port "$API_PORT" "$API_HOST")" \
  || { log "ERROR: no free port found for the api near ${API_PORT}."; exit 1; }
[ "$ACTUAL_API_PORT" = "$API_PORT" ] \
  || log "api port ${API_PORT} is busy; using ${ACTUAL_API_PORT}."
ACTUAL_WEB_PORT="$(find_free_port "$WEB_PORT" "$WEB_HOST")" \
  || { log "ERROR: no free port found for web near ${WEB_PORT}."; exit 1; }
[ "$ACTUAL_WEB_PORT" = "$WEB_PORT" ] \
  || log "web port ${WEB_PORT} is busy; using ${ACTUAL_WEB_PORT}."

API_BASE_URL="http://${API_HOST}:${ACTUAL_API_PORT}"

# Record actual ports so `make dev-smoke` targets the real api /health.
printf 'API_HOST=%s\nAPI_PORT=%s\nWEB_HOST=%s\nWEB_PORT=%s\nHEALTH_URL=%s/health\n' \
  "$API_HOST" "$ACTUAL_API_PORT" "$WEB_HOST" "$ACTUAL_WEB_PORT" "$API_BASE_URL" >"$RUNTIME_FILE"

log "starting FastAPI backend on ${API_HOST}:${ACTUAL_API_PORT}..."
# Job-control mode puts each background job in its own process group, so the
# trap can kill the whole group (uvicorn/next + grandchildren) without leaks.
set -m
( cd apps/api && exec uv run uvicorn cash_lens_api.main:app --host "$API_HOST" --port "$ACTUAL_API_PORT" ) &
API_PID=$!
PIDS="$API_PID"

log "starting Next.js dev server on ${WEB_HOST}:${ACTUAL_WEB_PORT} (API_BASE_URL=${API_BASE_URL})..."
( exec env API_BASE_URL="$API_BASE_URL" \
    pnpm --filter @cashlens/web exec next dev --webpack --hostname "$WEB_HOST" --port "$ACTUAL_WEB_PORT" ) &
WEB_PID=$!
PIDS="$PIDS $WEB_PID"

# Arm the trap only AFTER a successful start so a failed startup never tears
# down Postgres the user already had.
TRAP_ARMED=1
trap cleanup EXIT INT TERM

log "stack is up: api=${API_BASE_URL}  web=http://${WEB_HOST}:${ACTUAL_WEB_PORT}"
log "health:   ${API_BASE_URL}/health"
log "press Ctrl-C to stop api/web (Postgres stays warm). Run 'make dev-smoke' to verify health."

# Portable replacement for `wait -n` (bash 3.2): poll until either child exits.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
log "an app process exited; shutting down."
