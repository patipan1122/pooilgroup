// LedgerLine — money-capability permission model (LIFF Admin Console, GAP 5).
//
// ONE source of truth for "what each ledger role may do" with the money-risk
// actions. CEO 2026-06-05: 4 roles × 5 toggles (NOT a full Bainy matrix). The
// `can()` helper here is the SINGLE authz gate — call it from LIFF actions, LINE
// commands, and the web money-actions so the two role systems can never diverge
// (workshop lesson W-013). A missing override row → the code DEFAULTS below.
//
// IMPORTANT: this governs the LEDGER role (ledger_line_member.role) used in the
// LINE/LIFF context. The web (Pool session) keeps its own requireRole gates; this
// is an additional, money-specific gate that both surfaces consult.

import { prisma } from "@/lib/prisma";

/** The 4 ledger roles (mirrors Bainy's สิทธิ์ tab). */
export const LEDGER_ROLES = [
  "staff",
  "accountant",
  "admin",
  "external_accountant",
] as const;
export type LedgerRole = (typeof LEDGER_ROLES)[number];

export function isLedgerRole(v: unknown): v is LedgerRole {
  return typeof v === "string" && (LEDGER_ROLES as readonly string[]).includes(v);
}

/** The 5 money-risk capabilities an admin can toggle per role. */
export const LEDGER_CAPABILITIES = [
  "expense.confirm", // ยืนยันบิล → เข้าเล่ม/ส่งออกได้
  "expense.export", // ส่งออกไฟล์ (Excel/CSV → TRCloud)
  "report.view_pnl", // ดูภาพรวมการเงิน (กำไร-ขาดทุน)
  "scope.all_branches", // เห็นทุกสาขา (ไม่งั้นเฉพาะสาขาที่ดูแล)
  "expense.edit_others", // แก้ไข/ลบรายการของคนอื่น
] as const;
export type LedgerCapability = (typeof LEDGER_CAPABILITIES)[number];

export function isLedgerCapability(v: unknown): v is LedgerCapability {
  return (
    typeof v === "string" &&
    (LEDGER_CAPABILITIES as readonly string[]).includes(v)
  );
}

/** Human-readable labels (CEO is non-developer — sentence + short gloss). */
export const ROLE_LABEL: Record<LedgerRole, string> = {
  staff: "พนักงาน",
  accountant: "บัญชี",
  admin: "ผู้ดูแล",
  external_accountant: "สำนักงานบัญชีภายนอก",
};

export const CAPABILITY_LABEL: Record<
  LedgerCapability,
  { title: string; desc: string }
> = {
  "expense.confirm": {
    title: "ยืนยันค่าใช้จ่าย",
    desc: "กดยืนยันบิลให้เข้าเล่มบัญชี/ส่งออกได้",
  },
  "expense.export": {
    title: "ส่งออกไฟล์บัญชี",
    desc: "โหลดไฟล์ Excel/CSV ออกไป (เข้า TRCloud)",
  },
  "report.view_pnl": {
    title: "ดูภาพรวมการเงิน",
    desc: "เห็นกำไร-ขาดทุน ยอดรวมทั้งบริษัท",
  },
  "scope.all_branches": {
    title: "เห็นทุกสาขา",
    desc: "ดูข้อมูลได้ทุกสาขา (ไม่จำกัดเฉพาะสาขาที่ดูแล)",
  },
  "expense.edit_others": {
    title: "แก้/ลบรายการคนอื่น",
    desc: "แก้ไขหรือลบรายจ่ายที่คนอื่นบันทึก",
  },
};

/** Code defaults — used when no DB override row exists for (org, role, cap). */
const DEFAULTS: Record<LedgerRole, Record<LedgerCapability, boolean>> = {
  // พนักงาน: ถ่าย/บันทึกเท่านั้น — ไม่แตะเรื่องเงิน
  staff: {
    "expense.confirm": false,
    "expense.export": false,
    "report.view_pnl": false,
    "scope.all_branches": false,
    "expense.edit_others": false,
  },
  // บัญชี: ทำได้หมด (เป็นคนคุมเล่ม)
  accountant: {
    "expense.confirm": true,
    "expense.export": true,
    "report.view_pnl": true,
    "scope.all_branches": true,
    "expense.edit_others": true,
  },
  // ผู้ดูแล: ทำได้หมด
  admin: {
    "expense.confirm": true,
    "expense.export": true,
    "report.view_pnl": true,
    "scope.all_branches": true,
    "expense.edit_others": true,
  },
  // สำนักงานบัญชีภายนอก: ดู + ส่งออกเท่านั้น (ไม่ยืนยัน ไม่แก้ของคนอื่น)
  external_accountant: {
    "expense.confirm": false,
    "expense.export": true,
    "report.view_pnl": true,
    "scope.all_branches": true,
    "expense.edit_others": false,
  },
};

/** Synchronous default lookup (no DB) — safe fallback. */
export function defaultCan(role: string, cap: LedgerCapability): boolean {
  if (!isLedgerRole(role)) return false;
  return DEFAULTS[role][cap];
}

/**
 * THE authz gate. Returns whether `role` may do `capability` in this org.
 * DB override wins; otherwise the code default. Unknown role/cap → false (deny).
 */
export async function can(
  orgId: string,
  role: string,
  capability: LedgerCapability,
): Promise<boolean> {
  if (!orgId || !isLedgerRole(role) || !isLedgerCapability(capability)) {
    return false;
  }
  const row = await prisma.ledgerPermission.findUnique({
    where: { orgId_role_capability: { orgId, role, capability } },
    select: { allowed: true },
  });
  return row ? row.allowed : DEFAULTS[role][capability];
}

/** Full effective matrix for an org (defaults merged with overrides) — สิทธิ์ tab. */
export async function getPermissionMatrix(
  orgId: string,
): Promise<Record<LedgerRole, Record<LedgerCapability, boolean>>> {
  const out = structuredCloneMatrix();
  if (!orgId) return out;
  const rows = await prisma.ledgerPermission.findMany({
    where: { orgId },
    select: { role: true, capability: true, allowed: true },
  });
  for (const r of rows) {
    if (isLedgerRole(r.role) && isLedgerCapability(r.capability)) {
      out[r.role][r.capability] = r.allowed;
    }
  }
  return out;
}

function structuredCloneMatrix(): Record<
  LedgerRole,
  Record<LedgerCapability, boolean>
> {
  const out = {} as Record<LedgerRole, Record<LedgerCapability, boolean>>;
  for (const role of LEDGER_ROLES) {
    out[role] = { ...DEFAULTS[role] };
  }
  return out;
}

/** Upsert one override (admin toggled a switch). Returns nothing; caller audits. */
export async function setPermission(args: {
  orgId: string;
  role: LedgerRole;
  capability: LedgerCapability;
  allowed: boolean;
  updatedBy?: string | null;
}): Promise<void> {
  const { orgId, role, capability, allowed, updatedBy = null } = args;
  await prisma.ledgerPermission.upsert({
    where: { orgId_role_capability: { orgId, role, capability } },
    update: { allowed, updatedBy },
    create: { orgId, role, capability, allowed, updatedBy },
  });
}
