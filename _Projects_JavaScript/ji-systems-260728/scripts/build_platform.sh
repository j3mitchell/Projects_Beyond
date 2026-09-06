#!/usr/bin/env bash
set -euo pipefail

# Build the React editor for its public /app/tech180/ address. These are all
# public browser settings; private server keys never belong in this build.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TECH180_DIR="$(cd "${PLATFORM_DIR}/../../Tech180" && pwd)"
RESUMEATS_DIR="$(cd "${PLATFORM_DIR}/../../ResumeATS" && pwd)"
DIST_DIR="${PLATFORM_DIR}/dist"
API_URL="${TECH180_PUBLIC_API_URL:-https://api.jisystems.net}"
RESUMEATS_API_URL="${RESUMEATS_PUBLIC_API_URL:?Set RESUMEATS_PUBLIC_API_URL to the deployed ResumeATS Cloud Run URL}"

cd "${TECH180_DIR}/frontend"
npm ci --ignore-scripts
npm audit --omit=dev
VITE_BASE="/app/tech180/" \
VITE_API_BASE="${API_URL}" \
VITE_SUPABASE_URL="https://hecteqqrkjchdhvdkuxs.supabase.co" \
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_8Nc78Pxi99_M3Rs3kuKSHw_H6GBKpaR" \
VITE_GATEWAY_URL="https://jisystems.net/app/gateway/?tool=tech180" \
npm run build

cd "${RESUMEATS_DIR}/frontend"
npm ci --ignore-scripts
PUBLIC_URL="/app/resumeats" \
REACT_APP_API_BASE="${RESUMEATS_API_URL}" \
REACT_APP_SUPABASE_URL="https://hecteqqrkjchdhvdkuxs.supabase.co" \
REACT_APP_SUPABASE_PUBLISHABLE_KEY="sb_publishable_8Nc78Pxi99_M3Rs3kuKSHw_H6GBKpaR" \
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

mkdir -p "${DIST_DIR}/app/resumeats"
rsync -a --delete "${RESUMEATS_DIR}/frontend/build/" "${DIST_DIR}/app/resumeats/"

# Keep authentication critical-path code local to the deployed platform so an
# external CDN cannot leave the protected administration screen inert.
mkdir -p "${DIST_DIR}/assets/vendor"
cp "${TECH180_DIR}/frontend/node_modules/@supabase/supabase-js/dist/umd/supabase.js" \
  "${DIST_DIR}/assets/vendor/supabase.js"

echo "Platform package ready: ${DIST_DIR}"
