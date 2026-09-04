# Common developer commands. Every command keeps caches inside the project (see env.sh).
SHELL := /bin/bash
ROOT := $(shell pwd)
export UV_CACHE_DIR := $(ROOT)/.uv-cache
export UV_PROJECT_ENVIRONMENT := $(ROOT)/.venv
export npm_config_cache := $(ROOT)/.npm-cache
export PLAYWRIGHT_BROWSERS_PATH := $(ROOT)/.playwright-browsers
PY := $(ROOT)/.venv/bin/python

.PHONY: setup backend-sync frontend-install test test-backend test-frontend lint typecheck dev-backend dev-frontend contracts

setup: backend-sync frontend-install

backend-sync:
	cd backend && uv sync --extra dev

frontend-install:
	cd frontend && pnpm install

test: test-backend test-frontend

test-backend:
	cd backend && $(PY) -m pytest -q

test-frontend:
	cd frontend && pnpm test

lint:
	cd backend && $(ROOT)/.venv/bin/ruff check . && $(ROOT)/.venv/bin/ruff format --check .
	cd frontend && pnpm lint

typecheck:
	cd backend && $(ROOT)/.venv/bin/mypy
	cd frontend && pnpm typecheck

dev-backend:
	cd backend && $(PY) -m atomscope.api.server --host 127.0.0.1 --port 8765

dev-frontend:
	cd frontend && pnpm dev

# Regenerate TypeScript API types from the backend's OpenAPI schema.
contracts:
	cd backend && $(PY) -m atomscope.api.export_openapi ../frontend/src/api/openapi.json
	cd frontend && pnpm exec openapi-typescript src/api/openapi.json -o src/api/schema.d.ts
