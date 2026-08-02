"use server";

// CEO 2026-06-29 · "ตู้เสีย" triage actions — change a (chair, device)'s status
// and append to its history, or adjust its per-device suspect threshold.
// Office/Manager+ only (maids report in the field; technicians use the ticket).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/chairops/auth/session";
import { ChairopsChairCheckStatus } from "@/lib/generated/prisma/enums";

const VALID_STATUS = new Set<string>(Object.values(ChairopsChairCheckStatus));

function revalidate(chairCode: string) {
  revalidatePath("/chairops/damage");
  if (chairCode) revalidatePath(`/chairops/damage/check/${encodeURIComponent(chairCode)}`);
}

/** "🔄 เช็คตู้เสียด่วน" button. The suspect detector runs live on every page load,
 *  so re-checking = re-rendering the page. The old button was a <Link> to the URL
 *  the user was already on → the SPA router treated it as a no-op ("กดแล้วเงียบ").
 *  A server action that revalidates + redirects forces a fresh server render, so the
 *  button actually re-runs the detector and refreshes the list. */
export async function recheckSuspects() {
  const session = await requireAuth();
  if (session.user.role === "MAID" || session.user.role === "TECHNICIAN") {
    redirect("/chairops/dashboard");
  }
  revalidatePath("/chairops/damage");
  // ?checked=1 → the page shows a "✅ เช็คแล้ว" confirmation so the click has
  // visible feedback even when the (deterministic, live) suspect list is
  // unchanged. Without it the recheck felt like a no-op ("กดแล้วเงียบ").
  redirect("/chairops/damage?tab=suspects&checked=1");
}

/** Set the triage status of one (chair, device) + append a log entry. Idempotent:
 *  re-setting the same status with no note is a no-op (no duplicate log spam). */
export async function setCheckStatus(formData: FormData) {
  const session = await requireAuth();
  if (session.user.role === "MAID" || session.user.role === "TECHNICIAN") {
    redirect("/chairops/dashboard");
  }
  const orgId = session.user.orgId;
  const streamKey = String(formData.get("streamKey") ?? "");
  const chairId = String(formData.get("chairId") ?? "");
  const branchId = String(formData.get("branchId") ?? "");
  const chairCode = String(formData.get("chairCode") ?? "");
  const stream = String(formData.get("stream") ?? "");
  const toStatus = String(formData.get("toStatus") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!streamKey || !chairId || !branchId || !chairCode || !stream || !VALID_STATUS.has(toStatus)) {
    revalidate(chairCode);
    return;
  }
  const next = toStatus as ChairopsChairCheckStatus;

  const existing = await prisma.chairopsChairCheck.findUnique({
    where: { orgId_streamKey: { orgId, streamKey } },
    select: { id: true, status: true },
  });
  const fromStatus = existing?.status ?? null;

  // no-op guard: same status + no note → don't write (avoid duplicate history)
  if (existing && fromStatus === next && !note) {
    revalidate(chairCode);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const check = await tx.chairopsChairCheck.upsert({
      where: { orgId_streamKey: { orgId, streamKey } },
      create: {
        orgId,
        branchId,
        chairId,
        chairCode,
        stream,
        streamKey,
        status: next,
        note,
        lastActionById: session.user.id,
        lastActionByName: session.user.displayName,
        lastActionAt: new Date(),
      },
      update: {
        status: next,
        ...(note ? { note } : {}),
        lastActionById: session.user.id,
        lastActionByName: session.user.displayName,
        lastActionAt: new Date(),
      },
    });
    await tx.chairopsChairCheckLog.create({
      data: {
        orgId,
        checkId: check.id,
        action: "STATUS",
        fromStatus,
        toStatus: next,
        note,
        byUserId: session.user.id,
        byName: session.user.displayName,
      },
    });
  });

  revalidate(chairCode);
}

/** Append a free-text note to a (chair, device)'s history without changing status. */
export async function addCheckNote(formData: FormData) {
  const session = await requireAuth();
  if (session.user.role === "MAID" || session.user.role === "TECHNICIAN") {
    redirect("/chairops/dashboard");
  }
  const orgId = session.user.orgId;
  const streamKey = String(formData.get("streamKey") ?? "");
  const chairId = String(formData.get("chairId") ?? "");
  const branchId = String(formData.get("branchId") ?? "");
  const chairCode = String(formData.get("chairCode") ?? "");
  const stream = String(formData.get("stream") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!streamKey || !chairId || !branchId || !chairCode || !stream || !note) {
    revalidate(chairCode);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const check = await tx.chairopsChairCheck.upsert({
      where: { orgId_streamKey: { orgId, streamKey } },
      create: {
        orgId,
        branchId,
        chairId,
        chairCode,
        stream,
        streamKey,
        status: ChairopsChairCheckStatus.PENDING,
        note,
        lastActionById: session.user.id,
        lastActionByName: session.user.displayName,
        lastActionAt: new Date(),
      },
      update: {
        note,
        lastActionById: session.user.id,
        lastActionByName: session.user.displayName,
        lastActionAt: new Date(),
      },
    });
    await tx.chairopsChairCheckLog.create({
      data: {
        orgId,
        checkId: check.id,
        action: "NOTE",
        note,
        byUserId: session.user.id,
        byName: session.user.displayName,
      },
    });
  });

  revalidate(chairCode);
}

/** Adjust a chair's per-device suspect threshold (1–60 days). */
export async function setChairSuspectThreshold(formData: FormData) {
  const session = await requireAuth();
  if (session.user.role === "MAID" || session.user.role === "TECHNICIAN") {
    redirect("/chairops/dashboard");
  }
  const chairId = String(formData.get("chairId") ?? "");
  const chairCode = String(formData.get("chairCode") ?? "");
  const raw = Number(formData.get("days") ?? 2);
  const days = Math.max(1, Math.min(60, Number.isFinite(raw) ? Math.round(raw) : 2));
  if (chairId) {
    await prisma.chairopsChair.updateMany({
      where: { id: chairId, orgId: session.user.orgId },
      data: { suspectThresholdDays: days },
    });
  }
  revalidate(chairCode);
}
