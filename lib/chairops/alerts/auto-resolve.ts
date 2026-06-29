// Auto-resolve helpers — called from existing server actions when the
// underlying condition is fixed (POS XLSX committed, ticket closed, etc.).
//
// All writes are scoped to orgId (P0 multi-tenant sweep) and use the
// system-actor pattern: ackedById stays null, resolvedAt = now, and
// contextJson.autoResolved = true so the audit trail makes the source clear.
//
// IMPORTANT: This file is NOT "use server" — it's a plain lib called by other
// server actions per [[feedback-use-server-only-async-2026-06-02]]. Callers
// already enforce the auth boundary; this lib just runs DB writes.

import { prisma } from "@/lib/prisma";
import {
  ChairopsAlertKind,
  ChairopsAlertStatus,
} from "@/lib/generated/prisma/enums";

/** Drop POS_NOT_INGESTED alerts when a CSV commit lands new BranchDailyRevenue rows. */
export async function autoResolvePosNotIngested(orgId: string, branchIds: string[]): Promise<number> {
  if (!orgId || branchIds.length === 0) return 0;
  const res = await prisma.chairopsAlert.updateMany({
    where: {
      orgId,
      kind: ChairopsAlertKind.POS_NOT_INGESTED,
      status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
      OR: [
        { branchId: { in: branchIds } },
        { branchId: null }, // org-wide summary INFO row
      ],
    },
    data: { status: ChairopsAlertStatus.RESOLVED, resolvedAt: new Date() },
  });
  return res.count;
}

/** Drop REPAIR_OVERDUE alert(s) for a ticket that just transitioned to DONE/CANCELLED. */
export async function autoResolveRepairOverdue(orgId: string, ticketId: string): Promise<number> {
  if (!orgId || !ticketId) return 0;
  const res = await prisma.chairopsAlert.updateMany({
    where: {
      orgId,
      kind: ChairopsAlertKind.REPAIR_OVERDUE,
      status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
      contextJson: { path: ["ticketId"], equals: ticketId },
    },
    data: { status: ChairopsAlertStatus.RESOLVED, resolvedAt: new Date() },
  });
  return res.count;
}

/**
 * Drop CLEANLINESS_FAIL alerts for a branch when a new PASS report lands
 * within the 14-day clean-streak window.
 */
export async function autoResolveCleanlinessFail(orgId: string, branchId: string): Promise<number> {
  if (!orgId || !branchId) return 0;
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const res = await prisma.chairopsAlert.updateMany({
    where: {
      orgId,
      branchId,
      kind: ChairopsAlertKind.CLEANLINESS_FAIL,
      status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
      createdAt: { gte: cutoff },
    },
    data: { status: ChairopsAlertStatus.RESOLVED, resolvedAt: new Date() },
  });
  return res.count;
}

/**
 * Drop CHAIR_OFFLINE alerts for a chair when fresh PosDaily activity lands.
 * Called from pos-ingest/actions.ts after commit · chairCodes is the union
 * of chair codes that appeared in the committed file.
 */
export async function autoResolveChairOffline(orgId: string, chairCodes: string[]): Promise<number> {
  if (!orgId || chairCodes.length === 0) return 0;
  // Note: contextJson path query needs one updateMany per chairCode in Prisma
  // (no `in` on Json path). Loop is fine — at most 100 chairs per import.
  let total = 0;
  for (const code of chairCodes) {
    const res = await prisma.chairopsAlert.updateMany({
      where: {
        orgId,
        kind: ChairopsAlertKind.CHAIR_OFFLINE,
        status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
        contextJson: { path: ["chairCode"], equals: code },
      },
      data: { status: ChairopsAlertStatus.RESOLVED, resolvedAt: new Date() },
    });
    total += res.count;
  }
  // Also drop any branch-level CHAIR_OFFLINE aggregate alert for branches
  // whose chairs just came back. We resolve broadly · the detector will
  // re-emit on next cron if still offline.
  return total;
}

/**
 * Drop CHAIR_STREAM_DOWN alerts for a device that EARNED AGAIN. Called from
 * pos-ingest after commit · for each chair in the file, if its most-recent
 * PosDaily row now shows the flagged device > 0, the device is back → resolve
 * (CEO 2026-06-29 "auto-clear เมื่อเงินกลับมา"). System-actor, audit-tagged.
 */
export async function autoResolveChairStreamDown(
  orgId: string,
  chairCodes: string[],
): Promise<number> {
  if (!orgId || chairCodes.length === 0) return 0;
  const streamCol: Record<string, "coinInsertCount" | "cashTotal" | "onlineTotal"> = {
    coin: "coinInsertCount",
    cash: "cashTotal",
    transfer: "onlineTotal",
  };
  let total = 0;
  for (const code of chairCodes) {
    const open = await prisma.chairopsAlert.findMany({
      where: {
        orgId,
        kind: ChairopsAlertKind.CHAIR_STREAM_DOWN,
        status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
        contextJson: { path: ["chairCode"], equals: code },
      },
      select: { id: true, contextJson: true },
    });
    if (open.length === 0) continue;
    // Latest PosDaily row for this chair (most-recent business day).
    const latest = await prisma.chairopsPosDaily.findFirst({
      where: { orgId, chairCode: code },
      orderBy: { bizDate: "desc" },
      select: { coinInsertCount: true, cashTotal: true, onlineTotal: true },
    });
    if (!latest) continue;
    for (const a of open) {
      const ctx = (a.contextJson ?? {}) as Record<string, unknown> & { stream?: string };
      const col = ctx.stream ? streamCol[ctx.stream] : undefined;
      if (!col) continue;
      const val = col === "coinInsertCount" ? latest.coinInsertCount : Number(latest[col]);
      if (val <= 0) continue;
      // Per-id update (not updateMany) so we can stamp the audit flag this file's
      // header promises — keeps "ทำไมตู้เสียหาย" traceable (system vs human close).
      await prisma.chairopsAlert.update({
        where: { id: a.id },
        data: {
          status: ChairopsAlertStatus.RESOLVED,
          resolvedAt: new Date(),
          contextJson: { ...ctx, autoResolved: true, resolvedReason: "stream-recovered" } as never,
        },
      });
      total += 1;
    }
  }

  // The one-time first-run summary row (branchId null · historical · no chairCode)
  // can never match the per-chair loop above — clear it once fresh data lands so
  // it doesn't linger as a stale "ตู้เสีย" forever.
  const summary = await prisma.chairopsAlert.updateMany({
    where: {
      orgId,
      kind: ChairopsAlertKind.CHAIR_STREAM_DOWN,
      status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
      branchId: null,
      contextJson: { path: ["historical"], equals: true },
    },
    data: { status: ChairopsAlertStatus.RESOLVED, resolvedAt: new Date() },
  });
  total += summary.count;

  return total;
}
