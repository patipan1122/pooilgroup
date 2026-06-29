"use server";

// CEO 2026-06-29 · "จัดการตู้เสีย" — adjust a chair's per-device suspect
// threshold inline (e.g. bump a quiet placement from 2 → 3 days so it stops
// nagging). Office/Manager+ only.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/chairops/auth/session";

export async function setChairSuspectThreshold(formData: FormData) {
  const session = await requireAuth();
  if (session.user.role === "MAID" || session.user.role === "TECHNICIAN") {
    redirect("/chairops/dashboard");
  }
  const chairId = String(formData.get("chairId") ?? "");
  const raw = Number(formData.get("days") ?? 2);
  const days = Math.max(1, Math.min(60, Number.isFinite(raw) ? Math.round(raw) : 2));
  if (chairId) {
    await prisma.chairopsChair.updateMany({
      where: { id: chairId, orgId: session.user.orgId },
      data: { suspectThresholdDays: days },
    });
  }
  revalidatePath("/chairops/broken-chairs");
}
