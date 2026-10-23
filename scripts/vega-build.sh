#!/usr/bin/env bash
# Builds the Vega app from a copy of the source in a path WITHOUT spaces.
# The Vega JS-bundling step (react-native build-vega) does not quote paths, so a
# repo under a folder whose name contains a space fails with "/bin/sh: /Users/.../My: No such file".
# Usage: scripts/vega-build.sh [Release|Debug]   (needs Node >= 20 and the vega CLI on PATH)
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${VEGA_BUILD_DIR:-$HOME/vega-build}"
BUILD_TYPE="${1:-Release}"

case "$DEST" in *" "*) echo "VEGA_BUILD_DIR must not contain spaces: $DEST" >&2; exit 1;; esac
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then echo "Node >= 20 required (found $(node --version))" >&2; exit 1; fi

mkdir -p "$DEST/shared" "$DEST/vega"
rsync -a --delete --exclude node_modules --exclude build --exclude .tmp "$SRC/packages/shared/" "$DEST/shared/"
rsync -a --delete --exclude node_modules --exclude build --exclude .tmp "$SRC/packages/vega/" "$DEST/vega/"

cd "$DEST/vega"
[ -f src/config.local.ts ] || { cp src/config.example.ts src/config.local.ts; echo "created src/config.local.ts from the example: set API_BASE_URL to this machine's LAN address"; }
[ -d node_modules ] || npm install --no-audit --no-fund
npx react-native build-vega --build-type "$BUILD_TYPE"
vega build --buildType "$BUILD_TYPE" --include-js-bundle=true

echo "Built: $(ls "$DEST"/vega/build/*/*.vpkg | tr '\n' ' ')"
