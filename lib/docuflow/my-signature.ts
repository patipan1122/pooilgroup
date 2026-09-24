// "ลายเซ็นของฉัน" — one saved signature image per user, reused across
// DocuFlow signing events instead of drawing fresh every time.
// ────────────────────────────────────────────────────────────────────
// Personal setting, NOT DocuFlow-admin-only — every signed-in user can
// save their own signature. Callers (API routes, pages) are responsible
// for resolving `userId`/`orgId` from the session; this module never
// trusts a caller-supplied identity beyond what it's given.
//
// Storage: R2 key `signatures/profile/{orgId}/{userId}/{ts}.png`
//          (distinct from `signatures/{orgId}/{placementId}/{ts}.png`,
//          the per-signing-event key used by sign/route.ts — this is the
//          reusable source, that one is an immutable per-document copy).
// DB:      User.savedSignatureKey + User.savedSignatureUpdatedAt
//          (nullable — NULL means no saved signature yet).
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { deleteObject, putObject } from "@/lib/r2/upload";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";

/**
 * Save (or replace) the caller's signature image.
 *
 * Sequence mirrors the rollback discipline already used in
 * `app/api/docuflow/[id]/signatures/[placementId]/sign/route.ts` — upload
 * to R2 first, then write the DB; if the DB write fails, roll back by
 * deleting the just-uploaded (now-orphan) key. The one addition here is
 * the *inverse* cleanup on success: once the DB confirms `key` as the new
 * saved signature, the PREVIOUS key (if any) is deleted so old versions
 * don't pile up in R2 forever.
 */
export async function saveMySignature({
  userId,
  orgId,
  pngBuffer,
}: {
  userId: string;
  orgId: string;
  pngBuffer: Buffer;
}): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { savedSignatureKey: true },
  });
  const previousKey = existing?.savedSignatureKey ?? null;

  const key = `signatures/profile/${orgId}/${userId}/${Date.now()}.png`;

  try {
    await putObject(key, pngBuffer, "image/png");
  } catch (err) {
    console.error("[my-signature] R2 upload failed", err);
    throw new Error("อัปโหลดลายเซ็นไม่สำเร็จ ลองใหม่");
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        savedSignatureKey: key,
        savedSignatureUpdatedAt: new Date(),
      },
    });
  } catch (err) {
    // DB write failed → the NEW upload is the orphan (the DB still points
    // at `previousKey`, if any) — clean up the new key, not the old one.
    console.error(
      "[my-signature] DB update failed — rolling back R2 upload",
      err,
    );
    await deleteObject(key);
    throw new Error("บันทึกลายเซ็นไม่สำเร็จ ลองใหม่");
  }

  // Success: DB now points at `key`. Clean up the previous version.
  // Best-effort (deleteObject already swallows its own errors) — a leaked
  // old key is harmless clutter, not a correctness issue.
  if (previousKey && previousKey !== key) {
    await deleteObject(previousKey);
  }
}

/**
 * Admin sets (or replaces) ANOTHER user's saved signature — e.g. during
 * onboarding, or when a user can't draw their own. Distinct from
 * `saveMySignature` (self-service, `/profile/signature`): the caller here
 * is never the signature's owner, so this function independently
 * re-verifies `targetUserId` belongs to the same org as the acting admin
 * before touching anything. This check does NOT rely on the API route
 * having already filtered by org — defense in depth, since this module
 * writes via prisma (bypasses RLS) and any future caller must be unable
 * to reach across orgs even if a route-level check were ever missed.
 *
 * Once verified, this reuses `saveMySignature` as-is for the actual
 * upload/DB-write/old-key-cleanup — that function is already generic over
 * any `userId`, so no duplication or refactor is needed here.
 */
export async function saveUserSignatureAsAdmin({
  actorUserId,
  actorOrgId,
  targetUserId,
  pngBuffer,
}: {
  actorUserId: string;
  actorOrgId: string;
  targetUserId: string;
  pngBuffer: Buffer;
}): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { orgId: true },
  });
  if (!target || target.orgId !== actorOrgId) {
    // Never let an admin from org A bind a signature onto a user in org B.
    console.error("[my-signature] admin org-mismatch blocked", {
      actorUserId,
      actorOrgId,
      targetUserId,
      targetOrgId: target?.orgId ?? null,
    });
    throw new Error("ไม่พบผู้ใช้นี้ในองค์กรของคุณ");
  }

  await saveMySignature({
    userId: targetUserId,
    orgId: target.orgId,
    pngBuffer,
  });
}

/**
 * Short-lived signed download URL for a user's saved signature, or `null`
 * if they haven't saved one yet. Despite the "My" in the file's original
 * naming, this is already generic over any `userId` — used both by the
 * self-service page (with `session.user.id`) and the admin-on-behalf-of
 * API route (`app/api/users/[id]/signature`, with a target user's id that
 * the route has already confirmed is in the caller's org).
 */
export async function getMySignatureUrl(
  userId: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { savedSignatureKey: true },
  });
  if (!user?.savedSignatureKey) return null;
  return getSignedDownloadUrl(user.savedSignatureKey);
}

/**
 * Delete a user's saved signature — both the R2 object and the DB columns.
 * Generic over any `userId` (see `getMySignatureUrl` note above) — callers
 * are responsible for authorizing `userId` before calling this.
 */
export async function clearMySignature(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { savedSignatureKey: true },
  });
  const key = user?.savedSignatureKey ?? null;

  // DB is the source of truth for "does a saved signature exist" — null it
  // out first. If this throws, nothing in R2 has been touched yet.
  await prisma.user.update({
    where: { id: userId },
    data: { savedSignatureKey: null, savedSignatureUpdatedAt: null },
  });

  if (key) {
    await deleteObject(key);
  }
}
