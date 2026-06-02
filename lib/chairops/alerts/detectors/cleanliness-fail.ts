// D3 · CLEANLINESS_FAIL detector (cron backstop — primary path is event-driven
// via emitCleanlinessFailIfNeeded called from the cleanliness submit action).
//
// Cron scans cleanliness reports from the past 24h with grade=FAIL and emits
// alerts that DIDN'T get caught by the event hook (defensive — covers the case
// where the event-hook fire-and-forget swallowed an error, or the row landed
// via a backfill script).
//
// Escalation:
//   WARN  · single FAIL in the last 7d for this branch.
//   CRIT  · 2× FAIL in the last 7d for this branch.
//
// Auto-resolve: next PASS report for same branch within 14d → RESOLVED (handled
// in cleanliness/actions.ts when grade=PASS).

import { prisma } from "@/lib/prisma";
import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  findOpenAlert,
  isFirstRun,
  PER_DETECTOR_EMIT_CAP,
  type NewAlert,
} from "@/lib/chairops/alerts/_shared";
import { ChairopsCleanlinessGrade } from "@/lib/generated/prisma/enums";

export async function detectCleanlinessFail(orgId?: string): Promise<NewAlert[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const fails = await prisma.chairopsCleanlinessReport.findMany({
    where: {
      grade: ChairopsCleanlinessGrade.FAIL,
      reportedAt: { gte: since },
      ...(orgId ? { orgId } : {}),
    },
    orderBy: { reportedAt: "desc" },
    select: {
      id: true,
      orgId: true,
      branchId: true,
      byMaidId: true,
      photoUrls: true,
      reportedAt: true,
      branch: { select: { name: true } },
    },
  });
  if (fails.length === 0) return [];

  const out: NewAlert[] = [];

  // First-run guard (org-level).
  const firstRunCache = new Map<string, boolean>();
  async function firstRunFor(thisOrgId: string): Promise<boolean> {
    const cached = firstRunCache.get(thisOrgId);
    if (cached !== undefined) return cached;
    const first = await isFirstRun(thisOrgId, ChairopsAlertKind.CLEANLINESS_FAIL);
    firstRunCache.set(thisOrgId, first);
    return first;
  }

  for (const f of fails) {
    if (out.length >= PER_DETECTOR_EMIT_CAP) break;

    // Skip if this report already has an alert (event-hook caught it).
    const existing = await findOpenAlert({
      orgId: f.orgId,
      kind: ChairopsAlertKind.CLEANLINESS_FAIL,
      branchId: f.branchId,
      entityKey: "reportId",
      entityValue: f.id,
    });
    if (existing) continue;

    if (await firstRunFor(f.orgId)) {
      // First time ever for this org · emit ONE summary at first iteration.
      const summaryExisting = await findOpenAlert({
        orgId: f.orgId,
        kind: ChairopsAlertKind.CLEANLINESS_FAIL,
        branchId: null,
      });
      if (summaryExisting) continue;
      out.push({
        orgId: f.orgId,
        branchId: null,
        kind: ChairopsAlertKind.CLEANLINESS_FAIL,
        level: ChairopsAlertLevel.INFO,
        title: `ตรวจสภาพไม่ผ่านครั้งแรก · ตามแก้ย้อนหลัง`,
        message: `มี FAIL ${fails.length} รายการใน 24 ชม. · ตรวจสอบรายงาน`,
        contextJson: {
          historical: true,
          linkPath: "/chairops/cleanliness",
          source: "ingest-watchdog-first-run",
        },
        channels: ["ops"],
      });
      break; // suppress per-report emits on first run
    }

    // Count FAILs in last 7d for this branch — drives WARN vs CRIT level.
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const failCount7d = await prisma.chairopsCleanlinessReport.count({
      where: {
        orgId: f.orgId,
        branchId: f.branchId,
        grade: ChairopsCleanlinessGrade.FAIL,
        reportedAt: { gte: sevenDaysAgo },
      },
    });
    const level = failCount7d >= 2
      ? ChairopsAlertLevel.CRITICAL
      : ChairopsAlertLevel.WARN;

    out.push({
      orgId: f.orgId,
      branchId: f.branchId,
      kind: ChairopsAlertKind.CLEANLINESS_FAIL,
      level,
      title: `ตรวจสภาพไม่ผ่าน · ${f.branch.name}`,
      message: failCount7d >= 2
        ? `ไม่ผ่าน ${failCount7d} ครั้งใน 7 วัน · ตรวจสอบด่วน`
        : `แม่บ้านรายงาน FAIL · ตรวจสอบรูปภาพ`,
      contextJson: {
        reportId: f.id,
        byMaidId: f.byMaidId,
        photoUrls: f.photoUrls,
        failCount7d,
        linkPath: `/chairops/cleanliness/${f.id}`,
        source: "ingest-watchdog-backstop",
      },
      channels: level === ChairopsAlertLevel.CRITICAL ? ["ops", "ceo"] : ["ops"],
    });
  }

  return out;
}
