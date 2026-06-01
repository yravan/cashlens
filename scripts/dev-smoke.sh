#!/usr/bin/env bash
#
# dev-smoke.sh — prove the local backend /health endpoint goes green.
#
# This is the executable acceptance proof for PLT-1.1: it polls the backend
# /health endpoint until it returns a healthy status, failing after a 60s
# budget. It is intentionally deterministic and CI-safe.
#
# Modes:
#   - Default: poll an already-running backend (started by `make dev`).
#   - With CASHLENS_SMOKE_MANAGE_STACK=1: bring up the full `make dev` stack,
#     wait for health, then tear it down. Requires a running Docker daemon.
#
# If Docker is required but its daemon is unavailable, the script SKIPS with a
# clear message and exit code 0 instead of hard-failing, so it stays CI-safe in
# environments without Docker. The default mode does not require Docker at all.
set -euo pipefail

HEALTH_URL="${CASHLENS_HEALTH_URL:-http://127.0.0.1:8000/health}"
TIMEOUT_SECONDS="${CASHLENS_SMOKE_TIMEOUT:-60}"
POLL_INTERVAL_SECONDS="${CASHLENS_SMOKE_INTERVAL:-2}"
MANAGE_STACK="${CASHLENS_SMOKE_MANAGE_STACK:-0}"

log() { printf '[dev-smoke] %s\n' "$*"; }

docker_daemon_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

# Returns 0 when /health reports a healthy status, non-zero otherwise.
health_is_green() {
  local body
  body="$(curl --silent --show-error --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  [[ -n "$body" ]] || return 1
  # The backend returns {"status":"ok"}. Accept "ok" or "healthy" to stay
  # robust to a future richer health payload.
  printf '%s' "$body" | grep -Eqi '"status"[[:space:]]*:[[:space:]]*"(ok|healthy)"'
}

poll_health() {
  local deadline elapsed
  deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  log "polling ${HEALTH_URL} for up to ${TIMEOUT_SECONDS}s"
  while true; do
    if health_is_green; then
      elapsed=$(( $(date +%s) - (deadline - TIMEOUT_SECONDS) ))
      log "health is GREEN after ${elapsed}s"
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      log "ERROR: health did not go green within ${TIMEOUT_SECONDS}s"
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

STACK_PID=""
cleanup() {
  if [[ -n "$STACK_PID" ]]; then
    log "stopping managed stack (pid ${STACK_PID})"
    kill "$STACK_PID" >/dev/null 2>&1 || true
    wait "$STACK_PID" 2>/dev/null || true
    docker compose down >/dev/null 2>&1 || true
  fi
}

main() {
  if ! command -v curl >/dev/null 2>&1; then
    log "ERROR: curl is required but not installed"
    exit 1
  fi

  if [[ "$MANAGE_STACK" == "1" ]]; then
    if ! docker_daemon_available; then
      log "SKIP: Docker daemon is not available; cannot manage the full stack."
      log "SKIP: start it (e.g. open Docker Desktop) and re-run, or run 'make dev'"
      log "SKIP: in one terminal and 'make dev-smoke' in another."
      exit 0
    fi
    trap cleanup EXIT
    log "bringing up full stack via 'make dev'"
    make dev >/tmp/cashlens-dev.log 2>&1 &
    STACK_PID=$!
  fi

  if poll_health; then
    log "PASS: backend /health is green"
    exit 0
  fi

  if [[ "$MANAGE_STACK" == "1" ]]; then
    log "---- last 40 lines of /tmp/cashlens-dev.log ----"
    tail -n 40 /tmp/cashlens-dev.log 2>/dev/null || true
  fi
  exit 1
}

main "$@"
