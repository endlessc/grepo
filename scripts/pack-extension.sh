#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT_DIR/extension"
DIST_DIR="$ROOT_DIR/dist"

VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version)" "$EXT_DIR/manifest.json")"
OUT_ZIP="$DIST_DIR/grepo-chrome-v${VERSION}.zip"

mkdir -p "$DIST_DIR"
rm -f "$OUT_ZIP"

(
  cd "$EXT_DIR"
  zip -r -9 "$OUT_ZIP" . \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x "*.map"
)

echo "✓ Packed Chrome extension: $OUT_ZIP"
unzip -l "$OUT_ZIP"
