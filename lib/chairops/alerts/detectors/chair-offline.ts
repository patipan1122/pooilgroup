// D2 · CHAIR_OFFLINE detector (inferred from PosDaily activity).
//
// We don't have a real liveness ping from the POS vendor (StarThing XLSX
// exports daily summary only). So "offline" = no ChairopsPosDaily row with
// any meaningful activity for this chair for the past N days.
//
// Skip rules:
//   • Skip if branch has open POS_NOT_INGESTED (upstream broken — don't
//     double-alert; the watchdog already says "no data anywhere").
//   • Skip newly installed chairs (< 48h since installedAt).
//   • Skip retired chairs.
//
// Escalation:
//   WARN  · 3 days no activity for this chair.
//   CRIT  · 7 days no activity for this chair.
//   CRIT (branch-level)  · ≥30% of branch chairs offline AT ONCE — aggregate
//     into ONE branch row instead of N chair rows to avoid storm.

import { prisma } from "@/lib/prisma";
import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  findOpenAlert,
  isFirstRun,
  PER_DETECTOR_EMIT_CAP,
  type NewAlert,
} from "@/lib/chairops/alerts/_shared";

const WARN_DAYS = 3;
const CRITICAL_DAYS = 7;
const BRANCH_AGGREGATE_FRACTION = 0.3;
const NEW_INSTALL_GRACE_MS = 48 * 60 * 60 * 1000;

