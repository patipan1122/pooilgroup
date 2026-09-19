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
    line: 2655,
    // 2026-09-19: line corrected from 2443 → 2655 (drifted 212 lines past the
    // ±3 tolerance from earlier unrelated edits to this file — found during
    // the Part 4/5 guardrail-extension audit; without this fix the CI guard
    // would have spuriously re-flagged this already-reviewed, deliberate
    // exception as a brand-new gap).
    reason: "actDecideDiscount — discount approval deliberately requires admin tier, NOT program_admin (see comment above the function).",
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 2026-09-19 — Part 4/5 of the CashHub program_admin full-fix. The guardrail
  // was extended (Pattern C) to flag every isSuperAdmin()/requireSuperAdmin()/
  // isAdminTier()/requireAdminTier() CALL SITE inside a scanned module dir —
  // not just role-array literals. This surfaced 149 sites repo-wide. Each is
  // classified below into: (a) MODULE-ENTRY GATE — confirmed-correct by
  // role-guards.ts's own explicit design (never a judgment call), (b) an
  // established strict-module precedent (CostCtrl), (c) auto-fixed because it
  // is unambiguously the same "forgotten program_admin" bug already fixed in
  // Part 1, or (d) ⚠️ PENDING CEO REVIEW because it's a genuine judgment call
  // (credential/connection, deletion, approval-separation, cash-handling, or
  // anything not confidently classifiable) — per CLAUDE.md RULE A, ambiguous
  // security-sensitive gates are surfaced to the CEO, not guessed at.
  //
  // 2026-09-19 UPDATE: CEO reviewed and decided every (d) site below. Most are
  // "✅ CEO CONFIRMED 2026-09-19 — keep excluded" (no code change). A handful
  // were opened to program_admin instead and had their exception entries
  // removed entirely (CashHub reports, Recruit channel delete/toggle,
  // RentSpace bulk import, ChairOps branch close/reopen, all DC deletion/
  // reverse-receipt gates) — see the 2026-09-19 program-admin-full-fix
  // (part 2) report for the full decision list.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── MODULE-ENTRY GATES ("which programs can I enter") — confirmed-correct,
  // NOT a judgment call. role-guards.ts's own comment on isAdminTier/
  // isProgramAdminTier explicitly forbids loosening this exact gate: "ห้ามใช้
  // ตัวนี้ที่ด่าน 'เข้าโปรแกรมไหนได้บ้าง' (loadUserModules / userHasModuleAccess /
  // assertModuleEnabled) — ตรงนั้นต้องคง isAdminTier ไว้ ไม่งั้น program_admin จะเข้าได้
  // ทุกโปรแกรมแม้ไม่ถูกติ๊กสิทธิ์ (ทะลุระบบ)". Every site below follows the same
  // repo-wide idiom: `if (!isAdminTier(role)) { check userHasModuleAccess(...)
  // as the program_admin-inclusive fallback; if that also fails, redirect/403 }`
  // — program_admin already gets in via its own module-grant check, just not
  // via this specific role comparison. Verified by direct read, not a guess.
  { file: "app/(admin)/cashhub/layout.tsx", line: 29, reason: "Module-entry gate (isAdminTier) — program_admin enters via userHasModuleAccess() fallback in the same if-block, per role-guards.ts's own design (see block comment above)." },
  { file: "lib/cashhub/api-guard.ts", line: 59, reason: "\"Admin tier bypasses entitlement check (mirrors module-access.userHasModuleAccess)\" — same module-entry idiom as layout.tsx, for API routes that don't go through the layout." },
  { file: "app/(admin)/chairops/layout.tsx", line: 35, reason: "Module-entry gate (isAdminTier) — same repo-wide idiom, userHasModuleAccess(\"chairops\") fallback." },
  { file: "app/(admin)/dc/layout.tsx", line: 25, reason: "Module-entry gate (isAdminTier) — same repo-wide idiom, userHasModuleAccess(\"dc\") fallback." },
  { file: "app/(admin)/inbox/layout.tsx", line: 23, reason: "Module-entry gate (isAdminTier) — same repo-wide idiom, userHasModuleAccess(\"inbox\") fallback." },
  { file: "app/(admin)/recruit/layout.tsx", line: 26, reason: "Module-entry gate (isAdminTier) — same repo-wide idiom, userHasModuleAccess(\"recruit\") fallback." },
  { file: "app/(admin)/playland/layout.tsx", line: 27, reason: "Module-entry gate (isAdminTier) — same repo-wide idiom, userHasModuleAccess(\"playland\") fallback." },
  { file: "app/(admin)/repairs/layout.tsx", line: 20, reason: "Module-entry gate (isAdminTier) — same repo-wide idiom, userHasModuleAccess(\"repairs\") fallback." },
  { file: "app/(admin)/docuflow/layout.tsx", line: 27, reason: "Module-entry gate (isAdminTier) — same repo-wide idiom, userHasModuleAccess(\"docuflow\") fallback." },
  { file: "app/(admin)/cafeorder/layout.tsx", line: 27, reason: "Module-entry gate (isAdminTier) — same repo-wide idiom, userHasModuleAccess(\"cafeorder\") fallback." },
  { file: "app/(admin)/clawfleet/os/layout.tsx", line: 22, reason: "Module-entry gate (isAdminTier) — same idiom, plus a self-heal branch for claw-machine-assigned staff; not a role-array/permission bug." },

  // ── CostCtrl — deliberately the ONE module role-guards.ts's own JSDoc names
  // as requireSuperAdmin's intended use case: "Strictest gate — super_admin
  // only. Used by the CostCtrl module (CEO-only cost dashboard) where even
  // org_admin / admin must NOT see provider tokens, monthly spend, or budget
  // rules." This is not ambiguous — it's the documented reason the function
  // exists — so the entire module stays excluded, not just the entry gate.
  { file: "app/(admin)/costctrl/layout.tsx", line: 19, reason: "requireSuperAdmin — CostCtrl is role-guards.ts's own documented use case for this function (CEO-only cost dashboard; provider tokens/spend/budget must stay hidden from org_admin/admin too, not just program_admin)." },
  { file: "app/(admin)/costctrl/_actions.ts", line: 15, reason: "Same CostCtrl CEO-only boundary as layout.tsx above — see role-guards.ts's requireSuperAdmin JSDoc." },

  // ── CashHub — TRCloud/accounting-program connection family. All 4 revenue
  // channels' "send to INTERNAL reconcile" + "settings" actions were opened to
  // program_admin in Part 1 of this fix (2026-09-19) — but each channel ALSO
  // has a separate, more sensitive "create/push a real tax invoice (IV) INTO
  // TRCloud" action, and (for Amazon) a "search/add/delete a TRCloud branch
  // mapping" action. These write real accounting/tax documents or GL account
  // mappings into the external accounting program — already explicitly
  // policy-locked to super_admin by in-file comments predating this fix (e.g.
  // amazon-branch/save: "ตาม super_admin-only connection gating", amazon-import/
  // push: "ตาม super_admin-only connection gating D-022"), matching the exact
  // precedent already in this file for LedgerLine's TRCloud/Drive/LINE
  // connection pages. High confidence this should stay excluded, but per RULE A
  // this is exactly the "payment/credential" category that must go to the CEO
  // rather than be unilaterally blessed — marked ⚠️ PENDING for a quick
  // rubber-stamp, not because the reasoning is shaky.
  { file: "app/(admin)/cashhub/amazon/branches/page.tsx", line: 16, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — requireSuperAdmin — \"จัดการสาขา\" page searches TRCloud by name and pulls its GL account codes to add a new branch mapping (probeAmazonBranches). Recommend: keep super_admin-only, matching the LedgerLine TRCloud-connector precedent above." },
  { file: "app/(admin)/cashhub/amazon/page.tsx", line: 63, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — canManageTrcloud = isSuperAdmin(...) — gates the \"จัดการสาขา\" link + the \"สร้าง IV เข้า TRCloud\" / force-resend actions (decoupled from canSendReconcile in this same fix, which IS now program_admin-inclusive). Recommend: keep super_admin-only." },
    { file: "app/(admin)/cashhub/tea/page.tsx", line: 40, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — canManageTrcloud = isSuperAdmin(...) — gates TeaExcelGrid's \"ส่ง IV\" (create tax invoice in TRCloud) button (decoupled from canSendReconcile, which IS now program_admin-inclusive). Recommend: keep super_admin-only." },
  { file: "app/api/cashhub/amazon-branch/delete/route.ts", line: 17, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — deletes a custom Amazon-branch↔TRCloud GL mapping. Recommend: keep super_admin-only, matching amazon-branch/save's explicit in-file \"connection gating\" comment." },
  { file: "app/api/cashhub/amazon-branch/probe/route.ts", line: 13, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — searches TRCloud by branch name for GL account codes (probeAmazonBranches) — a live external accounting-system query. Recommend: keep super_admin-only." },
  { file: "app/api/cashhub/amazon-branch/save/route.ts", line: 19, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — in-file comment already states \"เรื่องนี้แตะ TRCloud (ออกใบกำกับ/ภาษี) → super_admin เท่านั้น ตาม super_admin-only connection gating\". Recommend: keep super_admin-only." },
  { file: "app/api/cashhub/amazon-import/push/route.ts", line: 21, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — in-file comment already states \"ส่งใบกำกับเข้า TRCloud = ลงบัญชี+ภาษีจริง → เฉพาะ super_admin (ตาม super_admin-only connection gating D-022)\" — creates a real tax invoice, has its own force/dedup-override path. Recommend: keep super_admin-only." },
  { file: "app/api/cashhub/tea/send-iv/route.ts", line: 19, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — in-file comment already states \"สร้าง IV ร้านชา ... super_admin เท่านั้น (สร้างเอกสารบัญชีจริง)\" — same TRCloud tax-document-creation family as Amazon's amazon-import/push. Recommend: keep super_admin-only." },

  // ── ALREADY-CORRECT-COMPOSED (Pattern C, 2026-09-19) — verified by direct read:
  // program_admin already passes via a userIsModuleAdmin()/module-admin-grant
  // fallback in the SAME function, so these are not bugs at all. Listed here
  // only because the bare isAdminTier()/isSuperAdmin() sub-expression is what
  // the regex-based scanner matches — it can't see the surrounding `||`/if-else
  // composition that already makes the gate program_admin-inclusive.
  { file: "lib/chairops/auth/session.ts", line: 110, reason: "poolIsAdmin = isAdminTier(role); grantedAdmin = poolIsAdmin || (await userIsModuleAdmin(user, \"chairops\")) — program_admin with a chairops grant already passes." },
  { file: "lib/clawhub/access.ts", line: 28, reason: "requireClawhubAdmin(): if (isAdminTier(role)) return session; immediately followed by a userIsModuleAdmin(user, \"clawhub\") fallback — same composed module-entry idiom as the layout.tsx files, just written as a helper function instead." },
  { file: "lib/chairops/reconcile/actions.ts", line: 170, reason: "toggleBranchClosedAction's isAdmin = isSuperAdmin(role) || (await userIsModuleAdmin(user,\"chairops\")) — opened to program_admin by CEO 2026-09-19; same composition already blessed at app/(admin)/rentspace/page.tsx:68's canEditPlan." },
  { file: "app/(admin)/chairops/(office)/reconcile/[branchId]/page.tsx", line: 99, reason: "canManage = isSuperAdmin(role) || (await userIsModuleAdmin(user,\"chairops\")) — UI mirror of toggleBranchClosedAction's gate above, opened to program_admin by CEO 2026-09-19." },

  // ── Not a real gate — comment-text false positive (2026-09-19) ─────────────
  // The regex scanner matches literal text, not AST — a code COMMENT that
  // happens to mention a function name followed by "(" reads as a call site.
  { file: "lib/clawfleet/repair-actions.ts", line: 40, reason: "Comment line explaining a design choice (\"ใช้ isSuperAdmin(role) ตรง ๆ ...\"), not an executable call — the real gate is assertSuperAdminOnly() at line 45 (see next entry)." },

  // ── LedgerLine — MODULE-ENTRY GATEs (confirmed-correct, not a judgment call) ─
  // Same repo-wide "if (!isAdminTier(role)) fall back to userHasModuleAccess()"
  // idiom as the layout.tsx files above, just written as a local gate()/base()
  // helper per file instead of a shared layout (LedgerLine has no single
  // app/(admin)/ledger/layout.tsx — each action-file/route defines its own).
  { file: "app/(admin)/ledger/_actions.ts", line: 96, reason: "requireLedgerAccess() — standard module-entry idiom used by nearly every action in this file." },
  { file: "app/(admin)/ledger/_ai-actions.ts", line: 54, reason: "gate() — standard module-entry idiom (canViewDashboard, the separate capability check above it, was fixed to isProgramAdminTier in this same round)." },
  { file: "app/(admin)/ledger/_bill-detail-action.ts", line: 81, reason: "Standard module-entry idiom guarding read-only bill detail fetch." },
  { file: "app/(admin)/ledger/_stockin-actions.ts", line: 45, reason: "base() — standard module-entry idiom (money/config gates layered on top separately)." },
  { file: "app/(admin)/ledger/ledger-book/_actions.ts", line: 36, reason: "gate() — standard module-entry idiom." },
  { file: "app/(admin)/ledger/reconcile/_actions.ts", line: 88, reason: "Standard module-entry idiom inside exportReconcileCsv; the actual export capability is the separate ledgerWebCanForRole check right after (already program_admin-inclusive as of this fix)." },
  { file: "app/api/ledger/expenses/route.ts", line: 23, reason: "gate() — standard module-entry idiom for the list/create-draft API route." },
  { file: "app/api/ledger/meta/route.ts", line: 24, reason: "Standard module-entry idiom guarding branch/category lookup." },
  { file: "app/api/ledger/ocr/route.ts", line: 29, reason: "Standard module-entry idiom guarding read-only OCR parse." },
  { file: "app/api/ledger/r2/presign/route.ts", line: 43, reason: "Standard module-entry idiom guarding presigned upload URL issuance." },
  { file: "app/api/ledger/vouchers/[type]/route.ts", line: 57, reason: "isAdminTier bypass for the userHasModuleAccess grant check; the actual accountant-tier capability check right before it already uses isProgramAdminTier, so program_admin correctly reaches this grant check as intended." },
  { file: "lib/ledger/actions.ts", line: 261, reason: "createDraftExpense — standard module-entry idiom." },
  { file: "lib/ledger/actions.ts", line: 609, reason: "updateExpense — standard module-entry idiom (capability check is the separate isAccountant(), already program_admin-inclusive since 2026-06-16)." },
  { file: "lib/ledger/actions.ts", line: 735, reason: "confirmExpense — standard module-entry idiom; in-file comment: \"mirror updateExpense / _actions.ts. Admin tier bypasses.\"" },
  { file: "lib/ledger/actions.ts", line: 805, reason: "confirmExpensesBulk — identical idiom/comment to line 735." },
  { file: "lib/ledger/actions.ts", line: 861, reason: "voidExpense — identical idiom, comment: \"grant-scoped (มิเรอร์ confirmExpense)\"." },
  { file: "lib/ledger/liff-auth.ts", line: 64, reason: "resolveLedgerActor()'s unconditional admin-tier bypass — deliberately narrow because the very next branch (line ~82) explicitly adds a grant-checked program_admin case right after; working exactly as role-guards.ts prescribes." },

  // ── LedgerLine — role-rank / admin-appointment guard (role-guards.ts's own
  // documented invariant: appointing/minting ANY admin-level role — incl.
  // ledger's own "admin" member-role concept — is reserved to super_admin,
  // exactly like ADMIN_LEVEL_ROLES / the "Admin-appointment guard" comment
  // block in role-guards.ts). Not a fresh judgment call — applying an existing
  // documented rule, so not marked pending.
  { file: "app/(admin)/ledger/_actions.ts", line: 2853, reason: "createLedgerInvite's admin-role sub-case — in-file tag [[role-rank-privilege-escalation-guard]]: minting an invite for ledger role \"admin\" requires super_admin; the base createLedgerInvite gate (userIsModuleAdmin, line 2841) is already program_admin-inclusive for non-admin invites." },
  { file: "app/(admin)/ledger/_actions.ts", line: 2966, reason: "createLedgerAdminInvite — mints a brand-new Pool user AND a ledger \"admin\" role in one step; same admin-appointment guard as line 2849, doc comment: \"Role-rank: only admin-tier may create it\"." },

  // ── LedgerLine — credential/connection (LINE OA channel, LINE Login identity
  // binding, Google Drive/Gmail OAuth, LINE Rich Menu) — same family as the
  // already-established LedgerLine Drive/Gmail/LINE-groups exceptions above,
  // just additional call sites this audit's Pattern C scan surfaced. ⚠️ PENDING
  // per RULE A even though confidence is high, since credential/connection is
  // explicitly named as a caution category, not a mechanical call. ──────────
  { file: "app/(admin)/ledger/_actions.ts", line: 2547, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — connectLineChannel — stores encrypted LINE OA channel secret/access token; error message \"เฉพาะเจ้าของระบบ (super admin) เชื่อมต่อ LINE ได้\"." },
  { file: "app/(admin)/ledger/_actions.ts", line: 2654, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — disconnectLineChannel — deletes the LINE OA channel row (same connection resource as line 2543)." },
  { file: "app/(admin)/ledger/_actions.ts", line: 2690, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — checkLineQuota — decrypts and calls out with the LINE channel access token to read message quota." },
  { file: "app/(admin)/ledger/_actions.ts", line: 2750, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — toggleLineChannel — pause/resume the same LINE OA channel connection." },
  { file: "app/(admin)/ledger/_actions.ts", line: 2907, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — createLedgerSelfClaimLink — binds the caller's LINE Login sub to their Pool account, an identity/credential-binding action." },
  { file: "app/api/ledger/drive/oauth/callback/route.ts", line: 42, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — Google Drive OAuth callback; comment: \"เชื่อม Google Drive = โครงสร้างหลังบ้าน → เฉพาะ super_admin (CEO 2026-06-15)\"." },
  { file: "app/api/ledger/email/oauth/callback/route.ts", line: 76, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — Gmail OAuth callback; same CEO 2026-06-15 comment pattern." },
  { file: "app/api/ledger/richmenu/register/route.ts", line: 27, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — registers/replaces the LINE OA Rich Menu using the channel's decrypted access token." },
  { file: "app/(admin)/ledger/settings/members/page.tsx", line: 34, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — isSuper gates IdentityClaimCard (LINE self-claim) + canInviteAdmin; comment: \"'ผูก LINE/เชิญผู้ดูแล' ... สงวนให้ super_admin เท่านั้น (CEO 2026-06-12)\" — bundles a connection feature with the admin-appointment guard above." },
  { file: "app/(admin)/ledger/settings/page.tsx", line: 81, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — isSuper gates exactly the rows already covered by the existing LedgerLine Drive/Export/Inventory/LINE-groups exceptions above (confirmed via SettingsHub.tsx) — this specific call site just wasn't previously enumerated. Recommend: keep excluded, matching the established precedent." },

  // ── LedgerLine — deletion / cash-handling boundary ──────────────────────────
  { file: "app/(admin)/ledger/_actions.ts", line: 634, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — inside voidExpense — a bill with an active transfer request may only be force-deleted by super_admin after cancelling the request first; a deliberate extra gate layered on top of the base module-entry check." },
  { file: "app/(admin)/ledger/_actions.ts", line: 4372, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — cancelTransfersForExpensesAction; doc comment: \"CEO 2026-07-26 ... super_admin only (altering money-touched bills is reserved to the owner)\"." },
  { file: "app/(admin)/ledger/expenses/page.tsx", line: 713, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — UI prop feeding the \"ยกเลิกคำขอโอน\" bulk button; same feature/boundary as _actions.ts's cancelTransfersForExpensesAction above." },

  // ── ChairOps — credential/connection (Google Drive, Gmail, LINE OA) ─────────
  // Same shape + same explicit "โครงสร้างเจ้าของระบบ → super_admin เท่านั้น" reasoning
  // as the already-established LedgerLine Drive/Gmail/LINE exceptions above.
  { file: "app/(admin)/chairops/(office)/settings/drive/actions.ts", line: 23, reason: "startDriveConnect — Google Drive OAuth consent URL. Same connection-credential boundary as LedgerLine's Drive settings (see exceptions above)." },
  { file: "app/(admin)/chairops/(office)/settings/drive/actions.ts", line: 50, reason: "disconnectDrive — deletes the org's stored Drive refresh token." },
  { file: "app/(admin)/chairops/(office)/settings/drive/page.tsx", line: 38, reason: "Page-level gate mirroring the Drive connect/disconnect actions above." },
  { file: "app/(admin)/chairops/(office)/settings/email/actions.ts", line: 22, reason: "startGmailConnect — Gmail OAuth consent URL for StarThing XLSX auto-import." },
  { file: "app/(admin)/chairops/(office)/settings/email/actions.ts", line: 48, reason: "disconnectGmail — deletes the org's stored Gmail refresh token." },
  { file: "app/(admin)/chairops/(office)/settings/email/page.tsx", line: 29, reason: "Page-level gate mirroring the Gmail connect/disconnect actions above." },
  { file: "app/(admin)/chairops/line-setup/page.tsx", line: 16, reason: "LINE OA Rich Menu setup page — comment: \"ตั้งค่า LINE (กุญแจ channel) = โครงสร้างหลังบ้าน → เฉพาะ Pool super_admin\"." },
  { file: "app/api/chairops/drive/oauth/callback/route.ts", line: 52, reason: "OAuth callback storing the encrypted Drive refresh token." },
  { file: "app/api/chairops/email/oauth/callback/route.ts", line: 37, reason: "OAuth callback storing the encrypted Gmail refresh token." },
  { file: "app/api/chairops/richmenu/register/route.ts", line: 23, reason: "Uses CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN server-side to register the LINE Rich Menu." },

  // ── ChairOps — deletion (cash-collection rows) ──────────────────────────────
  { file: "app/(admin)/chairops/import/history/actions.ts", line: 43, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — softDeleteCollections — deletes cash-collection rows out of every money query; in-file doc comment: \"money rows must never be silently erasable\". Recommend: keep restricted (same family as the rentspace/dc deletion exceptions), but flagging per RULE A since it's irreversible-adjacent money data." },
  { file: "app/(admin)/chairops/import/history/actions.ts", line: 106, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — restoreCollections — the undo side of the delete gate above, with its own double-count safety check." },
  { file: "app/(admin)/chairops/import/history/page.tsx", line: 23, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — canDelete UI flag; in-file comment: \"Delete/restore: super_admin only (enforced again in ./actions.ts)\"." },

  // ── ChairOps — org-wide period-close (money-baseline reset) — stays
  // super_admin-only. NOTE: the branch close/reopen toggle that used to share
  // this same restriction "by analogy" (toggleBranchClosedAction + its
  // [branchId]/page.tsx canManage flag) was OPENED to program_admin scoped to
  // chairops on 2026-09-19 — see lib/chairops/reconcile/actions.ts and
  // app/(admin)/chairops/(office)/reconcile/[branchId]/page.tsx (no exception
  // entry needed there anymore). The org-wide reconcile/page.tsx below still
  // reuses the SAME `canManage` prop name for its own (unrelated, still-locked)
  // purposes — pre-existing prop-name overlap, left as-is per CEO decision.
  { file: "app/(admin)/chairops/(office)/reconcile/page.tsx", line: 53, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — canClosePeriod gates ClosePeriodButton (closePeriodForOrg) + the same branch close/reopen toggle." },
  { file: "lib/chairops/reconcile/actions.ts", line: 87, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — closePeriodForOrg — resets the org-wide cumulative-shortage baseline; in-file comment explicitly: \"ปิดงวด = รีเซ็ตฐานการนับเงินขาดของทั้งองค์กร (money op สำคัญ) → super_admin เท่านั้น (เหมือนปุ่มเชื่อมต่อภายนอกอื่น ๆ)\". Note: the sibling bulkSendDepositsToReconcileAction in the same file has NO such restriction, suggesting this specific gate is a deliberate outlier, not a copy-paste default." },

  // ── DC — Google Drive connection (credential/connection page, unrelated to
  // deletion — stays super_admin-only). All of DC's deletion/reverse-receipt
  // gates that used to sit in this section (deletions/issues/moves/purchasing/
  // receipts/transfers pages, delete-actions.ts's requireDeleter(), po-actions.ts's
  // unreceivePo) were OPENED on 2026-09-19 — CEO decided the trial period is
  // over, matching lib/dc/access.ts's isProgramAdminTier pattern. Their
  // exception entries were removed entirely; only this one credential page
  // (never part of that decision) remains excluded here.
  { file: "app/(admin)/dc/office/settings/dc-drive-actions.ts", line: 33, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — startDcDriveConnect — same org-wide Google Drive OAuth flow as ChairOps/LedgerLine; comment: \"เฉพาะ super admin\"." },

  // ── Inbox / Recruit / Playland / ClawHub — channel & webhook-secret
  // credential/connection pages (LINE OA, Facebook, ACS face-reader webhook) ──
  { file: "app/(admin)/inbox/layout.tsx", line: 30, reason: "canChannels = isSuperAdmin(...) — gates the bottom-nav \"channels\" tab itself; comment \"channels = super admin\", same connection surface as the sites below." },
  { file: "app/(admin)/inbox/settings/channels/facebook-import/page.tsx", line: 18, reason: "Picker for Facebook pages returned by the OAuth cookie, feeding bulk channel creation with page access tokens." },
  { file: "app/(admin)/inbox/settings/channels/facebook-paste/page.tsx", line: 17, reason: "Manual-paste fallback for the same Facebook OAuth flow (access-token JSON from Graph API Explorer)." },
  { file: "app/(admin)/inbox/settings/channels/page.tsx", line: 24, reason: "In-code comment: \"เชื่อมช่องทาง LINE OA / Facebook = โครงสร้างเจ้าของระบบ → super_admin เท่านั้น (CEO 2026-06-12)\"." },
  { file: "app/api/inbox/facebook-oauth/callback/route.ts", line: 56, reason: "Facebook OAuth code-exchange callback; comment: \"เชื่อม Facebook = โครงสร้างหลังบ้าน (เห็น page access token) → super_admin เท่านั้น\"." },
  { file: "app/api/inbox/facebook-oauth/start/route.ts", line: 27, reason: "Kicks off the Facebook OAuth consent redirect — same comment as the callback route." },
  { file: "lib/inbox/channel-actions.ts", line: 37, reason: "requireInboxOwner(); comment: \"เชื่อม/จัดการช่องทาง (LINE OA / FB webhook + token) = โครงสร้างเจ้าของระบบ → เฉพาะ Pool super_admin\"." },
  { file: "app/(admin)/inbox/settings/groups/actions.ts", line: 15, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — bindGroupBranch only maps a LINE group conversation id to a ChairOps branch label — no secrets/tokens touched, unlike its sibling channel-connection sites above; read as if it copy-pasted the channels guard rather than an independent decision, but CEO reviewed and decided to keep it locked as-is." },
  { file: "app/(admin)/inbox/settings/groups/page.tsx", line: 18, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — page-level gate for the same group→branch binding table as channel-actions.ts:15 above — same reasoning." },
  { file: "app/(admin)/recruit/settings/channels/page.tsx", line: 19, reason: "Identical CEO 2026-06-12 channel-connection comment as inbox's channels page." },
  { file: "app/(admin)/recruit/settings/drive-actions.ts", line: 30, reason: "Google Drive OAuth connect — comment: connecting Drive touches shared back-office storage, super_admin only, same family as the LedgerLine/ChairOps/DC Drive exceptions." },
  { file: "lib/recruit/channel-actions.ts", line: 34, reason: "createChannel — writes encrypted accessTokenEnc/webhookSecret for a LINE/FB channel." },
  { file: "lib/recruit/channel-actions.ts", line: 87, reason: "listChannels — decrypts and returns the FB webhook verifyToken in plaintext to the UI (not just a boolean)." },
  { file: "lib/recruit/channel-actions.ts", line: 136, reason: "updateChannelSecrets — re-issues a provider secret/access token." },
      { file: "app/(admin)/playland/settings/devices/page.tsx", line: 14, reason: "Renders each ACS face-reader device's raw webhookSecret; comment: \"กุญแจลับ webhook ของเครื่องสแกนหน้า (ACS) = โครงสร้างหลังบ้าน → super_admin เท่านั้น\"." },
  { file: "app/(admin)/playland/settings/layout.tsx", line: 39, reason: "UI-only: hides the \"ACS Devices\" menu link unless super_admin — mirrors the hard gate on the devices page itself." },
  { file: "app/(admin)/playland/settings/page.tsx", line: 51, reason: "Hides the settings-hub tile linking to the device/webhook-secret page — same reasoning as the two entries above." },
  { file: "app/(admin)/clawhub/settings/page.tsx", line: 38, reason: "Comment: \"Settings is super_admin-only (per the back-office hardening principle: DB / LINE / secret surfaces are super_admin only)\"; page shows env-secret readiness + a LINE rich-menu install button." },
  { file: "app/api/clawhub/richmenu/register/route.ts", line: 27, reason: "Comment: \"ตั้งค่า LINE = โครงสร้างหลังบ้าน → เฉพาะ super_admin (CEO 2026-06-15)\"; uses CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN to call LINE's richmenu API." },

  // ── ClawFleet — anti-fraud meter-baseline reset (deliberately excludes
  // program_admin even more strictly than the general CF_ADMIN_ROLES tier) ───
  { file: "lib/clawfleet/repair-actions.ts", line: 45, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — assertSuperAdminOnly() gates the FIRST_SETUP meter-baseline reset; comment explicitly: \"baseline = ตัวหารรายได้ → org_admin/program_admin/ผจก.สาขา ห้ามปลดล็อก (กันช่องโกง/ครหา)\" — deliberately stricter than ClawFleet's own CF_ADMIN_ROLES tier on purpose. Recommend: keep excluded." },

  // ── RentSpace — ALREADY-CORRECT-COMPOSED (Pattern C, 2026-09-19) ────────────
  // Verified by direct read: program_admin already passes via a
  // userIsModuleAdmin(user,"rentspace") fallback composed in the same
  // expression/function — not bugs, just what the bare sub-expression scanner
  // matches without seeing the surrounding `||`.
  { file: "app/(admin)/rentspace/_actions.ts", line: 22, reason: "gateAdmin() itself — if (!isAdminTier(role)) falls back to userIsModuleAdmin(user,\"rentspace\"); program_admin of rentspace already allowed (in-file comment)." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 38, reason: "gateModuleWrite() itself — if (!isAdminTier(role)) falls back to userHasModuleAccess(user,\"rentspace\") for member-level writes; not admin-only at all." },
  { file: "app/(admin)/rentspace/bills/[id]/history/page.tsx", line: 116, reason: "canView = isAdminTier(role) || (await userIsModuleAdmin(user,\"rentspace\"))." },
  { file: "app/(admin)/rentspace/bills/[id]/page.tsx", line: 39, reason: "isAdminTier feeds canOperate = isAdmin || userIsModuleAdmin(...), which then gates canEditBill/canDeleteBill — program_admin reachable via canOperate." },
  { file: "app/(admin)/rentspace/bills/[id]/page.tsx", line: 40, reason: "isSuperAdmin feeds canEditBill = isSuper || (billEditUnlocked && canOperate) — canOperate (line 39) is already program_admin-inclusive, so program_admin is reachable through the unlock-switch path." },
  { file: "app/(admin)/rentspace/bills/page.tsx", line: 47, reason: "isSuper feeds canIssue = isSuper || (billIssueUnlocked && moduleAdmin), where moduleAdmin (line 49) includes userIsModuleAdmin." },
  { file: "app/(admin)/rentspace/bills/page.tsx", line: 49, reason: "moduleAdmin = isAdminTier(role) || (await userIsModuleAdmin(user,\"rentspace\"))." },
  { file: "app/(admin)/rentspace/matrix/page.tsx", line: 51, reason: "canReorder = isAdminTier(role) || (await userIsModuleAdmin(user,\"rentspace\")) — in-file comment says program_admin should be able to reorder rooms same as gateAdmin()." },
  { file: "app/(admin)/rentspace/units/page.tsx", line: 19, reason: "canManage = isAdminTier(role) || (await userIsModuleAdmin(user,\"rentspace\")) — comment: \"แอดมินโปรแกรม RentSpace เห็นปุ่ม 'จัดการอาคาร' ได้ด้วย\"." },
  { file: "app/api/rentspace/import/route.ts", line: 119, reason: "!isAdminTier(role) && !(await userIsModuleAdmin(user,\"rentspace\")) → 403 — opened to program_admin by CEO 2026-09-19 to match units/page.tsx:19's composed pattern above (bulk CSV import of the same building/unit data)." },
  { file: "app/(admin)/rentspace/page.tsx", line: 68, reason: "canEditPlan = isSuperAdmin(role) || (await userIsModuleAdmin(user,\"rentspace\")) — fixed in this round (2026-09-19) to match the identical composition already used by the sibling \"จัดลำดับห้อง\" action at matrix/page.tsx:51." },
  { file: "app/(admin)/rentspace/payments/page.tsx", line: 37, reason: "canDecideDiscount = isAdminTier(role) — split out of the old shared isAdmin flag in this round (2026-09-19); intentionally admin-tier-only, matching the existing actDecideDiscount exception (_actions.ts:2655) above." },
  { file: "app/(admin)/rentspace/payments/page.tsx", line: 39, reason: "canReviewSlips = isAdminTier(role) || (await userIsModuleAdmin(user,\"rentspace\")) — split out of the old shared isAdmin flag in this round (2026-09-19) to match gateAdmin(), which actConfirmTenantPayment/actRejectTenantPayment already use." },

  // ── RentSpace — approval separation-of-duties / self-escalation guards ─────
  // Multiple sites share ONE design: "unlock switch" fields (billEditUnlocked,
  // billDeleteUnlocked, billIssueUnlocked, contractDeleteUnlocked, etc) can
  // only be FLIPPED by super_admin (settings/page.tsx:22, comment: "กัน
  // self-escalation" — a module admin must not be able to grant themself the
  // unlock), and several money/contract actions require a genuinely DIFFERENT
  // admin to approve than the one who requested the change (maker≠checker).
  { file: "app/(admin)/rentspace/_actions.ts", line: 52, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — gateSuperAdminOnly() — used for rent/discount-terms decisions; in-file comment documents CEO 2026-08-29 decision that this has NO admin-tier/program_admin fallback by design." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 268, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — isSuper gates whether billEditUnlocked/billDeleteUnlocked/etc switch input is honored; comment: \"การให้สิทธิ์คนอื่น → เฉพาะ super_admin ... กัน module admin ปลดล็อกให้ตัวเอง\" (self-escalation guard)." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 811, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — callerIsSuperAdmin feeds routeApprovalField() for a rent-amount change — non-super requests get queued as pending-approval instead of applied immediately." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 937, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — one of 3 ORs allowing edit of a tenant-signed contract (unlock switch / approved edit-request / super_admin bypass)." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 1061, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — identical unlock/approval/super_admin-bypass pattern as line 937, in actUpdateContractBilling." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 1073, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — callerIsSuperAdmin feeds routeApprovalField() for a promo-discount change, same pattern as line 811." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 1575, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — billIssueUnlocked switch check (super_admin bypasses) — same unlock-permission family as line 268." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 1756, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — same billIssueUnlocked switch check, actGenerateMonthlyBills." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 1786, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — same billIssueUnlocked switch check, actGenerateBillsForUnits." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 1868, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — explicit maker≠checker guard for void-bill approval — comment: \"กันคนขอกับคนอนุมัติเป็นคนเดียวกัน (ยกเว้น super_admin)\"." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 1989, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — billEditUnlocked switch check in actEditBillItems — same unlock-switch family as line 268." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 2795, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — maker≠checker guard for contract-edit-request approval — comment: \"ต้องให้แอดมินอีกคนเป็นผู้อนุมัติคำขอแก้สัญญา (กันการอนุมัติเอง)\"." },
  { file: "app/(admin)/rentspace/contracts/[id]/page.tsx", line: 92, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — canEdit OR-chain mirrors _actions.ts:937/1061 exactly — UI mirror of the same deliberate server-side gate." },
  { file: "app/(admin)/rentspace/contracts/[id]/page.tsx", line: 258, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — canDecide passed to TermsApprovalPanel — matches gateSuperAdminOnly's CEO 2026-08-29 rent/discount-terms decision (line 52 above)." },
  { file: "app/(admin)/rentspace/settings/page.tsx", line: 22, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — canEditPerms gates the unlock-switch fields themselves in the settings form — same self-escalation-prevention design as _actions.ts:268." },

  // ── RentSpace — irreversible deletion ───────────────────────────────────────
  { file: "app/(admin)/rentspace/_actions.ts", line: 2087, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — actDeleteBill — hard-deletes bill+payments+items; billDeleteUnlocked switch + tax-invoice-sequence guard." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 2138, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — actDeleteBillsBulk — same irreversible hard-delete pattern as line 2087." },
  { file: "app/(admin)/rentspace/_actions.ts", line: 2871, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — actDeleteContract — contractDeleteUnlocked + super_admin bypass; guards deleting contracts with bills/deposits attached." },

  // ── RentSpace — financial-integrity locks (meter/billing consistency) ──────
  { file: "app/(admin)/rentspace/_actions.ts", line: 1385, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — meter reading locked once its period is billed; only super_admin can override, protecting bill/meter consistency." },
  { file: "app/(admin)/rentspace/meters/page.tsx", line: 247, reason: "✅ CEO CONFIRMED 2026-09-19 — keep excluded — isSuper prop → MeterBoard's isLocked = billedSet.has(unitId) && !isSuper — UI mirror of the financial-integrity lock at _actions.ts:1385." },

  // ── RESOLVED + REMOVED 2026-09-19 (CEO decision) — CashHub reports fully
  // opened to program_admin, both layers. Part 1 of this fix (earlier the
  // same day) had already fixed the reports/route.ts:109 cross-branch array
  // to include "admin" + "program_admin", but flagged that this was a no-op
  // in practice because two upstream gates still blocked program_admin
  // before ever reaching that line: (1) `can(user, "cashhub.create")` in
  // lib/auth/permissions.ts, where MATRIX.program_admin was `{}`, and (2)
  // canFillReports() in lib/auth/branch-access.ts, which explicitly excluded
  // `role === "program_admin"`. CEO reviewed and approved opening BOTH
  // layers fully today: MATRIX.program_admin now has
  // `{ "cashhub.view": true, "cashhub.create": true }`, and
  // canFillReports()/hasCrossBranchAccess() no longer exclude program_admin.
  // No gate remains blocking program_admin from filling or viewing CashHub
  // daily reports, own-branch or cross-branch — verified end-to-end via the
  // 2026-09-19 program-admin-full-fix (part 2) report.
];
