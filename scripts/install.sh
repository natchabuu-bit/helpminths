#!/usr/bin/env bash
set -euo pipefail
cd /workspace/helpminths
npm ci --cache /tmp/helpminths-npm-cache --no-audit --no-fund
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --cache-dir /tmp/helpminths-pip-cache -r backend/requirements.lock
npm run build
.venv/bin/python -m pytest backend/tests -q
