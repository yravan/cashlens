SHELL := /bin/bash
UV_CACHE_DIR ?= /private/tmp/uv-cache

.PHONY: bootstrap api-bootstrap api-test web-install web-test web-browsers e2e docs-build docs-serve ci

bootstrap: api-bootstrap web-install

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
