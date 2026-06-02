SHELL := /bin/bash
UV_CACHE_DIR ?= /private/tmp/uv-cache

.PHONY: bootstrap api-bootstrap api-test api-test-postgres web-install web-test web-browsers e2e docs-build docs-serve ci dev dev-down dev-smoke dev-stack-test

bootstrap: api-bootstrap web-install

# One-command local stack: Postgres + FastAPI + Next.js in demo mode.
# Reuses a cashlens-usable Postgres if reachable, else the warm container,
# else creates one (on the next free host port if 5432 is taken). On Ctrl-C
# only api/web stop; Postgres stays warm. See README "Local development".
dev: api-bootstrap web-install
	bash ./scripts/dev-stack.sh

# Stop and remove the cashlens Postgres container for a clean slate. Pass
# CASHLENS_DOWN_VOLUMES=1 to also drop the data volume.
dev-down:
	bash ./scripts/dev-down.sh

# Unit tests for the pure dev-stack logic (free-port, db-url, provisioning
# decision). CI-safe: no Docker daemon required.
dev-stack-test:
	bash ./scripts/dev-lib.test.sh

# Poll the backend /health endpoint until green (fails after 60s).
# Run in a second terminal while `make dev` is up, or set
# CASHLENS_SMOKE_MANAGE_STACK=1 to have it bring up and tear down the stack.
dev-smoke:
	bash ./scripts/dev-smoke.sh

api-bootstrap:
	cd apps/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync --group dev

api-test: api-bootstrap
	cd apps/api && uv run ruff check src tests
	cd apps/api && uv run pytest

# Run the backend suite against a Postgres 16 container (matches Neon's major
# version), reusing the docker-compose `postgres` service. Mirrors the
# Postgres leg of the CI api-tests matrix. Requires Docker. See README.
api-test-postgres: api-bootstrap
	bash ./scripts/api-test-postgres.sh

web-install:
	pnpm install --frozen-lockfile --ignore-scripts

web-test: web-install
	pnpm lint:web
	pnpm typecheck:web
	pnpm test:web
	pnpm build:web

web-browsers: web-install
	pnpm playwright:install

e2e: api-bootstrap web-install web-browsers
	pnpm e2e:web

docs-build:
	bash ./scripts/check-version-sync.sh
	uv run --with-requirements docs/requirements.txt mkdocs build --strict

docs-serve:
	uv run --with-requirements docs/requirements.txt mkdocs serve

ci: api-test web-test e2e docs-build
