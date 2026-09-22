// RentSpace — permission constants + labels (PURE, no DB import).
//
// Mirrors lib/ledger/permission-constants.ts exactly (same sparse-override
// shape, same split so a client settings component can import roles/caps/
// labels without pulling prisma into the browser bundle).
//
// Added by /auditbigteam → /bigsolvebug 2026-09-20 (CEO-requested settings
// page: "หน้าตั้งค่าสิทธิ์ สำหรับ super_admin ว่าใครมีสิทธิ์ยังไง แบบติ๊ก").
// All defaults below mirror the CURRENT hardcoded gates in _actions.ts — this
// page only makes them visible + toggleable, it does not change behavior on
// its own until a super_admin flips a switch.

/** Roles surfaced in the RentSpace permission matrix. */
export const RENTSPACE_ROLES = [
  "staff",
  "branch_manager",
  "program_admin",
  "admin",
  "org_admin",
  "super_admin",
] as const;
export type RentspaceRole = (typeof RENTSPACE_ROLES)[number];

export function isRentspaceRole(v: unknown): v is RentspaceRole {
  return typeof v === "string" && (RENTSPACE_ROLES as readonly string[]).includes(v);
}

/**
 * Toggleable capabilities. Deliberately does NOT include bill-delete-approval
 * or discount-approval — CEO decided those stay hardcoded super_admin-only,
 * not a configurable preference (2026-09-20).
 */
export const RENTSPACE_CAPABILITIES = [
  "slip.verify_access", // เปิดหน้าตรวจสลิปการชำระเงิน
  "bill.delete_direct", // ลบบิลที่ยังไม่จ่ายได้โดยตรง (ไม่ต้องขออนุมัติ)
  "bill.void_request", // ขอยกเลิกบิล (ยังต้องรอผู้มีสิทธิ์อนุมัติ)
  "contract.edit_request", // ขอแก้ไขสัญญา (ยังต้องรอผู้มีสิทธิ์อนุมัติ)
  "discount.request", // ขอส่วนลด (การอนุมัติ ยังเป็น super_admin เท่านั้นเสมอ)
] as const;
export type RentspaceCapability = (typeof RENTSPACE_CAPABILITIES)[number];

export function isRentspaceCapability(v: unknown): v is RentspaceCapability {
  return (
    typeof v === "string" &&
    (RENTSPACE_CAPABILITIES as readonly string[]).includes(v)
  );
}

export const ROLE_LABEL: Record<RentspaceRole, string> = {
  staff: "พนักงาน",
  branch_manager: "ผู้จัดการสาขา",
  program_admin: "แอดมินโปรแกรม",
  admin: "ผู้ดูแลระบบ",
  org_admin: "ผู้ดูแลองค์กร",
  super_admin: "ซูเปอร์แอดมิน",
};

export const ROLE_HINT: Record<RentspaceRole, string> = {
  staff: "หน้างาน/สนาม",
  branch_manager: "ดูแลสาขาตัวเอง",
  program_admin: "แอดมินเฉพาะโปรแกรม RentSpace",
  admin: "จัดการได้เกือบทุกอย่าง",
  org_admin: "จัดการได้ทุกโปรแกรมในองค์กร",
  super_admin: "สิทธิ์สูงสุด แก้ไม่ได้",
};

export const CAPABILITY_LABEL: Record<
  RentspaceCapability,
  { title: string; desc: string }
> = {
  "slip.verify_access": {
    title: "เข้าหน้าตรวจสลิป",
    desc: "เปิดหน้าตรวจสอบสลิปการชำระเงินของผู้เช่า",
  },
  "bill.delete_direct": {
    title: "ลบบิลที่ยังไม่จ่าย",
    desc: "ลบบิลที่ยังไม่มีการชำระเงินได้ทันที ไม่ต้องขออนุมัติ",
  },
  "bill.void_request": {
    title: "ขอยกเลิกบิล",
    desc: "ส่งคำขอยกเลิกบิล (ต้องรอผู้มีสิทธิ์อนุมัติ)",
  },
  "contract.edit_request": {
    title: "ขอแก้ไขสัญญา",
    desc: "ส่งคำขอแก้ไขเงื่อนไขสัญญา (ต้องรอผู้มีสิทธิ์อนุมัติ)",
  },
  "discount.request": {
    title: "ขอส่วนลด",
    desc: "ส่งคำขอส่วนลดให้ผู้เช่า (การอนุมัติเป็นสิทธิ์ซูเปอร์แอดมินเสมอ)",
  },
};

/** Code defaults — mirrors the CURRENT hardcoded gates, unchanged until toggled. */
export const PERMISSION_DEFAULTS: Record<
  RentspaceRole,
  Record<RentspaceCapability, boolean>
> = {
  staff: {
    "slip.verify_access": false,
    "bill.delete_direct": false,
    "bill.void_request": false,
    "contract.edit_request": false,
    "discount.request": false,
  },
  branch_manager: {
    "slip.verify_access": false,
    "bill.delete_direct": false,
    "bill.void_request": false,
    "contract.edit_request": false,
    "discount.request": false,
  },
  program_admin: {
    "slip.verify_access": true,
    "bill.delete_direct": true,
    "bill.void_request": true,
    "contract.edit_request": true,
    "discount.request": true,
  },
  admin: {
    "slip.verify_access": true,
    "bill.delete_direct": true,
    "bill.void_request": true,
    "contract.edit_request": true,
    "discount.request": true,
  },
  org_admin: {
    "slip.verify_access": true,
    "bill.delete_direct": true,
    "bill.void_request": true,
    "contract.edit_request": true,
    "discount.request": true,
  },
  super_admin: {
    "slip.verify_access": true,
    "bill.delete_direct": true,
    "bill.void_request": true,
    "contract.edit_request": true,
    "discount.request": true,
  },
};

/** Synchronous default lookup (no DB) — safe fallback. */
export function defaultCan(role: string, cap: RentspaceCapability): boolean {
  if (!isRentspaceRole(role)) return false;
  return PERMISSION_DEFAULTS[role][cap];
}
