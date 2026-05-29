#!/usr/bin/env bash
#
# ChairOps Wave 0 · one-shot apply migration + push to main
# CEO ran 2026-05-27 after Claude's auto-classifier blocked the same actions.
#
# What it does:
#   1. Apply supabase/migrations/20260527130540_chairops_w0.sql to prod Supabase
#      via DIRECT_URL (port 5432, not pooler). Migration is transactional with
#      ON_ERROR_STOP=1, so any failure rolls back atomically.
#   2. Push current main HEAD to origin so Vercel auto-deploys.
#   3. Curl-check the 4 known-affected prod pages and print HTTP status.
#
# Usage from project root:
#   bash scripts/apply-chairops-w0-and-deploy.sh
#
# Pre-reqs (already true on CEO's Mac):
#   - .env.local has DIRECT_URL pointing at prod Supabase
#   - psql + git on PATH (Homebrew)
#   - Logged into the right origin remote

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Step 1/3 · Applying Wave 0 migration to prod Supabase"
echo "    file: supabase/migrations/20260527130540_chairops_w0.sql"
echo ""

# shellcheck disable=SC1091
source .env.local

psql "$DIRECT_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260527130540_chairops_w0.sql

echo ""
echo "==> Step 1 complete · migration applied"
echo ""

echo "==> Step 2/3 · Pushing main to origin (Vercel auto-deploys)"
git push origin main
echo ""
echo "==> Step 2 complete · waiting 90s for Vercel deploy"
sleep 90

echo ""
echo "==> Step 3/3 · Curl-checking 4 affected prod pages"
for path in /chairops/collections /chairops/alerts /chairops/pos-ingest/new /chairops/reconcile; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://pooilgroup.vercel.app${path}")
  printf "  %s %s\n" "$code" "$path"
done

echo ""
echo "==> All done · expected: every line shows 307 (redirect to /login is normal for unauthed) — not 500"
