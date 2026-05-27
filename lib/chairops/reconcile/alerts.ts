// Alert emission triggered by drift engine
// W0: every alert create now needs orgId · we resolve once per branch via
// the branch row (cached for the loop). See [[chairops-audit-2026-05-25]].
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { ChairopsAlertKind, ChairopsAlertLevel, ChairopsAlertStatus } from "@/lib/generated/prisma/enums";
import { recomputeAllDrifts, DRIFT_DEFAULTS, getOrgIdForBranch } from "./drift-engine";
import { sendLineNotify } from "@/lib/chairops/line/notify";
import { baht } from "@/lib/chairops/utils/format";

type AlertClient = Pick<Prisma.TransactionClient, "chairopsAlert"> | typeof prisma;

export async function evaluateAndEmitAlerts() {
  const snapshots = await recomputeAllDrifts();
  const emitted: { branchId: string; kind: ChairopsAlertKind }[] = [];
  const orgCache = new Map<string, string>();

  async function orgIdFor(branchId: string): Promise<string> {
    const cached = orgCache.get(branchId);
    if (cached) return cached;
    const orgId = await getOrgIdForBranch(branchId);
    orgCache.set(branchId, orgId);
    return orgId;
  }

  for (const s of snapshots) {
    // SHORTAGE
    if (s.status === "shortage") {
      const existing = await prisma.chairopsAlert.findFirst({
        where: {
          branchId: s.branchId,
          kind: ChairopsAlertKind.SHORTAGE,
          status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
        },
      });
      if (!existing) {
        const orgId = await orgIdFor(s.branchId);
        const alert = await prisma.chairopsAlert.create({
          data: {
            orgId,
            branchId: s.branchId,
            kind: ChairopsAlertKind.SHORTAGE,
            level: s.driftAmount > 5000 ? ChairopsAlertLevel.CRITICAL : ChairopsAlertLevel.WARN,
            title: `เงินขาด ${baht(s.driftAmount)} ที่ ${s.branchName}`,
            message: `POS รวม ${baht(s.posTotal)} · ฝากรวม ${baht(s.depositTotal)} · ค้าง ${s.driftHours} ชม.`,
            contextJson: {
              drift: s.driftAmount,
              age_hours: s.driftHours,
              threshold: DRIFT_DEFAULTS.shortageThresholdBaht,
            },
          },
        });
        emitted.push({ branchId: s.branchId, kind: alert.kind });
        await sendLineNotify("finance", `🔴 ${alert.title}\n${alert.message}`);
        await sendLineNotify("ceo", `🔴 ${alert.title}\n${alert.message}`);
      }
    }

    // MISSED COLLECTION
    if (s.status === "missed") {
      const existing = await prisma.chairopsAlert.findFirst({
        where: {
          branchId: s.branchId,
          kind: ChairopsAlertKind.MISSED_COLLECTION,
          status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
        },
      });
      if (!existing) {
        const orgId = await orgIdFor(s.branchId);
        const alert = await prisma.chairopsAlert.create({
          data: {
            orgId,
            branchId: s.branchId,
            kind: ChairopsAlertKind.MISSED_COLLECTION,
            level: s.daysSinceLastCollection > 3 ? ChairopsAlertLevel.CRITICAL : ChairopsAlertLevel.WARN,
            title: `แม่บ้านไม่ส่งยอด ${s.daysSinceLastCollection} วันที่ ${s.branchName}`,
            message: `เก็บล่าสุด: ${s.lastCollectionAt ? s.lastCollectionAt.toISOString() : "ไม่เคย"}`,
            contextJson: { days: s.daysSinceLastCollection },
          },
        });
        emitted.push({ branchId: s.branchId, kind: alert.kind });
        await sendLineNotify("ops", `⚠️ ${alert.title}\n${alert.message}`);
      }
    }
  }

  return { snapshots, emitted };
}

export async function ackAlert(alertId: string, userId: string, client: AlertClient = prisma) {
  return client.chairopsAlert.update({
    where: { id: alertId },
    data: { status: ChairopsAlertStatus.ACK, ackedById: userId, ackedAt: new Date() },
  });
}

export async function resolveAlert(alertId: string, userId: string, client: AlertClient = prisma) {
  return client.chairopsAlert.update({
    where: { id: alertId },
    data: { status: ChairopsAlertStatus.RESOLVED, ackedById: userId, resolvedAt: new Date() },
  });
}
