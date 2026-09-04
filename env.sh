# Source this file to keep every tool cache inside the project (see docs/architecture/security-model.md).
export PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export UV_CACHE_DIR="$PROJECT_ROOT/.uv-cache"
export UV_PYTHON_PREFERENCE=only-system
export npm_config_cache="$PROJECT_ROOT/.npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_ROOT/.playwright-browsers"
export ATOMSCOPE_DATA_DIR="$PROJECT_ROOT/app-data"
export UV_PROJECT_ENVIRONMENT="$PROJECT_ROOT/.venv"
