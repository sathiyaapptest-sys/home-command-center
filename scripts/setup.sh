#!/usr/bin/env bash
# One-time setup: installs dependencies and creates local config with freshly generated
# random secrets. Nothing here needs an AWS account. Requires Node.js 20.12 or newer.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node_ok() { node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=12)?0:1)'; }
node_ok || { echo "Node.js 20.12 or newer is required (found $(node --version))." >&2; exit 1; }

for dir in backend packages/shared packages/mcp-server packages/web; do
  echo "== installing $dir"
  (cd "$ROOT/$dir" && npm install --no-audit --no-fund)
done

rand() { openssl rand -hex "$1"; }

if [ ! -f "$ROOT/backend/.env" ]; then
  printf 'DEVICE_KEY=%s\n' "$(rand 24)" > "$ROOT/backend/.env"
  chmod 600 "$ROOT/backend/.env"
  echo "created backend/.env (device key for ESP32 nodes)"
fi

if [ ! -f "$ROOT/packages/mcp-server/.env" ]; then
  cat > "$ROOT/packages/mcp-server/.env" << ENV
PUBLIC_URL=http://localhost:4100
OAUTH_CLIENT_ID=command-center-alexa
OAUTH_CLIENT_SECRET=$(rand 20)
OWNER_PASSCODE=$(rand 6)
PORT=4100
BACKEND_URL=http://localhost:4000
OAUTH_REDIRECT_URIS=http://127.0.0.1/assistant-callback
ENV
  chmod 600 "$ROOT/packages/mcp-server/.env"
  echo "created packages/mcp-server/.env (random OAuth client secret and owner passcode)"
fi

echo "== building the web UI"
(cd "$ROOT/packages/web" && npm run build)

echo
echo "Setup done. Start everything with: scripts/start.sh"
