"use server";

// Server actions for the missed-maids card · BF1 OWN-05 fix.
// Replaces the old sms:phone1,phone2,... bulk-reminder which the OS would
// often refuse to handle (comma-list is non-standard). Now pushes via LINE
// OA group channel (`notifyChannel("ops", ...)`) — same channel CEO + ops
// already use for daily summaries.

import { requireRole } from "@/lib/chairops/auth/session";
import { notifyChannel } from "@/lib/chairops/line/messaging";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import type { ActionResult } from "../maids/types";

export async function pingMissedMaids(
  branchSummaries: Array<{ branchName: string; maidName: string | null }>,
): Promise<ActionResult<{ sent: boolean }>> {
  await requireRole(ChairopsUserRole.OFFICE);

  if (branchSummaries.length === 0) {
    return { ok: false, error: "ไม่มีรายการให้แจ้งเตือน" };
  }
  const lines = branchSummaries
    .slice(0, 20)
    .map(
      (b, i) =>
        `${i + 1}. ${b.branchName}${b.maidName ? ` · ${b.maidName}` : " · ยังไม่มีแม่บ้าน"}`,
    );
  const text = [
    "⏰ แม่บ้านยังไม่ส่งยอด (cut-off 17:00)",
    ...lines,
    branchSummaries.length > 20 ? `+ อีก ${branchSummaries.length - 20} สาขา` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const r = await notifyChannel("ops", text);
  if (!r.ok) {
    return { ok: false, error: "ส่ง LINE ไม่สำเร็จ · ลองใหม่อีกครั้ง" };
  }
  return { ok: true, data: { sent: true } };
}
