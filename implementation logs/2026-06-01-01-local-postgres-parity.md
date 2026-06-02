# Local Postgres parity (PLT-1.3)

- Date: 2026-06-01
- Area: infra, backend testing, CI
- Leaf: PLT-1.3 — Local Postgres parity (docker-compose) (size S, layer infra)
- Stacked on: PLT-1.1 (`feat/plt-1.1-local-stack`, PR #22)

## Acceptance

The backend test suite passes on a Postgres 16 container identical to Neon's
major version, and pytest runs against Postgres 16 in a CI matrix in addition to
the existing SQLite run.

## What changed

- `apps/api/tests/conftest.py`: `DATABASE_URL` now selects the backend. When it
  is unset *or empty* (the SQLite leg of the CI matrix exports `DATABASE_URL=""`)
  the suite falls back to a throwaway SQLite file; set it to a Postgres URL to run
  against Postgres 16. The existing per-test `drop_all`/`create_all` fixture gives
  clean, isolated state on both backends — no schema/teardown changes were needed.
- `.github/workflows/ci.yml`: split the backend job into a matrix `api-tests` job
  (legs `sqlite` and `postgres`) plus a thin `api` gate job that `needs:
  [api-tests]`. The postgres leg uses a `services: postgres:16` container
  (`pg_isready` healthcheck) and points `DATABASE_URL` at it; the sqlite leg skips
  the service via a conditional empty `image`. The bare `api` required check name
  is preserved by the gate job, and `e2e` still `needs: [api, web]`.
- `scripts/api-test-postgres.sh` + `make api-test-postgres`: run the suite locally
  against Postgres 16 by reusing the PLT-1.1 `docker-compose.yml` `postgres`
  service (no duplication). Reuses `dev-lib.sh` helpers (`find_free_port`,
  `db_url_with_port`) to pick a free host port when 5432 is held (e.g. Homebrew
  Postgres), waits for health, runs pytest, and tears the container down on exit.
- `README.md`: added a "Backend tests against Postgres" section documenting
  `make api-test-postgres`, the `DATABASE_URL` override, and the CI matrix.

## Why

- `db.py` defaults to SQLite but production runs on Neon Postgres 16. Running the
  suite against Postgres 16 catches dialect/parity issues before they reach prod.
- `db.py` was already Postgres-safe (only the SQLite `check_same_thread` arg is
  conditional; models use portable column types), so the change is test/CI/tooling
  only — no application code touched, and no Alembic (PLT-2.1 is separate).

## CI required-check note

Adding a matrix renames per-leg checks to `api-tests (sqlite)` / `api-tests
(postgres)`. To avoid breaking branch protection, the matrix lives under
`api-tests` and a separate gate job named exactly `api` aggregates it. Branch
protection's required `api` check is unchanged.

## Acceptance -> evidence

- "Suite passes on PG16": `make api-test-postgres` ran 9 tests green against a
  `postgres:16-alpine` container (compose service), with clean teardown.
- "Pytest runs against PG16 in a CI matrix in addition to existing run": the
  `api-tests` matrix has `sqlite` + `postgres` legs; the `postgres` leg uses a
  `services: postgres:16` container. The existing SQLite run is preserved.

## Validation

- `make api-test` (SQLite): 9 passed.
- `make api-test-postgres` (Postgres 16 via compose, host port auto-fallback to
  5433): 9 passed, container torn down.
- Direct `DATABASE_URL=postgresql+psycopg2://...` run: 9 passed.
- `DATABASE_URL=""` and unset both correctly fall back to SQLite: 9 passed each.
- `uv run ruff check src tests`: all checks passed.
- `make docs-build`: documentation + version sync OK.
- CI workflow YAML parsed and job graph validated (jobs: api-tests, api, web,
  e2e, docs; `api` needs api-tests; `e2e` needs api+web).

## Fix: `api` gate did not fail on a failed matrix leg (2026-06-01)

- Defect (confirmed on real CI): the `api` gate job was `needs: [api-tests]`
  with no `if:` and a hardcoded `echo` success step. When any matrix leg failed,
  GitHub *skipped* the gate, and branch protection treats a skipped required
  check as satisfied — so a broken Postgres leg could merge into `main` with the
  `api` check green. Proven on run `26803616460`: `api-tests (postgres)` =
  failure, `api` = skipped, PR still MERGEABLE.
- Fix (`.github/workflows/ci.yml`): added `if: always()` to the `api` gate so it
  runs even when a leg fails, and replaced the hardcoded echo with a step that
  fails unless `needs.api-tests.result == "success"` (which is `success` only if
  every matrix leg succeeded). Job graph otherwise unchanged (`e2e` still
  `needs: [api, web]`).
- Green-path evidence: pushed to `feat/plt-1.3-postgres-parity` (#23); the `api`
  gate now actually *runs* (not skipped) and is green only when both legs pass.
- Red-path evidence: a throwaway scratch branch with a Postgres-only
  `assert False` test made `api-tests (postgres)` fail; the `api` gate went to
  *failure* (not skipped), blocking the PR. Scratch branch deleted afterward.
- Known transient: the `postgres:16` service-container image pull can hit a
  registry timeout flake. GitHub service containers have no built-in pull-retry,
  and restructuring to a manual `docker run` to add one would break the clean
  service-container pattern — left as-is; recover via
  `gh run rerun <id> --failed`.
