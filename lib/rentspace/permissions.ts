// RentSpace — role-capability permission gate (server-only, DB).
//
// Mirrors lib/ledger/permissions.ts. `can()` is THE gate for the 5 toggleable
// capabilities in permission-constants.ts — call it from server actions and
// page-level access checks so the settings page and the actual enforcement
// can never diverge. A missing override row → the code DEFAULT (current
// hardcoded behavior, unchanged until a super_admin flips a switch).
//
// Added by /bigsolvebug 2026-09-20 (audit doc §8 decision 5).

import { prisma } from "@/lib/prisma";
import {
  RENTSPACE_ROLES,
  PERMISSION_DEFAULTS,
  isRentspaceRole,
  isRentspaceCapability,
  type RentspaceRole,
  type RentspaceCapability,
} from "./permission-constants";

export {
  RENTSPACE_ROLES,
  RENTSPACE_CAPABILITIES,
  ROLE_LABEL,
  ROLE_HINT,
  CAPABILITY_LABEL,
  PERMISSION_DEFAULTS,
  isRentspaceRole,
  isRentspaceCapability,
  defaultCan,
  type RentspaceRole,
  type RentspaceCapability,
} from "./permission-constants";

/**
 * THE authz gate. Returns whether `role` may do `capability` in this org.
 * DB override wins; otherwise the code default. Unknown role/cap → false (deny).
 */
export async function can(
  orgId: string,
  role: string,
  capability: RentspaceCapability,
): Promise<boolean> {
  if (!orgId || !isRentspaceRole(role) || !isRentspaceCapability(capability)) {
    return false;
  }
  const row = await prisma.rentspacePermission.findUnique({
    where: { orgId_role_capability: { orgId, role, capability } },
    select: { allowed: true },
  });
  return row ? row.allowed : PERMISSION_DEFAULTS[role][capability];
}

/** Full effective matrix for an org (defaults merged with overrides) — settings tab. */
export async function getPermissionMatrix(
  orgId: string,
): Promise<Record<RentspaceRole, Record<RentspaceCapability, boolean>>> {
  const out = cloneDefaults();
  if (!orgId) return out;
  const rows = await prisma.rentspacePermission.findMany({
    where: { orgId },
    select: { role: true, capability: true, allowed: true },
  });
  for (const r of rows) {
    if (isRentspaceRole(r.role) && isRentspaceCapability(r.capability)) {
      out[r.role][r.capability] = r.allowed;
    }
  }
  return out;
}

function cloneDefaults(): Record<RentspaceRole, Record<RentspaceCapability, boolean>> {
  const out = {} as Record<RentspaceRole, Record<RentspaceCapability, boolean>>;
  for (const role of RENTSPACE_ROLES) {
    out[role] = { ...PERMISSION_DEFAULTS[role] };
  }
  return out;
}

/** Upsert one override (super_admin toggled a switch). Returns nothing; caller audits. */
export async function setPermission(args: {
  orgId: string;
  role: RentspaceRole;
  capability: RentspaceCapability;
  allowed: boolean;
  updatedBy?: string | null;
}): Promise<void> {
  const { orgId, role, capability, allowed, updatedBy = null } = args;
  await prisma.rentspacePermission.upsert({
    where: { orgId_role_capability: { orgId, role, capability } },
    update: { allowed, updatedBy },
    create: { orgId, role, capability, allowed, updatedBy },
  });
}
