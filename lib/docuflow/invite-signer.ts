"use server";

// DocuFlow external-signer invite (CEO 2026-10-08) — lets a DocuFlow admin
// invite a true outsider (no existing Pooilgroup account) to sign exactly
// ONE document placement, without giving them browse access to DocuFlow's
// other documents or any other program.
//
// Deliberately NOT `inviteProgramStaff()` (lib/auth/program-invite.ts):
// that function always calls `grantModuleAdmin()`, which grants a
// user_modules row giving full view of every DocuFlow document/report —
// broader than an external counterparty should ever get. This path mints
// the same kind of pending invite-link user (via the shared
// `createInviteLinkUser()` primitive, same rank-capping rule as every other
// invite flow) but skips the module grant entirely: the resulting account
// has ZERO user_modules rows. Its only avenue into the app is
// `/sign/[placementId]` — see app/sign/[placementId]/page.tsx's existing
// (unchanged) auth check: `placement.signerUserId === session.user.id`
// passes regardless of role or module grants.
//
// Atomicity note: user creation goes through the Supabase admin client
// (createInviteLinkUser, shared with every other invite flow) while the
// placement update goes through Prisma — two different connections to the
// same Postgres instance, so there is no single BEGIN/COMMIT spanning both.
// This mirrors the exact compensating-rollback pattern `inviteProgramStaff()`
// already uses for its own two-step create-user-then-grant-module sequence
// (see program-invite.ts): if the placement update fails after the user was
// created, we delete the just-created user rather than leaving it orphaned.
// Residual risk: if THAT compensating delete also fails (e.g. a transient
// network blip right after a transient DB error), an inert placeholder user
// is left behind — is_active=false, zero module grants, not attached to any
// placement. It cannot sign anything and cannot see anything if it somehow
// got activated, so the blast radius is "one harmless unused row," not a
// security gap — but it is NOT a textbook atomic transaction. Flagged
// explicitly rather than overstating confidence.

import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { canAssignRole, isAdminTier } from "@/lib/auth/role-guards";
import { createInviteLinkUser } from "@/lib/auth/invite";
import { deactivateUserAccount } from "@/lib/auth/deactivate-user";
import { isZeroGrantStaffAccount } from "@/lib/docuflow/signer-helpers";
import { audit } from "@/lib/audit/log";
import { getBaseUrl } from "@/lib/utils/base-url";
import { zUUID } from "@/lib/zod-helpers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEMENT_ID_RE = zUUID();

function buildInviteUrl(token: string, placementId: string): string {
  const next = encodeURIComponent(`/sign/${placementId}`);
  return `${getBaseUrl()}/invite/${token}?next=${next}`;
}

export type InviteDocumentSignerResult =
  | {
      ok: true;
      inviteUrl: string;
      expiresAt: string;
      userId: string;
      userName: string;
      /** True when this returned an ALREADY-pending invite for this exact
       *  placement+email instead of creating a new one (double-click guard). */
      reused: boolean;
    }
  | { ok: false; error: string };

