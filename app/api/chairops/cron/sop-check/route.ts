// GET /api/cron/sop-check
// Daily 18:00 (Asia/Bangkok). Checks every branch for daysSinceLastCollection > 1.
// Emits MISSED_COLLECTION alerts (one per branch · idempotent) and
// fires a per-branch LINE Notify to the "ops" channel.
//
// BIGFEATURE §2.10 — wrapped in runWithMonitor for cron_runs audit + Telegram
// alert on failure. Daily cron → default idempotency (one success per day) OK.
//
// BF1 fix (2026-06-02) · skip branches where the assigned maid is on a
// recorded ChairopsMaidDayOff today. Without this, every leave day fires a
// false "missed maid" alert (CEO at 7am sees ~5 false alarms/day, starts
// ignoring real shortages — direct violation of [[chairops-no-cumulative-
// shortage]]).
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

function bkkTodayDate(): Date {
  const tz = process.env.APP_TIMEZONE || "Asia/Bangkok";
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${ymd}T00:00:00Z`);
}

async function sopCheckHandler(): Promise<NextResponse> {
  const drifts = await prisma.chairopsDrift.findMany({
    where: { daysSinceLastCollection: { gt: DRIFT_DEFAULTS.maxDaysSinceCollection } },
    include: { branch: true },
  });

  if (drifts.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: 0,
      emitted: 0,
      notified: 0,
      skippedLeave: 0,
      branches: [],
    });
  }

  // BF1 — pre-compute (orgId, branchId) pairs whose primary maid is on
  // recorded leave today. One indexed query — at 200-maid scale this is <5ms.
  const today = bkkTodayDate();
  const branchIds = drifts.map((d) => d.branchId);
  const maidsAtBranches = await prisma.chairopsUser.findMany({
    where: {
      role: "MAID",
      isActive: true,
      primaryBranchId: { in: branchIds },
    },
    select: { id: true, primaryBranchId: true, displayName: true, orgId: true },
  });
  const maidIds = maidsAtBranches.map((m) => m.id);
  const leaves = maidIds.length
    ? await prisma.chairopsMaidDayOff.findMany({
        where: {
          maidId: { in: maidIds },
          date: today,
        },
        select: { maidId: true, reason: true },
      })
    : [];
  const leaveByMaidId = new Map(leaves.map((l) => [l.maidId, l.reason]));
  const leaveBranchIdSet = new Set<string>();
  for (const m of maidsAtBranches) {
    if (m.primaryBranchId && leaveByMaidId.has(m.id)) {
      leaveBranchIdSet.add(m.primaryBranchId);
    }
  }

  let emitted = 0;
  let notified = 0;
  let skippedLeave = 0;
  const branches: { slug: string; days: number; emitted: boolean; skippedReason?: string }[] = [];

  for (const d of drifts) {
    if (!d.branch.isActive) continue;

    if (leaveBranchIdSet.has(d.branchId)) {
      skippedLeave++;
      branches.push({
        slug: d.branch.slug,
        days: d.daysSinceLastCollection,
        emitted: false,
        skippedReason: "leave",
      });
      // Best-effort audit log so CEO can trace why a branch was silent.
      try {
        await prisma.chairopsAuditLog.create({
          data: {
            orgId: d.orgId,
            userId: null,
            action: "sop_check.skipped_due_to_leave",
            entity: "Branch",
            entityId: d.branchId,
            metadata: {
              branchSlug: d.branch.slug,
              days: d.daysSinceLastCollection,
              date: today.toISOString().slice(0, 10),
            },
          },
        });
      } catch {
        // swallow — skip behavior remains in effect
      }
      continue;
    }

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
    skippedLeave,
    branches,
  });
}
