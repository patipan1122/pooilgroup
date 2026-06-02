// D1 · POS_NOT_INGESTED detector.
//
// Scans every active branch · returns NewAlert[] for branches whose latest
// ChairopsBranchDailyRevenue.bizDate is older than the WARN threshold (2 days)
// or CRITICAL threshold (4 days). Uses Bangkok-local "yesterday" as the
// expected biz-date frontier so a cron at 09:00 BKK still considers
// yesterday's data current.
//
// Auto-resolve hook lives in pos-ingest/actions.ts → autoResolvePosNotIngested.
//
// Per spec: emit ONE INFO summary if this is the org's first time seeing
// POS_NOT_INGESTED (prevents 62-day backfill alert storm).
import { prisma } from "@/lib/prisma";
import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  findOpenAlert,
  isFirstRun,
  PER_DETECTOR_EMIT_CAP,
  type NewAlert,
} from "@/lib/chairops/alerts/_shared";

const WARN_DAYS = 2;
const CRITICAL_DAYS = 4;
const ORG_WIDE_CRITICAL_FRACTION = 0.8;

/**
 * Compute Bangkok-local midnight for the date that is `daysBack` days before
 * "today BKK". Returns a UTC Date such that the ChairopsBranchDailyRevenue
 * `bizDate` column (DATE type, midnight UTC by Prisma convention) compares
 * cleanly.
 */
function bangkokDateDaysAgo(daysBack: number): Date {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // Bangkok midnight on `ymd` in UTC = `ymd 00:00:00+07:00` → subtract 7h to UTC.
  const todayBkkStart = new Date(`${ymd}T00:00:00+07:00`);
  return new Date(todayBkkStart.getTime() - daysBack * 86_400_000);
}

export async function detectPosNotIngested(orgId?: string): Promise<NewAlert[]> {
  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true, ...(orgId ? { orgId } : {}) },
    select: { id: true, name: true, orgId: true, openedAt: true },
  });
  if (branches.length === 0) return [];

  const out: NewAlert[] = [];
  const yesterdayBkk = bangkokDateDaysAgo(1);
  const warnFrontier = bangkokDateDaysAgo(WARN_DAYS);
  const criticalFrontier = bangkokDateDaysAgo(CRITICAL_DAYS);

  // Per-org first-run check — only suppresses N-row backfill, not real ongoing alerts.
  const firstRunCache = new Map<string, boolean>();
  async function firstRunFor(thisOrgId: string): Promise<boolean> {
    const cached = firstRunCache.get(thisOrgId);
    if (cached !== undefined) return cached;
    const first = await isFirstRun(thisOrgId, ChairopsAlertKind.POS_NOT_INGESTED);
    firstRunCache.set(thisOrgId, first);
    return first;
  }

  // Per-org branch totals for the org-wide CRITICAL escalation rule.
  const orgBranchCounts = new Map<string, number>();
  for (const b of branches) {
    orgBranchCounts.set(b.orgId, (orgBranchCounts.get(b.orgId) ?? 0) + 1);
  }
  const orgMissingCounts = new Map<string, number>();

  for (const branch of branches) {
    if (out.length >= PER_DETECTOR_EMIT_CAP) break;

    const latest = await prisma.chairopsBranchDailyRevenue.findFirst({
      where: { orgId: branch.orgId, branchId: branch.id },
      orderBy: { bizDate: "desc" },
      select: { bizDate: true },
    });

    // No data ever → treat as missing only if branch is older than 7 days
    // (new branches won't have data yet · skip noise).
    if (!latest) {
      if (branch.openedAt && Date.now() - branch.openedAt.getTime() < 7 * 86_400_000) {
        continue;
      }
    } else if (latest.bizDate >= yesterdayBkk) {
      // Fresh — yesterday's data already ingested.
      continue;
    } else if (latest.bizDate >= warnFrontier) {
      // 1 day late · not yet a problem (cron runs once daily; can't catch sub-day).
      continue;
    }

    // Skip duplicate (already OPEN/ACK).
    const existing = await findOpenAlert({
      orgId: branch.orgId,
      kind: ChairopsAlertKind.POS_NOT_INGESTED,
      branchId: branch.id,
    });
    if (existing) continue;

    // First-run guard — if no POS_NOT_INGESTED ever for this org, skip the
    // per-branch emit and let the org-wide summary handle it (below).
    if (await firstRunFor(branch.orgId)) {
      orgMissingCounts.set(branch.orgId, (orgMissingCounts.get(branch.orgId) ?? 0) + 1);
      continue;
    }

    const lastDate = latest?.bizDate ?? null;
    const daysMissing = lastDate
      ? Math.floor((yesterdayBkk.getTime() - lastDate.getTime()) / 86_400_000) + 1
      : 999;
    const level = lastDate && lastDate >= criticalFrontier
      ? ChairopsAlertLevel.WARN
      : ChairopsAlertLevel.CRITICAL;

    out.push({
      orgId: branch.orgId,
      branchId: branch.id,
      kind: ChairopsAlertKind.POS_NOT_INGESTED,
      level,
      title: `POS ยังไม่นำเข้า · ${branch.name} (ขาด ${daysMissing} วัน)`,
      message: lastDate
        ? `ข้อมูลล่าสุด ${lastDate.toISOString().slice(0, 10)} · กรุณานำเข้า XLSX`
        : `ยังไม่เคยนำเข้า POS · กรุณาอัปโหลด XLSX`,
      contextJson: {
        daysMissing,
        lastBizDate: lastDate ? lastDate.toISOString().slice(0, 10) : null,
        linkPath: "/chairops/pos-ingest",
        source: "ingest-watchdog",
      },
      channels: level === ChairopsAlertLevel.CRITICAL ? ["finance", "ceo"] : ["finance"],
    });

    orgMissingCounts.set(branch.orgId, (orgMissingCounts.get(branch.orgId) ?? 0) + 1);
  }

  // First-run summary — emit ONE INFO per org instead of dozens of WARNs.
  for (const [thisOrgId, missing] of orgMissingCounts.entries()) {
    if (!(await firstRunFor(thisOrgId))) continue;
    if (missing === 0) continue;
    const total = orgBranchCounts.get(thisOrgId) ?? 0;
    // Skip if existing summary INFO already filed today.
    const existing = await findOpenAlert({
      orgId: thisOrgId,
      kind: ChairopsAlertKind.POS_NOT_INGESTED,
      branchId: null,
    });
    if (existing) continue;
    out.push({
      orgId: thisOrgId,
      branchId: null,
      kind: ChairopsAlertKind.POS_NOT_INGESTED,
      level: ChairopsAlertLevel.INFO,
      title: `POS เงียบหลายสาขา · ตามแก้ย้อนหลัง`,
      message: `${missing} / ${total} สาขาไม่มีข้อมูล POS ล่าสุด · กรุณานำเข้า XLSX แบบ batch`,
      contextJson: {
        historical: true,
        branchesAffected: missing,
        totalBranches: total,
        linkPath: "/chairops/pos-ingest",
        source: "ingest-watchdog-first-run",
      },
      channels: missing / Math.max(1, total) >= ORG_WIDE_CRITICAL_FRACTION
        ? ["finance", "ceo"]
        : ["finance"],
    });
  }

  return out;
}
