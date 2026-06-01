#!/usr/bin/env bash
#
# dev-stack.sh — one-command local stack for Cash Lens (PLT-1.1).
#
# Brings up, in demo mode:
#   1. Postgres via docker compose (the only containerized dependency)
#   2. The FastAPI backend (uv) on 127.0.0.1:8000, pointed at that Postgres
#   3. The Next.js dev server (pnpm) on 127.0.0.1:3000
#
# All three are torn down together on Ctrl-C / exit. This script reuses the
# existing run patterns documented in README "Local development".
#
# If the Docker daemon is unavailable, this exits with a clear, actionable
# message rather than a confusing stack trace.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Demo-mode backend config. DATABASE_URL must match docker-compose.yml.
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

log() { printf '[dev-stack] %s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  log "ERROR: Docker daemon is not available."
  log "       The local stack needs Postgres via docker compose."
  log "       Start Docker (e.g. open Docker Desktop) and re-run 'make dev'."
  exit 1
fi

PIDS=()
cleanup() {
  log "shutting down local stack..."
  for pid in "${PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in "${PIDS[@]:-}"; do
    [[ -n "$pid" ]] && wait "$pid" 2>/dev/null || true
  done
  docker compose stop postgres >/dev/null 2>&1 || true
  log "stack stopped."
}
trap cleanup EXIT INT TERM

log "starting Postgres (docker compose)..."
docker compose up -d postgres

log "waiting for Postgres to be healthy..."
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U cashlens -d cashlens >/dev/null 2>&1; then
    log "Postgres is ready."
    break
  fi
  sleep 1
done

log "starting FastAPI backend on ${API_HOST}:${API_PORT} (DATABASE_URL=${DATABASE_URL})..."
( cd apps/api && uv run uvicorn cash_lens_api.main:app --host "$API_HOST" --port "$API_PORT" ) &
PIDS+=("$!")

log "starting Next.js dev server on ${WEB_HOST}:${WEB_PORT}..."
API_BASE_URL="http://${API_HOST}:${API_PORT}" \
  pnpm --filter @cashlens/web exec next dev --webpack --hostname "$WEB_HOST" --port "$WEB_PORT" &
PIDS+=("$!")

log "stack is up: api=http://${API_HOST}:${API_PORT}  web=http://${WEB_HOST}:${WEB_PORT}"
log "health:   http://${API_HOST}:${API_PORT}/health"
log "press Ctrl-C to stop. (Run 'make dev-smoke' in another terminal to verify health.)"

# Wait on the app processes; if either exits, cleanup runs via trap.
wait -n "${PIDS[@]}"
