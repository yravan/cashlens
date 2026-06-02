# One-command local stack

`make dev` brings up the full Cash Lens stack locally in demo mode with a single
command:

- **Postgres** — reused if a cashlens-usable server already answers; otherwise
  run in a `docker compose` container.
- **FastAPI backend** (`uv`) on `http://127.0.0.1:8000` (or the next free port),
  pointed at that Postgres.
- **Next.js dev server** (`pnpm`) on `http://127.0.0.1:3000` (or the next free
  port), pointed at the backend's actual port.

On `Ctrl-C`, only the api and web processes stop — **Postgres is left running**
so the next `make dev` starts fast and keeps its data. Run `make dev-down` for a
clean slate (see below).

## How Postgres is provisioned

`make dev` decides, in order:

1. **Reuse a usable server.** If a Postgres at the configured `DATABASE_URL` is
   reachable and the `cashlens` db/role work, it is reused as-is — **no
   container is started** and no re-seed happens.
2. **Reuse the warm container.** Otherwise, if the `cashlens-postgres` container
   already exists (running or stopped), it is started/reused so its named-volume
   data persists.
3. **Create a container.** Otherwise a fresh container is created via compose.

**Host-port conflict:** if port `5432` is held by some *other* Postgres (for
example a Homebrew `postgresql@16`), `make dev` brings the cashlens container up
on the **next free port** (scanning upward from `5432`), sets `DATABASE_URL` to
match, and prints the chosen port. It never aborts with a raw "port is already
allocated" error.

## Requirements

- For the container path, a running **Docker daemon** (e.g. Docker Desktop) —
  Postgres runs in a container described by
  [`docker-compose.yml`](https://github.com/yravan/cashlens/blob/main/docker-compose.yml).
  If a cashlens-usable Postgres is already reachable at `DATABASE_URL`, Docker is
  not needed.
- `uv` for the backend and `pnpm` for the frontend (installed by `make bootstrap`).

If no usable Postgres is reachable **and** the Docker daemon is not running,
`make dev` exits with a clear message telling you to start Docker (or point
`DATABASE_URL` at a reachable cashlens Postgres).

## Clean slate: `make dev-down`

`make dev` keeps Postgres warm between runs. When you want to remove the
container (for example to start from an empty database):

```bash
make dev-down                      # remove the container, keep the data volume
CASHLENS_DOWN_VOLUMES=1 make dev-down   # also drop the data volume
```

## Usage

```bash
make dev
```

Then open the app (default <http://127.0.0.1:3000>), or hit the backend health
check (default port `8000`). `make dev` prints the actual ports it chose if the
defaults were busy:

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok"}
```

### Acceptance smoke test

`make dev-smoke` polls the backend `/health` endpoint until it returns a healthy
status, failing after a 60-second budget. It targets the **actual** api port
that `make dev` chose (read from the `.dev-stack.runtime` file the stack writes),
so it works even when the default `8000` was busy. Run it in a second terminal
while `make dev` is up:

```bash
# terminal 1
make dev

# terminal 2
make dev-smoke
```

To have the smoke target manage the whole stack itself (bring it up, wait for
health, then tear it down), set:

```bash
CASHLENS_SMOKE_MANAGE_STACK=1 make dev-smoke
```

If Docker is unavailable in that managed mode, the smoke script **skips
gracefully** (exit 0) with a clear message instead of failing, so it stays
CI-safe.

## Configuration

The stack uses these defaults (override via environment variables):

| Variable        | Default                                                          | Purpose                          |
| --------------- | --------------------------------------------------------------- | -------------------------------- |
| `DATABASE_URL`  | `postgresql+psycopg2://cashlens:cashlens@127.0.0.1:5432/cashlens` | Backend database (matches compose) |
| `DEMO_MODE`     | `true`                                                          | Seeded, secret-free demo mode    |
| `SEED_DEMO_DATA`| `true`                                                          | Seed demo data on startup        |
| `API_PORT`      | `8000`                                                          | Backend port (falls back to next free port if busy) |
| `WEB_PORT`      | `3000`                                                          | Frontend port (falls back to next free port if busy) |

If a chosen port is occupied, the stack scans upward for the next free one,
prints the actual port, and points web's `API_BASE_URL` at the actual api port.

The Postgres credentials in `docker-compose.yml` must stay in sync with the
default `DATABASE_URL` above.

## Observability

This change touches no backend application code. The backend does **not**
currently emit an `http.server.duration` metric (its only middleware is CORS;
there is no metrics/OpenTelemetry instrumentation in `apps/api/src`). The
cross-cutting observability constraint for this leaf holds simply because the
local stack leaves all app code untouched — it does not add or remove any
instrumentation.
