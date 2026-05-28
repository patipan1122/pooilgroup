// GET /api/cron/sop-check
// Daily 18:00 (Asia/Bangkok). Checks every branch for daysSinceLastCollection > 1.
// Emits MISSED_COLLECTION alerts (one per branch · idempotent) and
// fires a per-branch LINE Notify to the "ops" channel.
//
// BIGFEATURE §2.10 — wrapped in runWithMonitor for cron_runs audit + Telegram
// alert on failure. Daily cron → default idempotency (one success per day) OK.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyChannel } from "@/lib/chairops/line/messaging";
import { ChairopsAlertKind, ChairopsAlertLevel, ChairopsAlertStatus } from "@/lib/generated/prisma/enums";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { DRIFT_DEFAULTS } from "@/lib/chairops/reconcile/drift-engine";
import { runWithMonitor } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

  try {
    return await runWithMonitor(
      "chairops-sop-check",
      async () => sopCheckHandler(),
      { req: request },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function sopCheckHandler(): Promise<NextResponse> {
  const drifts = await prisma.chairopsDrift.findMany({
    where: { daysSinceLastCollection: { gt: DRIFT_DEFAULTS.maxDaysSinceCollection } },
    include: { branch: true },
  });

  let emitted = 0;
  let notified = 0;
  const branches: { slug: string; days: number; emitted: boolean }[] = [];

  for (const d of drifts) {
    if (!d.branch.isActive) continue;
    // Idempotent: skip if there is already an OPEN/ACK MISSED_COLLECTION alert.
    const existing = await prisma.chairopsAlert.findFirst({
      where: {
        branchId: d.branchId,
        kind: ChairopsAlertKind.MISSED_COLLECTION,
        status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
      },
      select: { id: true },
    });

    let didEmit = false;
    if (!existing) {
      // W0: ChairopsAlert.orgId now required · the drift row carries orgId.
      const alert = await prisma.chairopsAlert.create({
        data: {
          orgId: d.orgId,
          branchId: d.branchId,
          kind: ChairopsAlertKind.MISSED_COLLECTION,
          level: d.daysSinceLastCollection > 3 ? ChairopsAlertLevel.CRITICAL : ChairopsAlertLevel.WARN,
          title: `แม่บ้านไม่ส่งยอด ${d.daysSinceLastCollection} วันที่ ${d.branch.name}`,
          message: `เก็บล่าสุด: ${
            d.lastCollectionAt ? d.lastCollectionAt.toISOString() : "ไม่เคย"
          }`,
          contextJson: { days: d.daysSinceLastCollection, source: "sop-check" },
        },
      });
      emitted++;
      didEmit = true;
      await notifyChannel(
        "ops",
        `⚠️ ${alert.title}\n${alert.message}`
      );
      notified++;
    }
    branches.push({ slug: d.branch.slug, days: d.daysSinceLastCollection, emitted: didEmit });
  }

  return NextResponse.json({
    ok: true,
    checked: drifts.length,
    emitted,
    notified,
    branches,
  });
}
