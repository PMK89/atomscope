#!/bin/bash
# Reproducible developer setup: everything lands inside the repository (see env.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source env.sh
command -v uv >/dev/null || { echo "uv is required (https://docs.astral.sh/uv/); install it or use 'pip install uv' in a local venv"; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required (corepack enable pnpm)"; exit 1; }
echo "== backend (uv sync into $UV_PROJECT_ENVIRONMENT)"
(cd backend && uv sync --extra dev)
echo "== frontend (pnpm install, store in .pnpm-store)"
(cd frontend && pnpm install --frozen-lockfile)
echo "== Playwright Chromium (project-local, optional)"
(cd frontend && pnpm exec playwright install chromium) || echo "playwright browser install skipped"
echo "== CP-PAW"
if [ -n "${PAWDIR:-}" ] || [ -x "$HOME/cp-paw/bin/fast/paw_fast.x" ]; then
  echo "paw_fast.x found; the plugin probes the runtime at first launch"
else
  echo "paw_fast.x not found: set ATOMSCOPE_CPPAW_DIR to a CP-PAW installation to enable the CP-PAW backend"
fi
echo "done. Run: make dev-backend  and  make dev-frontend"
