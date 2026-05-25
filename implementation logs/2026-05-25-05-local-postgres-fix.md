# Local Postgres Driver Fix

## Why this was needed

The deployment-oriented backend environment was switched from SQLite to Neon Postgres for local testing. The SQLAlchemy engine accepted the Postgres URL, but the runtime failed during startup because no Postgres DBAPI driver was installed.

## What failed

Starting the API with:

```bash
uv run uvicorn cash_lens_api.main:app --host 127.0.0.1 --port 8000
```

raised:

```txt
ModuleNotFoundError: No module named 'psycopg2'
```

This happened before any request handling, so production deployment would have failed on boot as well.

## Fix applied

Added:

```txt
psycopg2-binary>=2.9.11
```

to the backend dependencies in `apps/api/pyproject.toml`.

## Why this fix

The app already uses a standard `postgresql://...` SQLAlchemy URL. That URL resolves to the `psycopg2` dialect by default, so the minimal-risk fix was to add the missing driver rather than change URL conventions or database engine wiring.

## Expected result

After syncing dependencies again, the backend should start successfully against Neon and the rest of the local test flow can proceed unchanged.
