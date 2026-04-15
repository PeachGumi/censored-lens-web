#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
STAGE_DIR="$DEPLOY_DIR/cloudflare-pages"
ZIP_PATH="$DEPLOY_DIR/censored-lens-web-cloudflare.zip"
HISTORY_DIR="$DEPLOY_DIR/history"
KEEP_COUNT=5

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
mkdir -p "$HISTORY_DIR"

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

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")-$$"
HISTORY_ZIP_PATH="$HISTORY_DIR/censored-lens-web-cloudflare-$TIMESTAMP.zip"
cp "$ZIP_PATH" "$HISTORY_ZIP_PATH"

# Keep only the latest N deploy archives in history.
archive_count=0
while IFS= read -r archive_zip; do
  ((archive_count += 1))
  if (( archive_count > KEEP_COUNT )); then
    rm -f "$archive_zip"
  fi
done < <(ls -1t "$HISTORY_DIR"/censored-lens-web-cloudflare-*.zip 2>/dev/null || true)

echo "[OK] Created: $ZIP_PATH"
echo "[INFO] Archived: $HISTORY_ZIP_PATH"
echo "[INFO] Staging directory: $STAGE_DIR"
unzip -l "$ZIP_PATH"
