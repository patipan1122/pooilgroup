/**
 * Single source of truth for role labels + colors.
 * Import everywhere instead of redefining inline.
 *
 * Roles:
 *   super_admin → Owner (full system access)
 *   org_admin   → Admin (org-wide management)
 *   admin       → Admin (alias of org_admin in older data)
 *   area_manager   → ผจก.เขต (manages branches in a region)
 *   branch_manager → ผจก.สาขา (manages a single branch)
 *   staff       → พนักงาน (data entry / report submitter)
 *   driver      → คนขับ (FuelOS driver app, Telegram bot)
 *   viewer      → ผู้ดู (read-only)
 */

export const ROLES = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
  "staff",
  "driver",
  "viewer",
] as const;

export type Role = (typeof ROLES)[number];

/** Short labels — for table cells, chips, badges. */
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Owner",
  admin: "Admin",
  org_admin: "Admin",
  area_manager: "ผจก.เขต",
  branch_manager: "ผจก.สาขา",
  staff: "พนักงาน",
  driver: "คนขับ",
  viewer: "ผู้ดู",
};

/** Full prose labels — for Telegram messages, emails, dialog titles. */
export const ROLE_LABEL_LONG: Record<Role, string> = {
  super_admin: "เจ้าของระบบ",
  admin: "ผู้ดูแลระบบ",
  org_admin: "ผู้ดูแลระบบ",
  area_manager: "ผู้จัดการเขต",
  branch_manager: "ผู้จัดการสาขา",
  staff: "พนักงาน",
  driver: "คนขับ",
  viewer: "ผู้ดู (Read-only)",
};

export const ROLE_COLOR: Record<Role, string> = {
  super_admin: "bg-amber-100 text-amber-900 border-amber-300",
  admin: "bg-amber-50 text-amber-800 border-amber-200",
  org_admin: "bg-amber-50 text-amber-800 border-amber-200",
  area_manager: "bg-purple-50 text-purple-800 border-purple-200",
  branch_manager:
    "bg-[var(--color-brand-50)] text-[var(--color-brand-800)] border-[var(--color-brand-200)]",
  staff: "bg-zinc-50 text-zinc-700 border-zinc-200",
  driver: "bg-blue-50 text-blue-800 border-blue-200",
  viewer: "bg-zinc-50 text-zinc-500 border-zinc-200",
};

// These are lookup sets — typed as Set<string> so callers don't have to
// cast `user.role` (always string from DB) when checking membership.

/** Roles that don't typically need branch assignment. */
export const UNASSIGNED_ROLES: ReadonlySet<string> = new Set([
  "super_admin",
  "org_admin",
  "admin",
  "viewer",
]);

/** Roles that have manager-level access. */
export const MANAGER_ROLES: ReadonlySet<string> = new Set([
  "branch_manager",
  "area_manager",
  "super_admin",
  "org_admin",
  "admin",
]);

/** Roles that should NOT see LINE/Telegram link status (they manage from dashboard). */
export const HIDE_MESSAGING_ROLES: ReadonlySet<string> = new Set([
  "super_admin",
  "org_admin",
  "admin",
]);

/** Role options for select inputs (in display order). */
export const ROLE_OPTIONS: ReadonlyArray<{ value: Role; label: string }> =
  ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

export function roleLabel(role: string): string {
  return ROLE_LABEL[role as Role] ?? role;
}

export function roleColor(role: string): string {
  return ROLE_COLOR[role as Role] ?? "bg-zinc-50 text-zinc-700 border-zinc-200";
}
