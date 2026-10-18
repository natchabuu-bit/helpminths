#!/usr/bin/env bash
set -euo pipefail
cd /workspace/helpminths
if [[ ! -x .venv/bin/python || ! -d node_modules ]]; then
  printf '%s\n' 'Run bash scripts/install.sh before starting HelpMinths.' >&2
  exit 1
fi
api_pid=''
web_pid=''
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$api_pid" ]] || kill "$api_pid" 2>/dev/null || true
  [[ -z "$web_pid" ]] || kill "$web_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
api_pid=$!
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort &
web_pid=$!
wait -n "$api_pid" "$web_pid"
