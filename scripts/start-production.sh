#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f dist/index.html ]]; then
  printf '%s\n' 'Frontend build missing. Run npm run build before starting production.' >&2
  exit 1
fi
if [[ ! -x .venv/bin/python ]]; then
  printf '%s\n' 'Python environment missing. Run bash scripts/install.sh first.' >&2
  exit 1
fi
export HELPMINTHS_SERVE_WEB=1
exec .venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
