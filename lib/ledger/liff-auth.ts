import "server-only";
import { getSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { can } from "@/lib/ledger/permissions";
import type { LedgerCapability } from "@/lib/ledger/permission-constants";
import { prisma } from "@/lib/prisma";

// LedgerLine — who may act on an expense in the LINE/LIFF (mobile) context, and
// the SINGLE source of truth for "is this person a ledger admin / what may they do".
//
// The web back-office gates on the Pool MODULE grant (requireLedgerAccess). But
// field staff capture receipts in LINE and aren't Pool-module users — they're
// `ledger_line_member` rows. This resolver lets them edit/confirm from the LIFF
// according to the SAME money-capability matrix the admin console manages
// (`ledger_permission` via can()), so the two role systems never diverge.
//
//   Pool admin/super_admin/org_admin tier → full actor (HARD BYPASS — CEO rule:
//        a super_admin is NEVER blocked anywhere, regardless of LINE binding).
//   Pool viewer (accountant/HR)          → ledger "accountant" · can()-governed.
//   else a member linked by pool_user_id OR by either LINE id (messaging userId
//        OR login sub) → member actor; confirm/branch/admin rights come from can().
//   else Pool user holding the bare ledger grant → staff-level (edit, no confirm).
//   else null (no access → show the needs-link / claim screen).

export type LedgerActor = {
  orgId: string;
  userId: string; // Pool user id — for createdBy/confirmedBy/audit trail
  kind: "pool" | "member";
  role: string; // ledger role label: admin | accountant | staff | external_accountant
  scopeBranchIds: string[];
  allBranches: boolean;
  canConfirm: boolean;
  /**
   * Company the actor belongs to (LedgerExpense is company-scoped, NOT just org).
   *
   * SECURITY CONTRACT — P0#2 / P1#20 / P1#39:
   * - `string`  → actor is pinned to this company; use directly in every query.
   * - `null`    → actor spans companies (admin / accountant / staff pool roles).
   *               Callers MUST call requireActorCompanyId() (or resolve the active
   *               company via resolveScope) BEFORE querying expense data.
   *               NEVER fall back to an org-wide query — that leaks across legal
   *               entities (Pooil Oil ≠ JP Sync, both share the same org_id).
   *
   * The field is REQUIRED (not optional `?`) so TypeScript forces every actor
   * construction path to set it explicitly — there is no silent `undefined`.
   */
  companyId: string | null;
};

export async function resolveLedgerActor(): Promise<LedgerActor | null> {
  const session = await getSession();
  if (!session) return null;
  const orgId = session.user.org_id;
  const userId = session.user.id;
  const role = session.user.role;
  const lineUserId = session.user.line_user_id;

  // Pool admin tier = full rights, ALWAYS. This is the super_admin escape-hatch:
  // once a Pool session exists, an admin-tier user passes every ledger gate with
  // no dependency on the fragile LINE-id binding (audit 2026-06-05, CEO req 1).
  // companyId=null: admin spans companies — callers MUST resolve via requireActorCompanyId
  // or resolveScope before querying expense data (P0#2, P1#20).
  if (isAdminTier(role)) {
    return { orgId, userId, kind: "pool", role: "admin", scopeBranchIds: [], allBranches: true, canConfirm: true, companyId: null };
  }
  // Pool viewer = the office accountant. Map to the ledger "accountant" role so the
  // admin's สิทธิ์ toggles (ledger_permission) actually govern them on web + LIFF.
  // companyId=null: accountant spans companies — callers MUST resolve via
  // requireActorCompanyId or resolveScope before querying (P1#39, P0#2).
  if (role === "viewer") {
    const [allBranches, canConfirm] = await Promise.all([
      can(orgId, "accountant", "scope.all_branches"),
      can(orgId, "accountant", "expense.confirm"),
    ]);
    return { orgId, userId, kind: "pool", role: "accountant", scopeBranchIds: [], allBranches, canConfirm, companyId: null };
  }

  // 2026-06-16 (CEO): Pool program_admin ที่ถูกติ๊กสิทธิ์ ledger = ledger admin เต็ม
  // (เปิด LIFF admin console + ยืนยันเงินผ่าน LINE + admin web actions). grant-scoped —
  // program_admin ที่ไม่มีสิทธิ์ ledger จะตกไปที่ทางอื่น (member row / null) ตามเดิม.
  if (role === "program_admin" && (await userHasModuleAccess(session.user, "ledger"))) {
    return { orgId, userId, kind: "pool", role: "admin", scopeBranchIds: [], allBranches: true, canConfirm: true, companyId: null };
  }

  // Any other identity: find this person's ledger member row — by the canonical
  // Pool linkage FIRST (set when an admin promotes/claims), else by EITHER LINE id
  // (messaging userId from the webhook seed OR login sub from an invite/claim).
  const member = await prisma.ledgerLineMember.findFirst({
    where: {
      orgId,
      active: true,
      OR: [
        { poolUserId: userId },
        ...(lineUserId ? [{ lineUserId }] : []),
      ],
    },
    select: { role: true, scopeBranchIds: true, companyId: true },
  });
  if (member) {
    const [allBranches, canConfirm] = await Promise.all([
      can(orgId, member.role, "scope.all_branches"),
      can(orgId, member.role, "expense.confirm"),
    ]);
    return {
      orgId,
      userId,
      kind: "member",
      role: member.role,
      scopeBranchIds: member.scopeBranchIds ?? [],
      allBranches,
      canConfirm,
      companyId: member.companyId,
    };
  }

  // A non-admin Pool user who still holds the ledger module grant → staff-level.
  // companyId=null: this fallback actor has no member row and therefore no pinned
  // company. Callers MUST resolve via requireActorCompanyId before querying expense
  // data — NEVER allow an org-wide fallback query (P1#20, P0#2).
  if (await userHasModuleAccess(session.user, "ledger")) {
    return { orgId, userId, kind: "pool", role: "staff", scopeBranchIds: [], allBranches: true, canConfirm: false, companyId: null };
  }
  return null;
}

/** Is this actor a ledger ADMIN? (Pool admin-tier mapped to role 'admin', OR a
 *  member/promoted user whose ledger role is 'admin'.) The ONE admin test used by
 *  the LIFF admin console, the LINE command gate, and admin-only web actions. */
export function isLedgerAdminActor(actor: LedgerActor | null): boolean {
  return !!actor && actor.role === "admin";
}

/** Web money-action capability gate. Admin tier ALWAYS passes (CEO req 1). Everyone
 *  else is checked against the ledger capability matrix using their effective ledger
 *  role — so the admin's สิทธิ์ toggles finally govern web actions too (audit P1 #7). */
export async function ledgerWebCan(
  actor: LedgerActor | null,
  capability: LedgerCapability,
): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === "admin") return true; // admin-tier hard bypass
  return can(actor.orgId, actor.role, capability);
}

