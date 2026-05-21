// GET /api/cron/sop-check
// Daily 18:00 (Asia/Bangkok). Checks every branch for daysSinceLastCollection > 1.
// Emits MISSED_COLLECTION alerts (one per branch · idempotent) and
// fires a per-branch LINE Notify to the "ops" channel.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendLineNotify } from "@/lib/chairops/line/notify";
import { ChairopsAlertKind, ChairopsAlertLevel, ChairopsAlertStatus } from "@/lib/generated/prisma/enums";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { DRIFT_DEFAULTS } from "@/lib/chairops/reconcile/drift-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

  try {
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
        const alert = await prisma.chairopsAlert.create({
          data: {
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
        await sendLineNotify(
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
