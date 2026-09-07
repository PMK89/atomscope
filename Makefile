# Common developer commands. Every command keeps caches inside the project (see env.sh).
SHELL := /bin/bash
ROOT := $(shell pwd)
export UV_CACHE_DIR := $(ROOT)/.uv-cache
export UV_PROJECT_ENVIRONMENT := $(ROOT)/.venv
export npm_config_cache := $(ROOT)/.npm-cache
export PLAYWRIGHT_BROWSERS_PATH := $(ROOT)/.playwright-browsers
PY := $(ROOT)/.venv/bin/python

.PHONY: bench bench-full test-perf test-e2e setup backend-sync frontend-install test test-backend test-frontend lint typecheck dev-backend dev-frontend contracts course-export

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
	cd frontend && pnpm exec openapi-typescript src/api/openapi.json -o src/api/schema.d.ts \
	  && pnpm exec prettier --write src/api/openapi.json src/api/schema.d.ts

test-e2e:
	cd frontend && pnpm exec playwright test

# Regenerate examples/ from the CP-PAW hands-on course runs under .scratch/course-runs/course.
#
# Committed by default without the volumetric grids as well as without the restart files: the
# course project is 926 MB, of which 683 MB is restart, 114 MB grids and 92 MB setup reports.
# What is left -- inputs, protocols, parsed results, DOS and band data -- is 37 MB and is the
# record of what was run. The grids are the only omission that costs a picture, and they come
# back by re-running an example (scripts/course/run.py), which is why they are droppable.
#
#   make course-export                  # 37 MB, the committed library
#   make course-export EXCLUDE=restart  # 151 MB, draws its surfaces without re-running
#   make course-export EXCLUDE=         # everything, restart files included
EXCLUDE ?= restart,setup_reports,grids
COURSE_PROJECT ?= $(ROOT)/.scratch/course-runs/course
COURSE_EXAMPLE ?= $(ROOT)/examples/cppaw-handson-course

course-export:
	@test -f "$(COURSE_PROJECT)/project.json" \
	  || { echo "no course project at $(COURSE_PROJECT) -- see docs/course/inventory.md"; exit 1; }
	rm -rf "$(COURSE_EXAMPLE)"
	cd backend && PYTHONPATH=$(ROOT)/backend/src $(PY) -m atomscope.project.export_cli \
	  "$(COURSE_PROJECT)" "$(COURSE_EXAMPLE)" --exclude "$(EXCLUDE)"

# Performance harness (see docs/performance.md). Results go to .scratch/bench/.
bench:
	cd backend && PYTHONPATH=$(ROOT)/backend/src $(PY) -m benchmarks.run --quick

bench-full:
	cd backend && PYTHONPATH=$(ROOT)/backend/src $(PY) -m benchmarks.run --full

# Renderer benchmark; needs dev-backend and dev-frontend running.
test-perf:
	cd frontend && ATOMSCOPE_PERF=1 pnpm exec playwright test
