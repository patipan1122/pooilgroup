#!/usr/bin/env bash
# setup-worktrees.sh — create one git worktree per Pool module for parallel Claude sessions
# Idempotent: skips worktrees that already exist.
# Run from anywhere — uses absolute paths.
#
# Usage:
#   bash docs/scripts/setup-worktrees.sh           # creates all
#   bash docs/scripts/setup-worktrees.sh playland  # only one module
#   POOL_NPM_INSTALL=1 bash docs/scripts/setup-worktrees.sh  # also runs npm install (slow)
#
# See: docs/MODULE_GUIDE.md (section 5)

set -euo pipefail

POOL_REPO="${POOL_REPO:-/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web}"
WT_DIR="${WT_DIR:-/Users/patipantantikul/Code/pooilgroup/legacy/worktrees}"
MODULES="${*:-cashhub clawfleet chairops docuflow inbox playland recruit repairs}"

if [ ! -d "$POOL_REPO/.git" ] && [ ! -f "$POOL_REPO/.git" ]; then
  echo "❌ POOL_REPO not a git repo: $POOL_REPO" >&2
  exit 1
fi

mkdir -p "$WT_DIR"

for M in $MODULES; do
  WT="$WT_DIR/pool-$M"
  BR="claude/$M-work"
  if [ -d "$WT" ]; then
    CUR="$(git -C "$WT" branch --show-current 2>/dev/null || echo unknown)"
    echo "[$M] worktree already exists at $WT (branch: $CUR) — skipping"
    continue
  fi
  # try to add on the existing branch (if user already has one), else create new
  if git -C "$POOL_REPO" rev-parse --verify "$BR" >/dev/null 2>&1; then
    git -C "$POOL_REPO" worktree add "$WT" "$BR" 2>&1 | sed "s/^/[$M] /"
  else
    git -C "$POOL_REPO" worktree add "$WT" -b "$BR" 2>&1 | sed "s/^/[$M] /"
  fi
  if [ "${POOL_NPM_INSTALL:-0}" = "1" ]; then
    echo "[$M] running npm install (may take a few minutes)…"
    (cd "$WT" && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3 | sed "s/^/[$M]   /")
    echo "[$M] running prisma generate…"
    (cd "$WT" && npx prisma generate 2>&1 | tail -1 | sed "s/^/[$M]   /")
  fi
done

echo ""
echo "=== final worktree map ==="
git -C "$POOL_REPO" worktree list

cat <<EOF

✅ Done.

Next steps:
  1. Open VS Code for each worktree:
       code $WT_DIR/pool-clawfleet
       code $WT_DIR/pool-playland
       …
  2. In each Claude session, set scope:
       /goal ทำเฉพาะ <slug> ห้ามแตะอย่างอื่น
  3. First time entering a worktree, if you skipped npm install above:
       cd $WT_DIR/pool-<slug>
       npm install
       npx prisma generate
EOF
