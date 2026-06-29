// Shared per-stream activity compute — the single source of truth for the
// "ตู้เสีย" (broken payment-device) feature. Used by BOTH:
//   • the daily detector (lib/chairops/alerts/detectors/chair-stream-down.ts)
//   • the on-demand "เช็คตู้เสียด่วน" page (read-only · no alert write)
// so the cron and the button can NEVER disagree (one query, one rule).
//
// A chair takes money via 3 physical devices, each its own ChairopsPosDaily column:
//   coin     = coinInsertCount   (ตัวรับเหรียญ · a COUNT)
//   cash     = cashTotal         (ตัวรับแบงค์ · baht, bills only — NOT totalCash
//                                 which folds coin baht in)
//   transfer = onlineTotal       (ตัวรับเงินโอน / QR · baht)
//
// "Suspect broken" = a device that USED to earn (baseline) stopped earning for
// ≥ threshold consecutive days WHILE THE CHAIR IS OTHERWISE ALIVE (some other
// device earned recently). Design rules locked in the feature-workshop spec
// (W-056 / W-058 / W-042):
//   • baseline guard — only watch a device that earned within BASELINE_DAYS.
//     A chair that NEVER takes transfer (static wall-QR → onlineTotal always 0)
//     has no transfer baseline → never alerts transfer. (kills static-QR noise)
//   • mutual-exclusion with detectChairOffline — if the WHOLE chair has been
//     silent ≥ CHAIR_RECENT_DAYS (every device dead), that's CHAIR_OFFLINE's
//     job; we skip it here. A chair matches exactly one detector.
//   • missing PosDaily row ≠ zero. We count zero-days as the chair's OWN rows
//     dated after the device's last-active day (each such row means the chair
//     operated that day but this device earned nothing). Days with no row at all
//     are "no data", never counted. POS-blocked branches are skipped entirely.

import { prisma } from "@/lib/prisma";
import { ChairopsAlertKind } from "@/lib/generated/prisma/enums";

export type StreamKey = "coin" | "cash" | "transfer";

export const STREAM_LABEL: Record<StreamKey, string> = {
  coin: "ตัวรับเหรียญ",
  cash: "ตัวรับแบงค์",
  transfer: "ตัวรับเงินโอน",
};

export interface StreamSuspect {
  orgId: string;
  branchId: string;
  branchName: string;
  chairId: string;
  chairCode: string;
  stream: StreamKey;
  /** `${chairCode}::${stream}` — composite dedup key. */
  streamKey: string;
  lastActiveAt: Date | null;
  daysZero: number;
  threshold: number;
}

const LOOKBACK_DAYS = 35; // fetch window for recent rows
const BASELINE_DAYS = 30; // a device must have earned within this to have a baseline
const CHAIR_RECENT_DAYS = 3; // chair alive if any device earned within this (mutual-exclusion w/ chair-offline WARN=3)
const NEW_INSTALL_GRACE_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function toNum(d: { toNumber: () => number } | number | null | undefined): number {
  if (d == null) return 0;
  return typeof d === "number" ? d : d.toNumber();
}

const STREAM_VALUE: Record<
  StreamKey,
  (r: { coinInsertCount: number; cashTotal: unknown; onlineTotal: unknown }) => number
> = {
  coin: (r) => r.coinInsertCount,
  cash: (r) => toNum(r.cashTotal as never),
  transfer: (r) => toNum(r.onlineTotal as never),
};
const STREAMS: StreamKey[] = ["coin", "cash", "transfer"];

/**
 * Compute every currently-suspect (chair, device) across the org (or all orgs
 * when orgId omitted). Pure read — does NOT write alerts. Newest-suspect-first
 * is not guaranteed; callers sort/cap as needed.
 */
