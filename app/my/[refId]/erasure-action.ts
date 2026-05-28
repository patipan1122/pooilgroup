"use server";

// Public action — candidate submits right-to-erasure request from /my/[refId]
// Uses adminClient/prisma · no auth · refId is the verifying key.

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";

export async function submitErasureRequest(input: {
  refId: string;
  reason?: string;
}): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
  const refId = input.refId.trim();
  if (!refId) return { ok: false, error: "ไม่มีเลขใบสมัคร" };

  const app = await prisma.recruitApplication.findUnique({
    where: { refId },
    select: { id: true, orgId: true, applicantId: true },
  });
  if (!app) return { ok: false, error: "ไม่พบใบสมัครนี้" };

  // Prevent duplicate pending requests for same applicant
  const existing = await prisma.recruitErasureRequest.findFirst({
    where: {
      orgId: app.orgId,
      applicantId: app.applicantId,
      status: "PENDING",
    },
  });
  if (existing) {
    return { ok: false, error: "คุณส่งคำขอลบข้อมูลไปแล้ว · รอผลการพิจารณา" };
  }

  const req = await prisma.recruitErasureRequest.create({
    data: {
      orgId: app.orgId,
      applicantId: app.applicantId,
      refId,
      reason: input.reason?.trim() ?? null,
      status: "PENDING",
    },
  });

  await audit({
    orgId: app.orgId,
    userId: null,
    action: "RECRUIT_ERASURE_REQUESTED",
    resourceType: "recruit_erasure_request",
    resourceId: req.id,
    diff: { new: { refId, reason: input.reason ?? null } },
  });

  return { ok: true, requestId: req.id };
}
