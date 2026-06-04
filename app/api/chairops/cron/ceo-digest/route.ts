// GET /api/cron/ceo-digest
// Daily 08:00 (Asia/Bangkok) digest to LINE channel "ceo".
// Includes: POS today across branches, branches in shortage, maids that missed
// collection, open critical alerts, open damage tickets.
//
// BIGFEATURE §2.10 — wrapped in runWithMonitor for cron_runs audit + Telegram
// alert on failure. Daily cron → default idempotency (one success per day) OK.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyChannel } from "@/lib/chairops/line/messaging";
import { baht, thaiDate, TZ } from "@/lib/chairops/utils/format";
import { getBaseUrl } from "@/lib/utils/base-url";
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

  // BF2 · 24-hour alert digest by kind+level so CEO sees the "what broke
  // overnight" summary, not just point-in-time counts.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentAlerts = await prisma.chairopsAlert.groupBy({
    by: ["kind", "level"],
    where: { createdAt: { gte: since24h } },
    _count: { _all: true },
  });
  const recentByKind = new Map<string, { warn: number; critical: number; info: number }>();
  for (const r of recentAlerts) {
    const bucket = recentByKind.get(r.kind) ?? { warn: 0, critical: 0, info: 0 };
    if (r.level === ChairopsAlertLevel.CRITICAL) bucket.critical += r._count._all;
    else if (r.level === ChairopsAlertLevel.WARN) bucket.warn += r._count._all;
    else bucket.info += r._count._all;
    recentByKind.set(r.kind, bucket);
  }
  const recentTotal = Array.from(recentByKind.values()).reduce(
    (n, b) => n + b.warn + b.critical + b.info,
    0,
  );
  const KIND_LABELS_TH: Record<string, string> = {
    SHORTAGE: "เงินขาด",
    MISSED_COLLECTION: "ไม่ส่งยอด",
    POS_NOT_INGESTED: "POS ยังไม่นำเข้า",
    CHAIR_OFFLINE: "เก้าอี้ออฟไลน์",
    CLEANLINESS_FAIL: "ตรวจสภาพไม่ผ่าน",
    REPAIR_OVERDUE: "ซ่อมเกิน SLA",
    WRITE_OFF_REQUESTED: "ขอตัดเงินขาด",
  };

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

  if (recentTotal > 0) {
    lines.push("");
    lines.push(`📢 แจ้งเตือน 24 ชม. ที่ผ่านมา: ${recentTotal}`);
    for (const [kind, bucket] of recentByKind.entries()) {
      const total = bucket.warn + bucket.critical + bucket.info;
      const label = KIND_LABELS_TH[kind] ?? kind;
      const parts: string[] = [];
      if (bucket.critical) parts.push(`วิกฤต ${bucket.critical}`);
      if (bucket.warn) parts.push(`เตือน ${bucket.warn}`);
      if (bucket.info) parts.push(`แจ้ง ${bucket.info}`);
      lines.push(`  · ${label}: ${total} (${parts.join(" · ")})`);
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    if (appUrl) {
      lines.push(`ดูรายละเอียด: ${appUrl}/chairops/alerts`);
    }
  }

  const message = lines.join("\n");
  // น้องแมวน้ำ hero image atop the daily digest — only when a real https base
  // is resolvable (LINE can't fetch a localhost url in dev).
  const base = getBaseUrl();
  const sealImage = base.startsWith("https://")
    ? `${base}/mascot/banner/seal-onsen.jpg`
    : undefined;
  const send = await notifyChannel("ceo", message, sealImage);

  return NextResponse.json({
    ok: true,
    sent: send.ok,
    lineVia: send.via ?? null,
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