export async function computeStreamSuspects(orgId?: string): Promise<StreamSuspect[]> {
  const chairs = await prisma.chairopsChair.findMany({
    where: { isActive: true, retiredAt: null, ...(orgId ? { orgId } : {}) },
    select: {
      id: true,
      orgId: true,
      chairCode: true,
      branchId: true,
      installedAt: true,
      suspectThresholdDays: true,
      branch: { select: { name: true, orgId: true } },
    },
  });
  if (chairs.length === 0) return [];

  // Skip branches whose POS itself isn't ingested (W-042 — no upload looks like
  // "all devices dead"; POS_NOT_INGESTED owns that case).
  const posBlocked = new Set<string>();
  const blockedRows = await prisma.chairopsAlert.findMany({
    where: {
      kind: ChairopsAlertKind.POS_NOT_INGESTED,
      status: { in: ["OPEN", "ACK"] },
      ...(orgId ? { orgId } : {}),
    },
    select: { branchId: true },
  });
  for (const r of blockedRows) if (r.branchId) posBlocked.add(r.branchId);

  const now = Date.now();
  const since = new Date(now - LOOKBACK_DAYS * DAY_MS);
  const baselineFrontier = new Date(now - BASELINE_DAYS * DAY_MS);
  const chairRecentFrontier = new Date(now - CHAIR_RECENT_DAYS * DAY_MS);

  // Group chairs by branch → one PosDaily query per branch.
  const chairsByBranch = new Map<string, typeof chairs>();
  for (const c of chairs) {
    if (posBlocked.has(c.branchId)) continue;
    const arr = chairsByBranch.get(c.branchId);
    if (arr) arr.push(c);
    else chairsByBranch.set(c.branchId, [c]);
  }

  const suspects: StreamSuspect[] = [];

  for (const [branchId, branchChairs] of chairsByBranch.entries()) {
    const branchOrgId = branchChairs[0]?.branch?.orgId ?? branchChairs[0]?.orgId;
    if (!branchOrgId) continue;
    const branchName = branchChairs[0]?.branch?.name ?? "(ไม่ทราบสาขา)";
    const codes = branchChairs.map((c) => c.chairCode);

    const rows = await prisma.chairopsPosDaily.findMany({
      where: { orgId: branchOrgId, branchId, chairCode: { in: codes }, bizDate: { gte: since } },
      select: {
        chairCode: true,
        bizDate: true,
        coinInsertCount: true,
        cashTotal: true,
        onlineTotal: true,
      },
      orderBy: { bizDate: "asc" },
    });
    // rows per chairCode (ascending by date)
    const rowsByChair = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.chairCode) continue;
      const arr = rowsByChair.get(r.chairCode);
      if (arr) arr.push(r);
      else rowsByChair.set(r.chairCode, [r]);
    }

    for (const chair of branchChairs) {
      // newly installed → no baseline yet
      if (chair.installedAt && now - chair.installedAt.getTime() < NEW_INSTALL_GRACE_MS) continue;
      const chairRows = rowsByChair.get(chair.chairCode);
      if (!chairRows || chairRows.length === 0) continue; // no data → not a stream case

      // last-active day per device
      const lastActive: Record<StreamKey, Date | null> = { coin: null, cash: null, transfer: null };
      for (const r of chairRows) {
        for (const s of STREAMS) {
          if (STREAM_VALUE[s](r) > 0) {
            const d = lastActive[s];
            if (!d || r.bizDate > d) lastActive[s] = r.bizDate;
          }
        }
      }

      // mutual-exclusion: if the WHOLE chair has been silent ≥ CHAIR_RECENT_DAYS
      // (no device active recently), it's a CHAIR_OFFLINE case — skip here.
      const chairLastActive = [lastActive.coin, lastActive.cash, lastActive.transfer]
        .filter((d): d is Date => d != null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      if (!chairLastActive || chairLastActive < chairRecentFrontier) continue;

      const threshold = chair.suspectThresholdDays ?? 2;

      for (const s of STREAMS) {
        const last = lastActive[s];
        // baseline guard: device must have earned within BASELINE_DAYS, else skip
        // (never-used device — e.g. static-QR transfer — has no baseline).
        if (!last || last < baselineFrontier) continue;
        // zero-days = chair's OWN rows dated AFTER this device's last-active day.
        // Each such row = a day the chair operated but this device earned nothing.
        // (missing rows aren't counted — they're "no data", not zero.)
        const daysZero = chairRows.filter((r) => r.bizDate > last).length;
        if (daysZero < threshold) continue;
        suspects.push({
          orgId: branchOrgId,
          branchId,
          branchName,
          chairId: chair.id,
          chairCode: chair.chairCode,
          stream: s,
          streamKey: `${chair.chairCode}::${s}`,
          lastActiveAt: last,
          daysZero,
          threshold,
        });
      }
    }
  }

  return suspects;
}
