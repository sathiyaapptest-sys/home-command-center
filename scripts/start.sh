#!/usr/bin/env bash
# Starts the backend (:4000), the MCP server (:4100) and the web assistant (:4200).
# Press Ctrl+C to stop all three. Logs go to .run/*.log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/.run"
pids=()

start() {
  local name="$1" dir="$2"; shift 2
  (cd "$ROOT/$dir" && exec "$@" > "$ROOT/.run/$name.log" 2>&1) &
  pids+=("$!")
}
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

start backend   backend            ./node_modules/.bin/ts-node-dev --transpile-only src/server.ts
sleep 4
start mcp       packages/mcp-server ./node_modules/.bin/tsx src/server.ts
sleep 3
start assistant packages/web        ./node_modules/.bin/tsx server/index.ts
sleep 3

echo "Backend    http://localhost:4000/health"
echo "MCP server http://localhost:4100/health   (MCP endpoint: /mcp)"
echo "Assistant  http://127.0.0.1:4200          <- open this in a browser"
echo "Logs: $ROOT/.run/   (Ctrl+C to stop)"
wait
