#!/bin/bash
# Restart the development backend on 127.0.0.1:8765 (log: .scratch/dev/backend.log).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/env.sh"
pkill -f "python -m atomscope.api.server" 2>/dev/null
sleep 1
mkdir -p "$ROOT/.scratch/dev"
cd "$ROOT/backend" && nohup "$ROOT/.venv/bin/python" -m atomscope.api.server --port 8765 > "$ROOT/.scratch/dev/backend.log" 2>&1 &
sleep 4
curl -s http://127.0.0.1:8765/api/health && echo
