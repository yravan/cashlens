#!/usr/bin/env bash
#
# api-test-postgres.sh — run the backend test suite against Postgres 16 (PLT-1.3).
#
# Reuses the `postgres` service from docker-compose.yml (PLT-1.1) rather than
# duplicating it: brings the container up on the configured host port (falling
# back to the next free port if it is held by another Postgres, e.g. Homebrew),
# waits for health, runs pytest with DATABASE_URL pointed at it, then tears the
# container down so each run is clean and isolated.
#
# This mirrors the Postgres 16 leg of the CI `api-tests` matrix so the same
# parity coverage is reproducible locally. Exits with a clear message if the
# Docker daemon is unavailable.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/dev-lib.sh
. "$REPO_ROOT/scripts/dev-lib.sh"

CONTAINER_NAME="cashlens-postgres"
BASE_URL="postgresql+psycopg2://cashlens:cashlens@127.0.0.1:5432/cashlens"

log() { printf '[api-test-postgres] %s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  log "ERROR: Docker is unavailable. Start Docker (e.g. open Docker Desktop) and re-run."
  log "       The same Postgres 16 coverage runs in CI (api-tests matrix)."
  exit 1
fi

# Pick a free host port so we never collide with a host Postgres on 5432.
HOST_PORT="$(find_free_port 5432)"
DATABASE_URL="$(db_url_with_port "$BASE_URL" "$HOST_PORT")"
export DATABASE_URL

cleanup() {
  log "stopping Postgres container..."
  CASHLENS_PG_HOST_PORT="$HOST_PORT" docker compose down >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "starting Postgres 16 on host port ${HOST_PORT} (DATABASE_URL=${DATABASE_URL})..."
CASHLENS_PG_HOST_PORT="$HOST_PORT" docker compose up -d postgres

log "waiting for Postgres to be healthy..."
for _ in $(seq 1 40); do
  if docker exec "$CONTAINER_NAME" pg_isready -U cashlens -d cashlens >/dev/null 2>&1; then
    log "Postgres is ready."
    break
  fi
  sleep 1
done

log "running pytest against Postgres 16..."
# No `exec`: keep this shell alive so the EXIT trap tears the container down.
(cd "$REPO_ROOT/apps/api" && uv run pytest "$@")
