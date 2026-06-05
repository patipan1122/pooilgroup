// LedgerLine — permission constants + labels (PURE, no DB import).
//
// Split out of permissions.ts so CLIENT components (the LIFF "สิทธิ์" toggles) can
// import the roles/capabilities/labels without pulling prisma into the browser
// bundle. permissions.ts (server-only, DB) re-exports these for back-compat.

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

export const ROLE_HINT: Record<LedgerRole, string> = {
  staff: "ถ่าย/บันทึกใบเสร็จ",
  accountant: "ยืนยัน + ส่งออกได้",
  admin: "จัดการได้ทุกอย่าง",
  external_accountant: "ดู + ส่งออกเท่านั้น",
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
    desc: "โหลดไฟล์ Excel/CSV ส่งเข้าโปรแกรมบัญชี",
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
export const PERMISSION_DEFAULTS: Record<
  LedgerRole,
  Record<LedgerCapability, boolean>
> = {
  staff: {
    "expense.confirm": false,
    "expense.export": false,
    "report.view_pnl": false,
    "scope.all_branches": false,
    "expense.edit_others": false,
  },
  accountant: {
    "expense.confirm": true,
    "expense.export": true,
    "report.view_pnl": true,
    "scope.all_branches": true,
    "expense.edit_others": true,
  },
  admin: {
    "expense.confirm": true,
    "expense.export": true,
    "report.view_pnl": true,
    "scope.all_branches": true,
    "expense.edit_others": true,
  },
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
  return PERMISSION_DEFAULTS[role][cap];
}
