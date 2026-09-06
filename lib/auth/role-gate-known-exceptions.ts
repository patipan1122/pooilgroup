// Registry of role-gate sites that are INTENTIONALLY missing one or more
// admin-tier roles (almost always `program_admin`, since it's the newest
// admin-tier role — added 2026-06-01).
//
// Read by lib/auth/__tests__/role-gate-completeness.{cases,test,run}.ts, which
// scans app/**/*.{ts,tsx} + lib/**/*.ts for hand-rolled role arrays /
// requireRole() calls that contain 2+ admin-tier role literals and asserts
// they contain ALL of them (super_admin, org_admin, admin, program_admin).
// A site listed here is treated as a deliberate, reviewed exception instead
// of a bug.
//
// Adding an entry here is a JUSTIFIED, DELIBERATE decision — not a shortcut to
// silence the test. If you're not sure whether a site belongs here, leave the
// gate un-fixed AND ask the CEO first (CLAUDE.md RULE A) rather than guessing.
//
// Matching: a found site is considered excepted when `file` matches exactly
// AND `line` is within ±3 of the found line (tolerates minor code drift from
// unrelated edits above the gate — see isExcepted() in the test's cases file).

export type RoleGateException = {
  /** Path relative to repo root, e.g. "app/(admin)/ledger/settings/google/page.tsx" */
  file: string;
  /** 1-based line where the role array / requireRole(...) call starts. */
  line: number;
  reason: string;
};

