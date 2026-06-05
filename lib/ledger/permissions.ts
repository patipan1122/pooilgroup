// LedgerLine — money-capability permission model (LIFF Admin Console, GAP 5).
//
// THE authz gate (server-only, DB). Pure constants/labels/defaults live in
// permission-constants.ts (client-safe); re-exported here for back-compat so
// existing server imports (`from "@/lib/ledger/permissions"`) keep working.
//
// `can()` is the SINGLE money-capability gate — call it from LIFF actions, LINE
// commands, and web money-actions so the two role systems can never diverge
// (workshop lesson W-013). A missing override row → the code DEFAULTS. It governs
// the LEDGER role (ledger_line_member.role) in the LINE/LIFF context; the web
// keeps its own requireRole gates as well.

import { prisma } from "@/lib/prisma";
import {
  LEDGER_ROLES,
  PERMISSION_DEFAULTS,
  isLedgerRole,
  isLedgerCapability,
  type LedgerRole,
  type LedgerCapability,
} from "./permission-constants";

export {
  LEDGER_ROLES,
  LEDGER_CAPABILITIES,
  ROLE_LABEL,
  ROLE_HINT,
  CAPABILITY_LABEL,
  PERMISSION_DEFAULTS,
  isLedgerRole,
  isLedgerCapability,
  defaultCan,
  type LedgerRole,
  type LedgerCapability,
} from "./permission-constants";

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
  return row ? row.allowed : PERMISSION_DEFAULTS[role][capability];
}

/** Full effective matrix for an org (defaults merged with overrides) — สิทธิ์ tab. */
export async function getPermissionMatrix(
  orgId: string,
): Promise<Record<LedgerRole, Record<LedgerCapability, boolean>>> {
  const out = cloneDefaults();
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

function cloneDefaults(): Record<LedgerRole, Record<LedgerCapability, boolean>> {
  const out = {} as Record<LedgerRole, Record<LedgerCapability, boolean>>;
  for (const role of LEDGER_ROLES) {
    out[role] = { ...PERMISSION_DEFAULTS[role] };
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
