#!/usr/bin/env bash
set -euo pipefail

# Build the React editor for its public /app/tech180/ address. These are all
# public browser settings; private server keys never belong in this build.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TECH180_DIR="$(cd "${PLATFORM_DIR}/../../Tech180" && pwd)"
DIST_DIR="${PLATFORM_DIR}/dist"
API_URL="${TECH180_PUBLIC_API_URL:-https://ji-tech180-api-553979127849.us-east4.run.app}"

cd "${TECH180_DIR}/frontend"
PUBLIC_URL=/app/tech180 \
GENERATE_SOURCEMAP=false \
REACT_APP_API_BASE="${API_URL}" \
REACT_APP_SUPABASE_URL="https://hecteqqrkjchdhvdkuxs.supabase.co" \
REACT_APP_SUPABASE_PUBLISHABLE_KEY="sb_publishable_8Nc78Pxi99_M3Rs3kuKSHw_H6GBKpaR" \
REACT_APP_GATEWAY_URL="https://jisystems.net/app/gateway/?tool=tech180" \
npm run build

# Copy only deployable site content. Source notes, SQL, and scripts stay out of
# the public package even though they remain in the private development repo.
mkdir -p "${DIST_DIR}"
rsync -a --delete --delete-excluded \
  --exclude '.DS_Store' \
  --exclude '.gitignore' \
  --exclude '.env*' \
  --exclude 'backend/' \
  --exclude 'cloudbuild.yaml' \
  --exclude 'dist/' \
  --exclude 'scripts/' \
  --exclude 'supabase/' \
  --exclude '*.zip' \
  --exclude '*.md' \
  "${PLATFORM_DIR}/" "${DIST_DIR}/"

mkdir -p "${DIST_DIR}/app/tech180"
rsync -a --delete "${TECH180_DIR}/frontend/build/" "${DIST_DIR}/app/tech180/"

echo "Platform package ready: ${DIST_DIR}"
