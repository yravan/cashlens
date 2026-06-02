#!/usr/bin/env bash
#
# dev-down.sh — stop and remove the cashlens Postgres container for a clean
# slate (PLT-1.1). `make dev` leaves Postgres warm between runs; run this when
# you explicitly want to wipe the local stack's database container.
#
# The named volume (cashlens-postgres-data) is preserved by default so data
# survives; pass --volumes to also drop the volume for a full reset.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '[dev-down] %s\n' "$*"; }

DOWN_FLAGS=""
if [ "${1:-}" = "--volumes" ] || [ "${CASHLENS_DOWN_VOLUMES:-0}" = "1" ]; then
  DOWN_FLAGS="--volumes"
  log "removing the cashlens Postgres container AND its data volume."
else
  log "removing the cashlens Postgres container (data volume preserved)."
fi

rm -f "${CASHLENS_RUNTIME_FILE:-$REPO_ROOT/.dev-stack.runtime}" 2>/dev/null || true

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  log "Docker is unavailable; nothing to tear down."
  exit 0
fi

# shellcheck disable=SC2086
docker compose down $DOWN_FLAGS >/dev/null 2>&1 || true
log "done."
