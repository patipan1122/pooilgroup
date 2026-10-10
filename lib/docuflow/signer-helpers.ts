// Shared helpers for the "external document signer" invite flow (CEO
// 2026-10-08) — a user account scoped to ONLY /sign/[placementId] for the
// one placement they were invited to, with zero `user_modules` rows (no
// DocuFlow browse access, no other program access).
//
// Several call sites need the SAME "is this a zero-grant external-signer
// account?" signal:
//   - components/docuflow/signature-placement-editor.tsx (via
//     app/(admin)/docuflow/documents/[id]/signatures/page.tsx) — whether to
//     show the pending-invite badge / revoke button for a placement's signer.
//   - lib/docuflow/invite-signer.ts's revokeDocumentSignerAccess() — guards
//     against becoming a generic deactivate-any-staff backdoor.
//   - app/(admin)/home/page.tsx (item 4) — where to send a staff user when
//     they log in again instead of bouncing them into CashHub.
//   - app/(auth)/invite/[token]/page.tsx (item 5) — whether to show
//     employee-onboarding copy or external-signer copy on invite-accept.
// `isZeroGrantStaffAccount` / `filterZeroGrantStaffUserIds` are the ONE
// definition of "counts as an external signer" — role==="staff" AND zero
// active user_modules rows — so these call sites can't drift apart on what
// that means (see [[feedback-one-rule-two-copies-drifts-2026-09-23]]).
//
// The role==="staff" half matters on its own: admin-tier roles (super_admin
// / org_admin / admin / program_admin) also have zero user_modules rows —
// they bypass the grant check entirely (see lib/auth/module-access.ts
// loadUserModules) — so "zero grants" alone would misflag an admin who
// picked themselves as an internal reviewer via the SignerPicker.

import { prisma } from "@/lib/prisma";

/** Batch version — which of `userIds` are a zero-grant "staff" account
 *  (the exact shape inviteDocumentSigner() produces)? Used where multiple
 *  signers need checking at once (the placement-list page) to avoid N+1. */
export async function filterZeroGrantStaffUserIds(
  userIds: string[],
  orgId: string,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const staffUsers = await prisma.user.findMany({
    where: { id: { in: userIds }, orgId, role: "staff" },
    select: { id: true },
  });
  const staffIds = staffUsers.map((u) => u.id);
  if (staffIds.length === 0) return new Set();

  const grants = await prisma.userModule.findMany({
    where: { orgId, userId: { in: staffIds }, isActive: true },
    select: { userId: true },
  });
  const grantedIds = new Set(grants.map((g) => g.userId));

  return new Set(staffIds.filter((id) => !grantedIds.has(id)));
}

/** Single-user convenience wrapper around filterZeroGrantStaffUserIds —
 *  same definition, just for one id at a time. */
export async function isZeroGrantStaffAccount(
  userId: string,
  orgId: string,
): Promise<boolean> {
  const result = await filterZeroGrantStaffUserIds([userId], orgId);
  return result.has(userId);
}

/** Returns the `/sign/[placementId]` path for this user's most recent
 *  not-yet-signed placement, or null if they have none (e.g. already
 *  signed everything, or this isn't a signer account at all). */
export async function findPendingSignPath(
  userId: string,
  orgId: string,
): Promise<string | null> {
  const placement = await prisma.documentSignaturePlacement.findFirst({
    where: {
      orgId,
      signerUserId: userId,
      signedAt: null,
      document: { isActive: true },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return placement ? `/sign/${placement.id}` : null;
}

/** Combined check used for invite-accept copy: "is this specific pending
 *  invite a document-signer invite?" — zero-grant staff account AND has an
 *  assigned, unsigned placement. (A zero-grant staff user with no placement
 *  at all isn't this flow — could be a mid-provisioning edge case; falls
 *  back to the default employee copy rather than guessing.) */
export async function isDocumentSignerInvite(
  userId: string,
  orgId: string,
): Promise<boolean> {
  if (!(await isZeroGrantStaffAccount(userId, orgId))) return false;
  return (await findPendingSignPath(userId, orgId)) !== null;
}
