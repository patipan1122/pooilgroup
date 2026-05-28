"use server";

// ClawFleet v2 — review decision mutation for the branch-based redesign.
// The v2 anomaly review modal sends the session CODE (not id) + a decision.
// Maps decision → session status, records reviewer + note.
//
// Gracefully no-ops when the session code isn't a real DB row (e.g. the page is
// still showing mock showcase data before the migration + branch-shape reseed).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";

type Result = { ok: true } | { ok: false; error: string };

export type V2Decision = "approve" | "recheck" | "escalate";

export async function reviewV2Session(
  sessionCode: string,
  decision: V2Decision,
  note: string,
): Promise<Result> {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const cf = await prisma.cfCollectionSession.findFirst({
    where: { orgId, sessionCode },
    select: { id: true, branchId: true, groupId: true, group: { select: { branchId: true } } },
  });
  // Mock/showcase row (not in DB yet) — report a soft failure; the client keeps
  // its optimistic toast. Real rows proceed to the status update.
  if (!cf) return { ok: false, error: "ยังเป็นข้อมูลตัวอย่าง · ยังไม่บันทึกจริง (รอ migration + seed)" };

  // branch-access guard
  const allowed = await userBranchIds(session);
  const branchId = cf.branchId ?? cf.group?.branchId ?? null;
  if (allowed !== "ALL" && (!branchId || !allowed.includes(branchId))) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }

  const status =
    decision === "approve" ? "LOCKED" : decision === "recheck" ? "OPEN" : "ANOMALY_REVIEW";
  const reviewNote =
    decision === "escalate" ? `[ESCALATE] ${note}`.trim() : note || null;

  await prisma.cfCollectionSession.update({
    where: { id: cf.id, orgId },
    data: {
      status,
      reviewerId: session.user.id,
      reviewedAt: new Date(),
      reviewNote,
    },
  });

  revalidatePath("/clawfleet/v2/anomalies");
  revalidatePath("/clawfleet/v2/operations");
  revalidatePath("/clawfleet/v2/hub");
  return { ok: true };
}
