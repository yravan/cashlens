SHELL := /bin/bash
UV_CACHE_DIR ?= /private/tmp/uv-cache

.PHONY: bootstrap api-bootstrap api-test web-install web-test web-browsers e2e ci

bootstrap: api-bootstrap web-install

api-bootstrap:
	cd apps/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync --group dev

api-test: api-bootstrap
	cd apps/api && uv run ruff check src tests
	cd apps/api && uv run pytest

web-install:
	cd apps/web && pnpm install --frozen-lockfile --trust-lockfile

web-test: web-install
	cd apps/web && pnpm lint
	cd apps/web && pnpm typecheck
	cd apps/web && pnpm test --run
	cd apps/web && pnpm build

web-browsers: web-install
	cd apps/web && pnpm exec playwright install --with-deps chromium

e2e: api-bootstrap web-install web-browsers
	cd apps/web && pnpm e2e

ci: api-test web-test e2e