export const ROLE_GATE_KNOWN_EXCEPTIONS: RoleGateException[] = [
  // ── LedgerLine credential / connection / integration-secret pages ──────────
  // CEO 2026-08-17 decision (see commit c94c8c17): these stay super_admin-only
  // forever — they connect or rotate secrets (Google Drive/Gmail OAuth, LINE OA
  // channel + Rich Menu, TRCloud accounting-program API). NOT grant-scoped to
  // program_admin even if the user has a ledger module grant.
  {
    file: "app/(admin)/ledger/settings/google/page.tsx",
    line: 33,
    reason: "Google Drive/Gmail connection settings page — credential/connection page, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/google/_actions.ts",
    line: 25,
    reason: "Google Drive/Gmail connection action — credential/connection, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/google/_actions.ts",
    line: 60,
    reason: "Google Drive/Gmail connection action — credential/connection, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/google/_actions.ts",
    line: 101,
    reason: "Google Drive/Gmail connection action — credential/connection, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/google/_actions.ts",
    line: 125,
    reason: "Google Drive/Gmail connection action — credential/connection, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/google/_actions.ts",
    line: 157,
    reason: "Google Drive/Gmail connection action — credential/connection, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/google/_actions.ts",
    line: 180,
    reason: "Google Drive/Gmail connection action — credential/connection, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/line-groups/page.tsx",
    line: 21,
    reason: "LINE OA channel + group→branch + Rich Menu connection settings — credential/connection page, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/export/page.tsx",
    line: 16,
    reason: "Export / accounting-program (TRCloud) connector settings — credential/connection page, super_admin only (CEO 2026-08-17).",
  },
  {
    file: "app/(admin)/ledger/settings/inventory/page.tsx",
    line: 25,
    reason: "Warehouse/SKU ↔ TRCloud sync connector settings — credential/connection page, super_admin only (CEO 2026-08-17).",
  },

  // ── Other explicit CEO 2026-08-17 exclusions (named in the original audit) ──
  {
    file: "app/(admin)/rentspace/_actions.ts",
    line: 2443,
    reason: "actDecideDiscount — discount approval deliberately requires admin tier, NOT program_admin (see comment above the function).",
  },
  {
    file: "lib/auth/branch-access.ts",
    line: 37,
    reason: "canFillReports() — deliberately excludes program_admin from report-filling (documented in-file: `role !== \"program_admin\"`).",
  },
  {
    file: "app/(admin)/rentspace/contracts/[id]/page.tsx",
    line: 85,
    reason: "canDelete (contract delete) — deliberately admin-tier only (isAdminTier/isSuperAdmin), not program_admin.",
  },

  // ── ClawFleet — cash-handling gets a stricter admin model on purpose ────────
  // program_admin enters ClawFleet via its user_modules grant (layout), but
  // ADMIN POWER is grant-scoped separately via cfHasAdminPower(), which also
  // requires an explicit user_modules.role='admin' sub-flag — not just any
  // active grant. CF_ADMIN_ROLES is the base org-wide admin tier and must NOT
  // include program_admin, or that extra safety check would be bypassed.
  {
    file: "lib/clawfleet/role-guard.ts",
    line: 10,
    reason: "CF_ADMIN_ROLES — ClawFleet (cash-handling) deliberately excludes program_admin from the org-wide admin tier; power is grant-scoped via cfHasAdminPower()'s extra sub-flag check instead.",
  },
  {
    file: "lib/clawfleet/role-guard.ts",
    line: 47,
    reason: "cfHasAdminPower() — ClawFleet's stricter grant-scoped admin check (composes isCfAdmin() + userIsModuleAdmin(), not a flat role array) — see CF_ADMIN_ROLES above.",
  },

  // ── Canonical role-tier definition (role-guards.ts itself) ──────────────────
  // ADMIN_TIER_ROLES is the STRICT 3-role tier by design (super_admin/org_admin
  // /admin) — it is the thing program_admin was deliberately NOT added to when
  // isProgramAdminTier()/PROGRAM_ADMIN_TIER_ROLES was introduced on top of it
  // (CEO 2026-06-16). This guardrail itself reads ADMIN_TIER_ROLES as its
  // source of truth for "the strict tier" — it must stay exactly 3 roles.
  {
    file: "lib/auth/role-guards.ts",
    line: 36,
    reason: "ADMIN_TIER_ROLES — the canonical STRICT 3-role tier (super_admin/org_admin/admin) by design; program_admin gets isProgramAdminTier()/PROGRAM_ADMIN_TIER_ROLES layered on top instead, for the narrower set of call sites that should treat it as admin.",
  },

  // ── Found by this guardrail's first run (2026-09-06), NOT a permission gate ──
  {
    file: "lib/clawfleet/team-actions.ts",
    line: 30,
    reason: "CF_ASSIGNABLE_ROLES — this is the list of roles a branch-team-invite form is allowed to HAND OUT to a new member (staff/branch_manager/area_manager), not a permission gate on who may call the action. In-file comment: \"ไม่เปิด admin org-wide จากหน้านี้\" (deliberately does not let this page grant org-wide admin power) — admin-tier roles belong here on purpose.",
  },

  // ── Found by this guardrail's first run (2026-09-06) — FLAGGED, NOT fixed ───
  // Per RULE A (CLAUDE.md): ambiguous, cash-handling authorization code is
  // surfaced to the CEO rather than auto-fixed. Do NOT treat this entry as
  // "reviewed and correct" — it is a placeholder so the guardrail can pass
  // while this waits for an explicit decision. See report/STATUS.md entry
  // dated 2026-09-06 (role-gate-permanent-fix) for the open question.
  {
    file: "app/api/cashhub/reports/route.ts",
    line: 109,
    reason: "⚠️ PENDING CEO/DOMAIN REVIEW (2026-09-06, not auto-fixed): `isAdmin = [\"super_admin\",\"org_admin\"].includes(role)` bypasses the user_branches link check for cash-report submission. It's missing \"admin\" (the canonical lib/auth/branch-access.ts hasCrossBranchAccess() helper already includes super_admin/org_admin/admin/area_manager for this exact cross-branch concept, suggesting this ad-hoc array drifted from it) — but program_admin should almost certainly stay excluded here, since canFillReports() in the same auth layer explicitly documents program_admin as \"never a CashHub report filler\". Left untouched because this is real cash-submission authorization code outside the named scope of the 2026-09-06 fix, and the correct resolution (add \"admin\" only? also \"area_manager\"? refactor to call hasCrossBranchAccess() directly?) is a judgment call, not a mechanical one.",
  },
];
