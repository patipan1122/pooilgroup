// GET /api/cron/ceo-digest
// Daily 08:00 (Asia/Bangkok) digest to LINE channel "ceo".
// Includes: POS today across branches, branches in shortage, maids that missed
// collection, open critical alerts, open damage tickets.
//
// BIGFEATURE §2.10 — wrapped in runWithMonitor for cron_runs audit + Telegram
// alert on failure. Daily cron → default idempotency (one success per day) OK.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendLineNotify } from "@/lib/chairops/line/notify";
import { baht, thaiDate, TZ } from "@/lib/chairops/utils/format";
import { ChairopsAlertKind, ChairopsAlertLevel, ChairopsAlertStatus, ChairopsTicketStatus } from "@/lib/generated/prisma/enums";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { runWithMonitor } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

  try {
    return await runWithMonitor(
      "chairops-ceo-digest",
      async () => ceoDigestHandler(),
      { req: request },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function ceoDigestHandler(): Promise<NextResponse> {
  // Today in Bangkok — start of day and tomorrow-start
  const { start, end, label } = bangkokTodayWindow();

  // 1) POS today across all branches
  // W0: totalRevenue → grossTotal (BA-2 rename · now Decimal(12,2)).
  // FLAGGED · this aggregate spans ALL orgs (no orgId filter) · acceptable
  // for now because pooilgroup is the only chairops tenant. When multi-tenant
  // comes online either (a) loop per-org or (b) bind cron to a specific
  // orgId via env var. See [[ceo-does-not-own-buildlygo-app]].
  const posAgg = await prisma.chairopsPosDaily.aggregate({
    where: { bizDate: { gte: start, lt: end } },
    _sum: { grossTotal: true },
    _count: true,
  });
  const posTotal = posAgg._sum?.grossTotal ? Number(posAgg._sum.grossTotal) : 0;

  // 2) Branches with shortage today (positive drift)
  const drifts = await prisma.chairopsDrift.findMany({
    where: { driftAmount: { gt: 0 } },
    include: { branch: { select: { name: true, slug: true } } },
    orderBy: { driftAmount: "desc" },
    take: 10,
  });
  const shortageBranches = drifts.length;

  // 3) Maids who missed collection (daysSinceLastCollection > 1)
  const missed = await prisma.chairopsDrift.findMany({
    where: { daysSinceLastCollection: { gt: 1 } },
    include: { branch: { select: { name: true } } },
    orderBy: { daysSinceLastCollection: "desc" },
    take: 10,
  });

  // 4) Open CRITICAL alerts
  const criticalOpen = await prisma.chairopsAlert.count({
    where: {
      level: ChairopsAlertLevel.CRITICAL,
      status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
    },
  });
  const shortageAlertsOpen = await prisma.chairopsAlert.count({
    where: {
      kind: ChairopsAlertKind.SHORTAGE,
      status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
    },
  });

  // 5) Open damage tickets
  const openDamage = await prisma.chairopsDamageTicket.count({
    where: {
      status: {
        in: [
          ChairopsTicketStatus.OPEN,
          ChairopsTicketStatus.ASSIGNED,
          ChairopsTicketStatus.IN_PROGRESS,
          ChairopsTicketStatus.WAITING_PARTS,
        ],
      },
    },
  });
  const urgentDamage = await prisma.chairopsDamageTicket.count({
    where: {
      priority: "URGENT",
      status: {
        in: [
          ChairopsTicketStatus.OPEN,
          ChairopsTicketStatus.ASSIGNED,
          ChairopsTicketStatus.IN_PROGRESS,
          ChairopsTicketStatus.WAITING_PARTS,
        ],
      },
    },
  });

  const lines: string[] = [];
  lines.push(`📊 สรุปประจำวัน · ${label}`);
  lines.push("");
  lines.push(`💰 POS วันนี้: ${baht(posTotal)} (${posAgg._count} รายการ)`);
  lines.push(`🔴 สาขาเงินขาด: ${shortageBranches} สาขา`);
  if (drifts.length) {
    const top = drifts.slice(0, 3).map((d) => `  · ${d.branch.name}: ${baht(d.driftAmount)}`);
    lines.push(...top);
  }
  lines.push(`👩 แม่บ้านขาดส่ง: ${missed.length} สาขา`);
  if (missed.length) {
    const top = missed
      .slice(0, 3)
      .map((m) => `  · ${m.branch.name}: ${m.daysSinceLastCollection} วัน`);
    lines.push(...top);
  }
  lines.push(`⚠️ แจ้งเตือนวิกฤต (open): ${criticalOpen}`);
  lines.push(`💸 SHORTAGE ค้าง: ${shortageAlertsOpen}`);
  lines.push(`🔧 ใบซ่อมค้าง: ${openDamage} (ด่วน ${urgentDamage})`);

  const message = lines.join("\n");
  const send = await sendLineNotify("ceo", message);

  return NextResponse.json({
    ok: true,
    sent: send.ok,
    lineStatus: send.status ?? null,
    lineError: send.error ?? null,
    digest: {
      posTotal,
      shortageBranches,
      missedBranches: missed.length,
      criticalOpen,
      shortageAlertsOpen,
      openDamage,
      urgentDamage,
    },
  });
}

// Compute [start, end) for "today" in the configured app timezone, returned as UTC Date.
function bangkokTodayWindow() {
  // We don't import a TZ library here — use Intl to get the local Y-M-D, then
  // convert to a UTC Date by treating that local midnight as Asia/Bangkok (+07:00).
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = fmt.format(now); // "YYYY-MM-DD"
  // Bangkok has no DST and is fixed at +07:00.
  const start = new Date(`${ymd}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end, label: thaiDate(start, "EEE d MMM yy") };
}
