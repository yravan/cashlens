SHELL := /bin/bash
UV_CACHE_DIR ?= /private/tmp/uv-cache

.PHONY: bootstrap api-bootstrap api-test web-install web-test web-browsers e2e docs-build docs-serve ci dev dev-smoke

bootstrap: api-bootstrap web-install

# One-command local stack: Postgres (docker compose) + FastAPI + Next.js in
# demo mode. Requires a running Docker daemon. See README "Local development".
dev: api-bootstrap web-install
	bash ./scripts/dev-stack.sh

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
