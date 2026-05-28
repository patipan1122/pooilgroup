// GET /api/chairops/cron/eod-reminder
// 17:00 Asia/Bangkok (vercel.json "0 10 * * *" = 10:00 UTC). At the daily
// cut-off, flags branches that haven't BOTH (a) sent a cash collection and
// (b) submitted a cleanliness checklist today, and pushes a single summary to
// the ops LINE channel. Mirrors the per-maid "วันนี้มี X งาน" logic in
// app/(admin)/chairops/(maid)/m/page.tsx — branch-level here.
//
// AUDIT D-CO-M5 (SRE). Idempotent (default one success/day via runWithMonitor).
import { NextRequest, NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { runWithMonitor } from "@/lib/cron/runner";
import { notifyChannel } from "@/lib/chairops/line/messaging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TZ = "Asia/Bangkok";

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;
  try {
    return await runWithMonitor("chairops-eod-reminder", () => eodHandler(), {
      req: request,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function eodHandler(): Promise<NextResponse> {
  // Start of "today" in Bangkok, expressed as a UTC instant.
  const dateStr = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const dayStart = new Date(`${dateStr}T00:00:00+07:00`);

  const [branches, collected, cleaned] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.chairopsCashCollection.findMany({
      where: { collectedAt: { gte: dayStart } },
      select: { branchId: true },
      distinct: ["branchId"],
    }),
    prisma.chairopsCleanlinessReport.findMany({
      where: { reportedAt: { gte: dayStart } },
      select: { branchId: true },
      distinct: ["branchId"],
    }),
  ]);

  const collectedSet = new Set(collected.map((c) => c.branchId));
  const cleanedSet = new Set(cleaned.map((c) => c.branchId));

  const incomplete = branches
    .map((b) => {
      const missing: string[] = [];
      if (!collectedSet.has(b.id)) missing.push("ยังไม่ส่งยอด");
      if (!cleanedSet.has(b.id)) missing.push("ยังไม่เช็คคลีน");
      return { name: b.name, missing };
    })
    .filter((b) => b.missing.length > 0);

  let pushed = false;
  if (incomplete.length > 0) {
    const lines = incomplete
      .slice(0, 30)
      .map((b) => `• ${b.name}: ${b.missing.join(" · ")}`)
      .join("\n");
    const message =
      `⏰ สรุป cut-off 17:00 น. · ยังทำไม่ครบ ${incomplete.length}/${branches.length} สาขา\n` +
      lines;
    const res = await notifyChannel("ops", message);
    pushed = res.ok;
  }

  return NextResponse.json({
    ok: true,
    branches: branches.length,
    incomplete: incomplete.length,
    pushed,
  });
}
