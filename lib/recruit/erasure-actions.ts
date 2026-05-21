"use server";

// Admin server actions for PDPA right-to-erasure decisions

import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { canRecruitAdmin } from "./role-guard";

export async function approveErasure(requestId: string, note?: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const req = await prisma.recruitErasureRequest.findUnique({
    where: { id: requestId },
    include: {
      applicant: {
        include: {
          applications: {
            select: {
              id: true,
              files: true,
            },
          },
        },
      },
    },
  });
  if (!req) throw new Error("ไม่พบคำขอ");
  if (req.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");
  if (req.status !== "PENDING") throw new Error("คำขอนี้พิจารณาไปแล้ว");

  // Anonymize applicant + applications (don't hard-delete · keep for stats/audit)
  await prisma.$transaction(async (tx) => {
    // Anonymize the applicant
    await tx.recruitApplicant.update({
      where: { id: req.applicantId },
      data: {
        fullName: "[ลบแล้ว]",
        phone: `deleted-${req.applicantId.slice(0, 8)}`,
        email: null,
        lineId: null,
      },
    });

    // Anonymize all applications for this applicant
    // SA fix #3: use Prisma.JsonNull instead of undefined to actually clear JSON fields
    await tx.recruitApplication.updateMany({
      where: { applicantId: req.applicantId },
      data: {
        answers: {},
        files: [],
        aiSummary: null,
        aiStrengths: Prisma.JsonNull,
        aiRisks: Prisma.JsonNull,
        blacklistReason: null,
      },
    });

    // Clear all notes
    await tx.recruitApplicationNote.deleteMany({
      where: {
        application: { applicantId: req.applicantId },
      },
    });

    // Clear all messages
    await tx.recruitMessage.deleteMany({
      where: {
        application: { applicantId: req.applicantId },
      },
    });

    // SA fix #2: also delete interviews (PDPA · interview notes may identify applicant)
    await tx.recruitInterview.deleteMany({
      where: {
        application: { applicantId: req.applicantId },
      },
    });

    // Mark request as completed
    await tx.recruitErasureRequest.update({
      where: { id: requestId },
      data: {
        status: "COMPLETED",
        decidedAt: new Date(),
        decidedById: session.user.id,
        decisionNote: note?.trim() ?? null,
      },
    });
  });

  await audit({
    orgId: req.orgId,
    userId: session.user.id,
    action: "RECRUIT_ERASURE_APPROVED",
    resourceType: "recruit_erasure_request",
    resourceId: requestId,
    diff: { new: { status: "COMPLETED", note: note ?? null } },
  });

  revalidatePath("/recruit/settings/erasure-requests");
  return { ok: true };
}

export async function rejectErasure(requestId: string, note: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");
  if (!note.trim()) throw new Error("ต้องระบุเหตุผลปฏิเสธ");

  const req = await prisma.recruitErasureRequest.findUnique({
    where: { id: requestId },
  });
  if (!req) throw new Error("ไม่พบคำขอ");
  if (req.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");
  if (req.status !== "PENDING") throw new Error("คำขอนี้พิจารณาไปแล้ว");

  await prisma.recruitErasureRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      decidedAt: new Date(),
      decidedById: session.user.id,
      decisionNote: note.trim(),
    },
  });

  await audit({
    orgId: req.orgId,
    userId: session.user.id,
    action: "RECRUIT_ERASURE_REJECTED",
    resourceType: "recruit_erasure_request",
    resourceId: requestId,
    diff: { new: { status: "REJECTED", note } },
  });

  revalidatePath("/recruit/settings/erasure-requests");
  return { ok: true };
}
