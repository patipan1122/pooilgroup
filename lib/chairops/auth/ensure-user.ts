// Single source of truth for "make the ChairOps permission row match the central
// Pool authorisation". ChairOps keeps its OWN secondary table (`ChairopsUser`,
// schema `chairops`) separate from Pool's `user_modules` grant. Historically the
// only thing that created that row was a LAZY bootstrap inside getSession on
// first access — and it only handled the "no row" case, so a row that already
// existed but was INACTIVE (or stuck at a low role) shadowed an active central
// grant → the user was "program admin" centrally yet got 403 in ChairOps.
//
// This helper reconciles the row against the LIVE grant in one place, used by
// BOTH:
//   - getSession (lazy, on access) — self-heals existing users with no re-save
//   - the central grant API (proactive, when a super-admin ticks the program)
//     so "กดเพิ่มสิทธิตรงกลาง → ไปเพิ่มสิทธิในโปรแกรมย่อยให้ใช้งานได้จริง"
//     (CEO 2026-06-17). See [[program-admin-must-just-work-2026-06-15]].
//
// The grant IS the approval: an active Pool chairops grant (or admin-tier)
// reactivates/creates/upgrades the row. Upgrade-only on role; reactivation only
// when the central grant is active. Never downgrades and never touches a row for
// someone with no grant (e.g. chairops-native maids/office users keep their row
// and role untouched).

import { prisma } from "@/lib/prisma";
import type { ChairopsUser, Prisma } from "@/lib/generated/prisma/client";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";

export interface EnsureChairopsUserInput {
  orgId: string;
  /** Supabase auth id of the user (== Pool `users.id`). */
  authUserId: string;
  email: string | null;
  displayName: string;
  /** Pool authorises this user as a chairops ADMIN (admin-tier OR program-admin grant). */
  grantedAdmin: boolean;
  /** Pool authorises ANY chairops access (admin-tier OR any active chairops grant). */
  grantedAny: boolean;
  /** Where the call came from — recorded in the audit trail. */
  source: string;
}

async function audit(
  orgId: string,
  userId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.chairopsAuditLog.create({
      data: {
        orgId,
        userId,
        action,
        entity: "ChairopsUser",
        entityId: userId,
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  } catch {
    // best-effort — access change already applied
  }
}

/**
 * Returns the live ChairopsUser the caller should act as, or null when the user
 * is not authorised for chairops. Idempotent / race-safe (single-row upserts).
 */
export async function ensureChairopsUser(
  input: EnsureChairopsUserInput,
): Promise<ChairopsUser | null> {
  const { orgId, authUserId, email, displayName, grantedAdmin, grantedAny, source } = input;

  // 1) Row already bound to this auth id.
  const byAuth = await prisma.chairopsUser.findFirst({ where: { authUserId } });
  if (byAuth) {
    // Active chairops-native row with no central grant → leave exactly as-is
    // (a maid/office user created directly in ChairOps keeps their role).
    const patch: { isActive?: boolean; role?: ChairopsUserRole } = {};
    if (!byAuth.isActive && grantedAny) patch.isActive = true;
    if (grantedAdmin && byAuth.role !== ChairopsUserRole.ADMIN) patch.role = ChairopsUserRole.ADMIN;

    if (Object.keys(patch).length === 0) {
      return byAuth.isActive ? byAuth : null; // inactive + no grant → still denied
    }
    const updated = await prisma.chairopsUser
      .update({ where: { id: byAuth.id }, data: patch })
      .catch(() => byAuth);
    await audit(orgId, updated.id, "access.reconcile_from_grant", {
      email,
      source,
      patch,
      previous: { isActive: byAuth.isActive, role: byAuth.role },
    });
    return updated.isActive ? updated : null;
  }

  // 2) No row bound to this auth id → require a grant to create/adopt one.
  if (!grantedAny) {
    await audit(orgId, authUserId, "access.denied_no_chairops_user", {
      email,
      source,
      reason: "no_chairops_user_row_and_no_grant",
    });
    return null;
  }

  // 2a) Orphan row keyed by email (invite / prior seed) — adopt onto this auth id
  // (respect the (orgId,email) unique) and reconcile active+role in one update.
  const byEmail = email
    ? await prisma.chairopsUser.findFirst({ where: { orgId, email } })
    : null;
  if (byEmail) {
    const data: { authUserId?: string; isActive?: boolean; role?: ChairopsUserRole } = {};
    if (byEmail.authUserId !== authUserId) data.authUserId = authUserId;
    if (!byEmail.isActive) data.isActive = true;
    if (grantedAdmin && byEmail.role !== ChairopsUserRole.ADMIN) data.role = ChairopsUserRole.ADMIN;
    const linked =
      Object.keys(data).length === 0
        ? byEmail
        : await prisma.chairopsUser.update({ where: { id: byEmail.id }, data }).catch(() => byEmail);
    if (Object.keys(data).length > 0) {
      await audit(orgId, linked.id, "access.reconcile_from_grant", { email, source, patch: data, via: "email" });
    }
    return linked.isActive ? linked : null;
  }

  // 2b) No row at all → create one derived from the grant.
  const derivedRole = grantedAdmin ? ChairopsUserRole.ADMIN : ChairopsUserRole.OFFICE;
  try {
    const created = await prisma.chairopsUser.create({
      data: { orgId, authUserId, email, displayName, role: derivedRole, isActive: true },
    });
    await audit(orgId, created.id, "access.bootstrap_from_grant", {
      email,
      source,
      derivedRole,
      reason: "user_modules_chairops_grant_or_admin_tier",
    });
    return created;
  } catch {
    // Race: a concurrent request created it first — re-fetch by authUserId.
    const retry = await prisma.chairopsUser.findFirst({ where: { authUserId } });
    return retry?.isActive ? retry : null;
  }
}
