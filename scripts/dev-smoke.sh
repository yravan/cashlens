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

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_FILE="${CASHLENS_RUNTIME_FILE:-$REPO_ROOT/.dev-stack.runtime}"

# Resolve the health URL in priority order:
#   1. explicit CASHLENS_HEALTH_URL
#   2. the actual api port `make dev` recorded in the runtime file
#   3. the 8000 default
resolve_health_url() {
  if [ -n "${CASHLENS_HEALTH_URL:-}" ]; then
    printf '%s\n' "$CASHLENS_HEALTH_URL"
    return
  fi
  if [ -f "$RUNTIME_FILE" ]; then
    local url
    url="$(sed -nE 's/^HEALTH_URL=(.*)$/\1/p' "$RUNTIME_FILE" | head -1)"
    if [ -n "$url" ]; then
      printf '%s\n' "$url"
      return
    fi
  fi
  printf 'http://127.0.0.1:8000/health\n'
}

HEALTH_URL="$(resolve_health_url)"
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
    # Stop the whole `make dev` process group so uvicorn/next don't leak, then
    # remove the container (managed mode owns the full lifecycle).
    kill -- "-${STACK_PID}" >/dev/null 2>&1 || kill "$STACK_PID" >/dev/null 2>&1 || true
    wait "$STACK_PID" 2>/dev/null || true
    bash "$REPO_ROOT/scripts/dev-down.sh" >/dev/null 2>&1 || true
  fi
}

# Wait until `make dev` has written its runtime file (or the deadline passes),
# then re-resolve HEALTH_URL to the actual api port it chose.
wait_for_runtime_file() {
  local deadline
  deadline=$(( $(date +%s) + 30 ))
  while [[ ! -f "$RUNTIME_FILE" ]] && (( $(date +%s) < deadline )); do
    sleep 1
  done
  HEALTH_URL="$(resolve_health_url)"
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
    set -m
    make dev >/tmp/cashlens-dev.log 2>&1 &
    STACK_PID=$!
    set +m
    wait_for_runtime_file
    log "targeting health URL: ${HEALTH_URL}"
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