export async function detectChairOffline(orgId?: string): Promise<NewAlert[]> {
  const chairs = await prisma.chairopsChair.findMany({
    where: {
      isActive: true,
      retiredAt: null,
      ...(orgId ? { orgId } : {}),
    },
    select: {
      id: true,
      orgId: true,
      chairCode: true,
      branchId: true,
      installedAt: true,
      branch: { select: { id: true, name: true, orgId: true } },
    },
  });
  if (chairs.length === 0) return [];

  // Cache: branches with open POS_NOT_INGESTED (skip set).
  const posBlocked = new Set<string>();
  const posBlockedRows = await prisma.chairopsAlert.findMany({
    where: {
      kind: ChairopsAlertKind.POS_NOT_INGESTED,
      status: { in: ["OPEN", "ACK"] },
      ...(orgId ? { orgId } : {}),
    },
    select: { branchId: true },
  });
  for (const r of posBlockedRows) {
    if (r.branchId) posBlocked.add(r.branchId);
  }

  const out: NewAlert[] = [];
  const now = Date.now();
  const warnFrontier = new Date(now - WARN_DAYS * 86_400_000);
  const criticalFrontier = new Date(now - CRITICAL_DAYS * 86_400_000);

  // Group chairs by branch for the aggregate rule.
  const chairsByBranch = new Map<string, typeof chairs>();
  for (const c of chairs) {
    const arr = chairsByBranch.get(c.branchId);
    if (arr) arr.push(c);
    else chairsByBranch.set(c.branchId, [c]);
  }

  for (const [branchId, branchChairs] of chairsByBranch.entries()) {
    if (out.length >= PER_DETECTOR_EMIT_CAP) break;
    if (posBlocked.has(branchId)) continue;

    const branchOrgId = branchChairs[0]?.branch?.orgId ?? branchChairs[0]?.orgId;
    if (!branchOrgId) continue;
    const branchName = branchChairs[0]?.branch?.name ?? "(ไม่ทราบสาขา)";

    // Per-chair: latest PosDaily row with any activity. One query per branch.
    const codes = branchChairs.map((c) => c.chairCode);
    const latestPerChair = await prisma.chairopsPosDaily.groupBy({
      by: ["chairCode"],
      where: {
        orgId: branchOrgId,
        branchId,
        chairCode: { in: codes },
        OR: [
          { coinInsertCount: { gt: 0 } },
          { totalCash: { gt: 0 } },
          { onlineTotal: { gt: 0 } },
        ],
      },
      _max: { bizDate: true },
    });
    const latestMap = new Map<string, Date | null>();
    for (const row of latestPerChair) {
      if (row.chairCode) latestMap.set(row.chairCode, row._max.bizDate ?? null);
    }

    // First pass — collect every offline chair for the branch.
    const offline: { chairCode: string; lastActivityAt: Date | null; daysOffline: number }[] = [];
    for (const chair of branchChairs) {
      // Skip newly installed.
      if (chair.installedAt && now - chair.installedAt.getTime() < NEW_INSTALL_GRACE_MS) {
        continue;
      }
      const last = latestMap.get(chair.chairCode);
      if (last && last >= warnFrontier) continue;
      const daysOffline = last
        ? Math.floor((now - last.getTime()) / 86_400_000)
        : 999;
      offline.push({ chairCode: chair.chairCode, lastActivityAt: last ?? null, daysOffline });
    }
    if (offline.length === 0) continue;

    // First-run summary — if this org has NEVER seen CHAIR_OFFLINE, emit one
    // summary INFO instead of per-chair WARNs.
    if (await isFirstRun(branchOrgId, ChairopsAlertKind.CHAIR_OFFLINE)) {
      const summaryExisting = await findOpenAlert({
        orgId: branchOrgId,
        kind: ChairopsAlertKind.CHAIR_OFFLINE,
        branchId: null,
      });
      if (!summaryExisting) {
        out.push({
          orgId: branchOrgId,
          branchId: null,
          kind: ChairopsAlertKind.CHAIR_OFFLINE,
          level: ChairopsAlertLevel.INFO,
          title: `เก้าอี้เงียบหลายตัว · ตามแก้ย้อนหลัง`,
          message: `${offline.length} เก้าอี้ไม่ส่งข้อมูล ${WARN_DAYS}+ วัน · ตรวจสอบเครื่อง`,
          contextJson: {
            historical: true,
            chairsAffected: offline.length,
            sampleBranch: branchName,
            linkPath: "/chairops/branches",
            source: "ingest-watchdog-first-run",
          },
          channels: ["repair"],
        });
      }
      continue;
    }

    // Branch-aggregate CRIT: ≥30% of chairs in this branch offline.
    const branchOfflineFraction = offline.length / branchChairs.length;
    if (branchOfflineFraction >= BRANCH_AGGREGATE_FRACTION && branchChairs.length >= 4) {
      const existing = await findOpenAlert({
        orgId: branchOrgId,
        kind: ChairopsAlertKind.CHAIR_OFFLINE,
        branchId,
        entityKey: "chairCode",
        entityValue: "__branch_aggregate__",
      });
      if (!existing) {
        out.push({
          orgId: branchOrgId,
          branchId,
          kind: ChairopsAlertKind.CHAIR_OFFLINE,
          level: ChairopsAlertLevel.CRITICAL,
          title: `เก้าอี้ออฟไลน์เป็นกลุ่ม · ${branchName} (${offline.length}/${branchChairs.length})`,
          message: `เก้าอี้ ${(branchOfflineFraction * 100).toFixed(0)}% ของสาขาเงียบ · ตรวจสอบไฟ/เครื่อง/เครือข่าย`,
          contextJson: {
            chairCode: "__branch_aggregate__",
            chairsAffected: offline.length,
            chairsTotal: branchChairs.length,
            offlineCodes: offline.slice(0, 10).map((o) => o.chairCode),
            linkPath: `/chairops/dashboard`,
            source: "ingest-watchdog",
          },
          channels: ["repair", "branch"],
        });
      }
      continue; // skip per-chair emits when aggregate fires
    }

    // Per-chair emits (only when branch is NOT in aggregate mode).
    for (const o of offline) {
      if (out.length >= PER_DETECTOR_EMIT_CAP) break;
      const existing = await findOpenAlert({
        orgId: branchOrgId,
        kind: ChairopsAlertKind.CHAIR_OFFLINE,
        branchId,
        entityKey: "chairCode",
        entityValue: o.chairCode,
      });
      if (existing) continue;
      const level = o.daysOffline >= CRITICAL_DAYS
        ? ChairopsAlertLevel.CRITICAL
        : ChairopsAlertLevel.WARN;
      out.push({
        orgId: branchOrgId,
        branchId,
        kind: ChairopsAlertKind.CHAIR_OFFLINE,
        level,
        title: `เก้าอี้ออฟไลน์ · ${o.chairCode} (${branchName})`,
        message: o.lastActivityAt
          ? `ใช้งานล่าสุด ${o.lastActivityAt.toISOString().slice(0, 10)} · เงียบ ${o.daysOffline} วัน`
          : `ไม่เคยมีข้อมูลกิจกรรม · ตรวจสอบเครื่อง`,
        contextJson: {
          chairCode: o.chairCode,
          daysOffline: o.daysOffline,
          lastActivityAt: o.lastActivityAt ? o.lastActivityAt.toISOString() : null,
          linkPath: `/chairops/dashboard`,
          source: "ingest-watchdog",
        },
        channels: level === ChairopsAlertLevel.CRITICAL ? ["repair", "branch"] : ["repair"],
      });
    }
  }

  return out;
}