export async function inviteDocumentSigner(input: {
  placementId: string;
  name: string;
  email?: string;
  phone?: string;
}): Promise<InviteDocumentSignerResult> {
  if (!PLACEMENT_ID_RE.safeParse(input.placementId).success) {
    return { ok: false, error: "ไม่พบจุดเซ็นนี้" };
  }

  const session = await requireSession();
  if (!(await userIsModuleAdmin(session.user, "docuflow"))) {
    return { ok: false, error: "เฉพาะแอดมินของ DocuFlow เท่านั้นที่เชิญผู้เซ็นภายนอกได้" };
  }
  // ตำแหน่งที่เชิญ (staff) ต้องต่ำกว่าตำแหน่งของคนเชิญเสมอ — กฎเดียวกับ
  // inviteProgramStaff() ทุกประการ
  if (!canAssignRole(session.user.role, "staff")) {
    return { ok: false, error: "ตำแหน่งของคุณไม่สามารถเชิญผู้เซ็นได้" };
  }

  const name = input.name.trim();
  if (!name) return { ok: false, error: "กรุณากรอกชื่อ" };
  if (name.length > 100) return { ok: false, error: "ชื่อยาวเกินไป" };

  const email = input.email?.trim() || undefined;
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: "รูปแบบอีเมลไม่ถูกต้อง" };
  }
  const phone = input.phone?.trim() || undefined;

  const orgId = session.user.org_id;

  const placement = await prisma.documentSignaturePlacement.findFirst({
    where: { id: input.placementId, orgId },
    include: {
      document: { select: { isActive: true } },
      signerUser: {
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          inviteToken: true,
          inviteExpiresAt: true,
          inviteUsedAt: true,
        },
      },
    },
  });
  if (!placement || !placement.document.isActive) {
    return { ok: false, error: "ไม่พบจุดเซ็นนี้" };
  }
  if (placement.placementType && placement.placementType !== "signature") {
    return { ok: false, error: "เชิญผู้เซ็นได้เฉพาะจุดประเภท \"เซ็น\" เท่านั้น" };
  }
  if (placement.signedAt) {
    return { ok: false, error: "จุดนี้เซ็นไปแล้ว — ไม่ต้องเชิญใหม่" };
  }

  // Idempotency — a double-click (or a slow retry) with the SAME email for
  // the SAME placement must not mint a second user/token. Only short-circuit
  // when the email actually matches an existing still-pending invite; a
  // different email means the admin deliberately picked a different
  // invitee, which should proceed (replacing the stale invite below).
  const existingSigner = placement.signerUser;
  if (
    existingSigner &&
    !existingSigner.isActive &&
    existingSigner.inviteToken &&
    existingSigner.inviteExpiresAt &&
    existingSigner.inviteExpiresAt.getTime() > Date.now() &&
    !existingSigner.inviteUsedAt &&
    email &&
    existingSigner.email &&
    existingSigner.email.trim().toLowerCase() === email.toLowerCase()
  ) {
    return {
      ok: true,
      inviteUrl: buildInviteUrl(existingSigner.inviteToken, input.placementId),
      expiresAt: existingSigner.inviteExpiresAt.toISOString(),
      userId: existingSigner.id,
      userName: existingSigner.name,
      reused: true,
    };
  }

  const admin = adminClient();

  const created = await createInviteLinkUser(admin, {
    orgId,
    name,
    email,
    phone,
    role: "staff",
    invitedBy: session.user.id,
  });
  if (!created.ok) return { ok: false, error: created.error };

  try {
    await prisma.documentSignaturePlacement.update({
      where: { id: input.placementId },
      data: { signerUserId: created.userId },
    });
  } catch (err) {
    // Compensate — same pattern inviteProgramStaff() uses when
    // grantModuleAdmin() fails: don't leave a created-but-unassigned user.
    console.error("inviteDocumentSigner: placement update failed", err);
    await admin.from("users").delete().eq("id", created.userId);
    return { ok: false, error: "ผูกจุดเซ็นกับผู้ใช้ใหม่ไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_SIGNER_INVITED",
    resourceType: "document_signature_placement",
    resourceId: input.placementId,
    diff: {
      new: {
        documentId: placement.documentId,
        signerUserId: created.userId,
        name,
        email: email ?? null,
      },
    },
  });

  return {
    ok: true,
    inviteUrl: buildInviteUrl(created.token, input.placementId),
    expiresAt: created.expiresAt,
    userId: created.userId,
    userName: name,
    reused: false,
  };
}

export type RevokeDocumentSignerResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Deactivate an external signer's account once their signature is no longer
 * needed (e.g. after the document is fully signed). Deliberately restricted
 * to org-wide admin tier (same gate as the existing DELETE
 * /api/admin/users/[id] route this reuses) rather than docuflow-module-admin
 * tier — deactivating a real user ACCOUNT is a bigger blast radius than
 * managing one program's documents, so it should require the same authority
 * as the general "deactivate any user" action already does.
 *
 * Only allowed when the target is exactly the shape this invite flow
 * produces (role=staff, zero active module grants) — guards against this
 * becoming a generic deactivate-via-docuflow backdoor for unrelated staff.
 */
export async function revokeDocumentSignerAccess(input: {
  placementId: string;
}): Promise<RevokeDocumentSignerResult> {
  if (!PLACEMENT_ID_RE.safeParse(input.placementId).success) {
    return { ok: false, error: "ไม่พบจุดเซ็นนี้" };
  }

  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลระบบระดับองค์กรเท่านั้นที่ปิดบัญชีได้" };
  }
  const orgId = session.user.org_id;

  const placement = await prisma.documentSignaturePlacement.findFirst({
    where: { id: input.placementId, orgId },
    select: {
      id: true,
      signerUserId: true,
      signerUser: { select: { id: true, isActive: true } },
    },
  });
  if (!placement || !placement.signerUserId || !placement.signerUser) {
    return { ok: false, error: "จุดนี้ไม่มีผู้เซ็นที่เป็นบัญชีผู้ใช้" };
  }
  if (placement.signerUserId === session.user.id) {
    return { ok: false, error: "ปิดบัญชีตัวเองไม่ได้" };
  }
  if (!placement.signerUser.isActive) {
    return { ok: false, error: "บัญชีนี้ปิดอยู่แล้ว" };
  }
  if (!(await isZeroGrantStaffAccount(placement.signerUserId, orgId))) {
    return {
      ok: false,
      error:
        "ปิดได้เฉพาะบัญชีผู้เซ็นภายนอกที่เชิญผ่านช่องทางนี้เท่านั้น (ไม่มีสิทธิ์เข้าโปรแกรมอื่น)",
    };
  }

  const admin = adminClient();
  await deactivateUserAccount(admin, placement.signerUserId);

  await audit({
    orgId,
    userId: session.user.id,
    action: "DOCUFLOW_SIGNER_REVOKED",
    resourceType: "document_signature_placement",
    resourceId: input.placementId,
    diff: { old: { signerUserId: placement.signerUserId } },
  });

  return { ok: true };
}
