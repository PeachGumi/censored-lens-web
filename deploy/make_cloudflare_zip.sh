#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
STAGE_DIR="$DEPLOY_DIR/cloudflare-pages"
ZIP_PATH="$DEPLOY_DIR/censored-lens-web-cloudflare.zip"

REQUIRED_PATHS=(
  "index.html"
  "app.js"
  "styles.css"
  "README.md"
  "models"
  "materials"
)

cd "$PROJECT_ROOT"

for path in "${REQUIRED_PATHS[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "[ERROR] Missing required path: $path" >&2
    exit 1
  fi
done

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

cp index.html "$STAGE_DIR/"
cp app.js "$STAGE_DIR/"
cp styles.css "$STAGE_DIR/"
cp README.md "$STAGE_DIR/"
cp -R models "$STAGE_DIR/"
cp -R materials "$STAGE_DIR/"

# Remove macOS metadata files if present.
find "$STAGE_DIR" -name '.DS_Store' -delete

rm -f "$ZIP_PATH"
(
  cd "$STAGE_DIR"
  zip -r "$ZIP_PATH" . > /dev/null
)

echo "[OK] Created: $ZIP_PATH"
echo "[INFO] Staging directory: $STAGE_DIR"
unzip -l "$ZIP_PATH"