/** Web money-action gate keyed by Pool role (the web back-office context). Admin tier
 *  ALWAYS passes; the office accountant (Pool `viewer`) is now governed by the สิทธิ์
 *  matrix instead of being hard-allowed (audit P1 #7 — the toggle was decorative).
 *  Other Pool roles don't reach these accountant-tier actions. */
export async function ledgerWebCanForRole(
  orgId: string,
  poolRole: Parameters<typeof isAdminTier>[0],
  capability: LedgerCapability,
): Promise<boolean> {
  if (isAdminTier(poolRole)) return true; // admin-tier hard bypass (super_admin never blocked)
  if (poolRole === "viewer") return can(orgId, "accountant", capability);
  return false;
}

/** Branch-scope guard: may this actor touch an expense tagged to `branchId`? */
export function actorCanReachBranch(actor: LedgerActor, branchId: string | null): boolean {
  if (actor.allBranches) return true;
  if (!branchId) return true; // unbranched/central capture — allow (branch tagged later)
  return actor.scopeBranchIds.includes(branchId);
}

/**
 * SECURITY GUARD — P0#2 / P1#20 / P1#39
 *
 * Call this BEFORE any LedgerExpense / LedgerPayment / LedgerBudget query when
 * the actor might be a pool admin, accountant, or fallback staff (companyId=null).
 *
 * Returns `{ ok: true, companyId }` when a company is pinned to the actor or
 * the caller supplies a resolved `fallbackCompanyId` (from resolveScope).
 *
 * Returns `{ ok: false, error }` when neither is available — the caller MUST
 * abort and return a 403 / "ไม่ระบุบริษัท" response. NEVER fall through to an
 * org-wide query: that would expose data from every legal entity in the org.
 *
 * Usage:
 *   const cid = requireActorCompanyId(actor, scope.companyId);
 *   if (!cid.ok) return { ok: false, error: cid.error };
 *   // now use cid.companyId safely
 */
export function requireActorCompanyId(
  actor: LedgerActor,
  fallbackCompanyId?: string | null,
): { ok: true; companyId: string } | { ok: false; error: string } {
  const companyId = actor.companyId ?? fallbackCompanyId ?? null;
  if (!companyId) {
    return { ok: false, error: "ไม่ระบุบริษัท — กรุณาเลือกบริษัทก่อนดำเนินการ" };
  }
  return { ok: true, companyId };
}
