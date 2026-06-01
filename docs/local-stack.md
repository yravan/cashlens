# One-command local stack

`make dev` brings up the full Cash Lens stack locally in demo mode with a single
command:

- **Postgres** via `docker compose` (the only containerized dependency)
- **FastAPI backend** (`uv`) on `http://127.0.0.1:8000`, pointed at that Postgres
- **Next.js dev server** (`pnpm`) on `http://127.0.0.1:3000`

All three processes are torn down together when you press `Ctrl-C`.

## Requirements

- A running **Docker daemon** (e.g. Docker Desktop) — Postgres runs in a
  container described by [`docker-compose.yml`](https://github.com/yravan/cashlens/blob/main/docker-compose.yml).
- `uv` for the backend and `pnpm` for the frontend (installed by `make bootstrap`).

If the Docker daemon is not running, `make dev` exits immediately with a clear
message telling you to start Docker.

## Usage

```bash
make dev
```

Then open <http://127.0.0.1:3000> for the app, or hit the backend health check:

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok"}
```

### Acceptance smoke test

`make dev-smoke` polls the backend `/health` endpoint until it returns a healthy
status, failing after a 60-second budget. Run it in a second terminal while
`make dev` is up:

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
| `API_PORT`      | `8000`                                                          | Backend port                     |
| `WEB_PORT`      | `3000`                                                          | Frontend port                    |

The Postgres credentials in `docker-compose.yml` must stay in sync with the
default `DATABASE_URL` above.

## Observability

The backend continues to emit/observe `http.server.duration` through its
existing middleware; the local stack does not change that behavior.
