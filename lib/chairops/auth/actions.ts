"use server";

// Access-request actions · ChairOps W7 · claude-design Wave-1b
// Per [[chairops-audit-2026-05-25]] (Wave-0 fix BR12 bootstrap denial)
// + [[role-rank-privilege-escalation-guard]].
//
// Background:
//   session.ts removed auto-bootstrap of unknown Pool users into ChairOps.
//   Anyone hitting /chairops/* without a ChairopsUser row now lands in an
//   audit-log entry `access.denied_no_chairops_user`. This file exposes the
//   admin-side "approve / reject" operations the W7 /users/pending workspace
//   calls when triaging that backlog.
//
// Wave-1b STUB scope:
//   - approveAccessRequest(authUserId, role, displayName, primaryBranchId?)
//       → creates ChairopsUser row · marks all denial logs as 'access.approved'
//         (via metadata patch) · writes audit `user.access_approve` row.
//   - rejectAccessRequest(authUserId, reason?)
//       → writes audit `user.access_reject` row with reason · leaves denial
//         logs in place (so the user keeps getting 403; no DB row created).
//
// TODO[claude-design] (Wave 2):
//   - replace metadata-patch with a dedicated `ChairopsAccessRequest` table so
//     we can track request count / first-seen / last-seen properly.
//   - send LINE / email notification to requester on approve / reject.
//   - allow the requester to leave a free-text note when they hit the 403 page
//     (today they have no input — we only see authUserId + Pool role + email).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { canAssignRole } from "@/lib/chairops/auth/role-guards";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const approveSchema = z.object({
  authUserId: zUUID(),
  role: z.enum(ChairopsUserRole),
  displayName: z.string().trim().min(1, "ต้องระบุชื่อ").max(100),
  email: z.string().trim().toLowerCase().email("รูปแบบอีเมลไม่ถูกต้อง"),
  primaryBranchId: z.string().optional().or(z.literal("")),
});

export async function approveAccessRequest(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole("ADMIN");

  const parsed = approveSchema.safeParse({
    authUserId: formData.get("authUserId"),
    role: formData.get("role"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    primaryBranchId: formData.get("primaryBranchId") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  // GUARD (role-rank): cannot approve at/above own rank
  if (!canAssignRole(session.user, parsed.data.role)) {
    return {
      ok: false,
      error: `คุณ (${session.user.role}) ไม่สามารถอนุมัติสิทธิ์ ${parsed.data.role} ได้`,
    };
  }

  // MAID requires branch
  if (parsed.data.role === "MAID" && !parsed.data.primaryBranchId) {
    return { ok: false, error: "แม่บ้านต้องมีสาขาประจำ" };
  }
  if (parsed.data.primaryBranchId) {
    const branch = await prisma.chairopsBranch.findUnique({
      where: { id: parsed.data.primaryBranchId },
    });
    if (!branch) return { ok: false, error: "ไม่พบสาขาที่เลือก" };
  }

  // Idempotency: if a ChairopsUser already exists for this authUserId, treat
  // as approved (denial logs are stale) and just emit audit.
  const existing = await prisma.chairopsUser.findFirst({
    where: { authUserId: parsed.data.authUserId },
  });
  if (existing) {
    await writeAudit({
      userId: session.user.id,
      action: "user.access_approve",
      entity: "User",
      entityId: existing.id,
      metadata: {
        note: "already exists · audit only",
        authUserId: parsed.data.authUserId,
      },
    });
    revalidatePath("/chairops/users/pending");
    revalidatePath("/chairops/users");
    return { ok: true, data: { id: existing.id } };
  }

  // TODO[claude-design]: dedicated ChairopsAccessRequest table (Wave 2).
  // For now we just create the user + audit · denial logs stay as historical
  // trail of "this person tried 4 times then admin approved".
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsUser.create({
      data: {
        authUserId: parsed.data.authUserId,
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        role: parsed.data.role,
        primaryBranchId: parsed.data.primaryBranchId || null,
        isActive: true,
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "user.access_approve",
        entity: "User",
        entityId: row.id,
        newValue: {
          role: row.role,
          displayName: row.displayName,
          primaryBranchId: row.primaryBranchId,
          email: row.email,
        },
        metadata: {
          authUserId: parsed.data.authUserId,
          source: "access-request",
        },
      },
      tx,
    );

    return row;
  });

  revalidatePath("/chairops/users/pending");
  revalidatePath("/chairops/users");
  return { ok: true, data: { id: created.id } };
}

const rejectSchema = z.object({
  authUserId: zUUID(),
  reason: z.string().trim().max(280).optional(),
});

export async function rejectAccessRequest(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireRole("ADMIN");

  const parsed = rejectSchema.safeParse({
    authUserId: formData.get("authUserId"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  // TODO[claude-design]: ChairopsAccessRequest table (Wave 2) → flip status
  // = REJECTED so the next denial log entry can short-circuit and tell the
  // user "your previous request was rejected · contact admin".
  await writeAudit({
    userId: session.user.id,
    action: "user.access_reject",
    entity: "ChairopsUser",
    entityId: parsed.data.authUserId,
    metadata: {
      authUserId: parsed.data.authUserId,
      reason: parsed.data.reason ?? "ไม่ระบุเหตุผล",
    },
  });

  revalidatePath("/chairops/users/pending");
  return { ok: true };
}
