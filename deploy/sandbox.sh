#!/usr/bin/env bash
# Start a local Canton sandbox with the CompressRail DAR and the JSON Ledger API.
#
# Prerequisites: the Daml 3.5.x toolchain (DPM) on PATH, and a built DAR
# (cd daml && dpm build). Ports are configurable via environment variables.
#
# Usage:
#   deploy/sandbox.sh
# then, in another shell, run the end-to-end check:
#   cd app && E2E_LEDGER_URL=http://localhost:${JSON_API_PORT:-7575} npm run e2e
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAR="$ROOT/daml/.daml/dist/compressrail-0.0.1.dar"

JSON_API_PORT="${JSON_API_PORT:-7575}"
LEDGER_API_PORT="${LEDGER_API_PORT:-6865}"
ADMIN_API_PORT="${ADMIN_API_PORT:-6866}"

if [ ! -f "$DAR" ]; then
  echo "DAR not found at $DAR" >&2
  echo "Build it first:  (cd daml && dpm build)" >&2
  exit 1
fi

exec dpm sandbox \
  --json-api-port "$JSON_API_PORT" \
  --ledger-api-port "$LEDGER_API_PORT" \
  --admin-api-port "$ADMIN_API_PORT" \
  --dar "$DAR"
