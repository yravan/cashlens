#!/usr/bin/env bash
#
# dev-lib.sh — pure, testable helpers for the local dev stack (PLT-1.1).
#
# These functions hold the decision logic that the orchestrator
# (dev-stack.sh) relies on: free-port selection, parsing a DATABASE_URL,
# and deciding how to provision Postgres (reuse a usable server, reuse the
# warm container, or create it — possibly on an alternate host port).
#
# The logic is split out so it can be unit-tested without a live Docker
# daemon: callers inject the "probe" functions (TCP check, Postgres
# usability check, container existence) so tests can stub them.
#
# Targets macOS system bash 3.2 — no `wait -n`, no associative arrays.

# port_is_free PORT [HOST]
# Returns 0 if nothing is listening on HOST:PORT, non-zero if occupied.
# Uses a bash /dev/tcp connect probe, which needs no extra tooling.
port_is_free() {
  local port="$1" host="${2:-127.0.0.1}"
  if (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
    exec 3>&- 2>/dev/null || true
    return 1
  fi
  return 0
}

# find_free_port START [HOST] [MAX_TRIES]
# Scans upward from START for the first free port. Prints it on stdout.
# Returns non-zero if none found within MAX_TRIES.
# The TCP probe is indirected through PORT_PROBE so tests can stub it.
PORT_PROBE="${PORT_PROBE:-port_is_free}"
find_free_port() {
  local start="$1" host="${2:-127.0.0.1}" max="${3:-100}"
  local port="$start" tries=0
  while [ "$tries" -lt "$max" ]; do
    if "$PORT_PROBE" "$port" "$host"; then
      printf '%s\n' "$port"
      return 0
    fi
    port=$((port + 1))
    tries=$((tries + 1))
  done
  return 1
}

# db_url_with_port URL PORT
# Rewrites the host:port portion of a postgres DATABASE_URL to use PORT,
# leaving scheme, credentials, host and database name intact.
# Example: postgresql+psycopg2://u:p@127.0.0.1:5432/db  +  5544
#       -> postgresql+psycopg2://u:p@127.0.0.1:5544/db
db_url_with_port() {
  local url="$1" port="$2"
  # Replace the first ":<digits>/" (the host port) with the new port.
  printf '%s\n' "$url" | sed -E "s#(@[^/:]+):[0-9]+/#\1:${port}/#"
}

# db_url_port URL
# Extracts the host port from a postgres DATABASE_URL (defaults to 5432
# if the URL omits an explicit port).
db_url_port() {
  local url="$1" port
  port="$(printf '%s\n' "$url" | sed -nE "s#.*@[^/:]+:([0-9]+)/.*#\1#p")"
  printf '%s\n' "${port:-5432}"
}

# decide_postgres_provisioning
# The core branch logic, expressed against three injected probes so it is
# fully unit-testable without Docker:
#
#   PG_USABLE_PROBE      — exit 0 if a cashlens-usable Postgres answers at
#                          the configured DATABASE_URL.
#   CONTAINER_EXISTS_PROBE — exit 0 if the cashlens-postgres container exists
#                          (running or stopped).
#   PORT_PROBE           — exit 0 if a given host port is free.
#
# Inputs: DATABASE_URL (env).
# Output (stdout): one decision line, one of:
#   reuse-server
#   reuse-container
#   create-container <port>
# Where <port> is the host port the container should publish (the configured
# port when free, otherwise the next free port scanning upward).
PG_USABLE_PROBE="${PG_USABLE_PROBE:-pg_server_is_usable}"
CONTAINER_EXISTS_PROBE="${CONTAINER_EXISTS_PROBE:-pg_container_exists}"
decide_postgres_provisioning() {
  local url="${DATABASE_URL:?DATABASE_URL must be set}"
  local want_port chosen

  if "$PG_USABLE_PROBE"; then
    printf 'reuse-server\n'
    return 0
  fi

  if "$CONTAINER_EXISTS_PROBE"; then
    printf 'reuse-container\n'
    return 0
  fi

  want_port="$(db_url_port "$url")"
  if "$PORT_PROBE" "$want_port" 127.0.0.1; then
    chosen="$want_port"
  else
    chosen="$(find_free_port "$((want_port + 1))" 127.0.0.1)" || return 1
  fi
  printf 'create-container %s\n' "$chosen"
}
