#!/usr/bin/env bash
#
# dev-lib.test.sh — deterministic unit tests for the pure dev-stack logic.
#
# CI-safe: no Docker daemon, no live Postgres, no real ports required. All
# environment probes are stubbed via the *_PROBE indirection in dev-lib.sh.
#
# Runs under macOS system bash 3.2.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/dev-lib.sh
. "$HERE/dev-lib.sh"

PASS=0
FAIL=0
check() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS + 1))
    printf 'ok   - %s\n' "$desc"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL - %s\n       got:  %s\n       want: %s\n' "$desc" "$got" "$want"
  fi
}

# --- db_url_with_port / db_url_port -----------------------------------------

URL='postgresql+psycopg2://cashlens:cashlens@127.0.0.1:5432/cashlens'
check "db_url_port reads explicit port" "$(db_url_port "$URL")" "5432"
check "db_url_port defaults to 5432 when absent" \
  "$(db_url_port 'postgresql://u:p@127.0.0.1/cashlens')" "5432"
check "db_url_with_port rewrites only the host port" \
  "$(db_url_with_port "$URL" 5544)" \
  'postgresql+psycopg2://cashlens:cashlens@127.0.0.1:5544/cashlens'
check "db_url_with_port leaves a numeric-suffixed db name intact" \
  "$(db_url_with_port 'postgresql://u:p@db:5432/app123' 6000)" \
  'postgresql://u:p@db:6000/app123'

# --- find_free_port (stubbed TCP probe) -------------------------------------

# Stub: only ports listed in BUSY_PORTS are "occupied".
BUSY_PORTS=""
stub_port_probe() {
  local p="$1" b
  for b in $BUSY_PORTS; do
    [ "$p" = "$b" ] && return 1
  done
  return 0
}
PORT_PROBE=stub_port_probe

BUSY_PORTS=""
check "find_free_port returns start when free" "$(find_free_port 5432)" "5432"

BUSY_PORTS="5432 5433 5434"
check "find_free_port scans upward past busy ports" "$(find_free_port 5432)" "5435"

BUSY_PORTS="8000"
check "find_free_port skips a single busy port" "$(find_free_port 8000)" "8001"

# Exhaustion: every probed port busy within the small max returns failure.
all_busy() { return 1; }
PORT_PROBE=all_busy
find_free_port 9000 127.0.0.1 3 >/dev/null 2>&1
check "find_free_port fails when none free" "$?" "1"
PORT_PROBE=stub_port_probe

# --- decide_postgres_provisioning (all probes stubbed) ----------------------

export DATABASE_URL='postgresql+psycopg2://cashlens:cashlens@127.0.0.1:5432/cashlens'

yes_() { return 0; }
no_() { return 1; }

# 1. A usable cashlens server already answers -> reuse it, no container.
PG_USABLE_PROBE=yes_; CONTAINER_EXISTS_PROBE=no_; BUSY_PORTS=""
check "reuse usable server" "$(decide_postgres_provisioning)" "reuse-server"

# 2. No usable server, but the warm container exists -> reuse the container.
PG_USABLE_PROBE=no_; CONTAINER_EXISTS_PROBE=yes_; BUSY_PORTS=""
check "reuse warm container" "$(decide_postgres_provisioning)" "reuse-container"

# 3. No server, no container, 5432 free -> create on 5432.
PG_USABLE_PROBE=no_; CONTAINER_EXISTS_PROBE=no_; BUSY_PORTS=""
check "create on default port when free" \
  "$(decide_postgres_provisioning)" "create-container 5432"

# 4. No server, no container, 5432 held by some OTHER Postgres -> next free port.
#    (This is the Homebrew-postgres-on-5432 case from the review.)
PG_USABLE_PROBE=no_; CONTAINER_EXISTS_PROBE=no_; BUSY_PORTS="5432"
check "create on alt port when 5432 taken by another Postgres" \
  "$(decide_postgres_provisioning)" "create-container 5433"

# 5. 5432 and 5433 both taken -> scan to 5434.
PG_USABLE_PROBE=no_; CONTAINER_EXISTS_PROBE=no_; BUSY_PORTS="5432 5433"
check "create scans further when several ports taken" \
  "$(decide_postgres_provisioning)" "create-container 5434"

# --- summary -----------------------------------------------------------------

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
