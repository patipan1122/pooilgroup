// Cron — recompute Branch Health Score for every branch in every org
// Runs nightly at 23:00 (Bangkok). Vercel Cron will hit this endpoint.
// Protected by CRON_SECRET (matches Authorization: Bearer <secret>).

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { computeHealth } from "@/lib/cashhub/health-score";
import {
  startOfMonth,
  endOfMonth,
  subDays,
  getDate,
  getDaysInMonth,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

import { runWithMonitor } from "@/lib/cron/runner";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runWithMonitor("health-score", () => run(), { req });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

async function run() {
  const admin = adminClient();
  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const window30 = formatInTimeZone(subDays(now, 29), TZ, "yyyy-MM-dd");
  const prevWindow30Start = formatInTimeZone(subDays(now, 59), TZ, "yyyy-MM-dd");
  const prevWindow30End = formatInTimeZone(subDays(now, 30), TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const monthEnd = formatInTimeZone(endOfMonth(now), TZ, "yyyy-MM-dd");
  const daysInMonth = getDaysInMonth(now);
  const daysIntoMonth = getDate(now);
  const monthYear = parseInt(formatInTimeZone(now, TZ, "yyyy"), 10);
  const monthNum = parseInt(formatInTimeZone(now, TZ, "M"), 10);

  const { data: branches } = await admin
    .from("branches")
    .select("id, org_id")
    .eq("is_active", true);
  if (!branches) return NextResponse.json({ ok: true, computed: 0 });

  // BUG-024: batch parallelism — process 10 branches at a time to avoid Vercel 60s timeout
  const BATCH_SIZE = 10;
  let computed = 0;

  async function processBranch(b: { id: string; org_id: string }) {
    const [last30Q, prev30Q, monthQ, targetQ] = await Promise.all([
      admin
        .from("daily_reports")
        .select("report_date, status, total_sales, submitted_at, approved_at, cash, transfer, card, credit, shortage")
        .eq("branch_id", b.id)
        .gte("report_date", window30)
        .lte("report_date", today),
      admin
        .from("daily_reports")
        .select("total_sales, status")
        .eq("branch_id", b.id)
        .gte("report_date", prevWindow30Start)
        .lte("report_date", prevWindow30End),
      admin
        .from("daily_reports")
        .select("total_sales, status")
        .eq("branch_id", b.id)
        .gte("report_date", monthStart)
        .lte("report_date", monthEnd),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin.from as any)("branch_targets")
        .select("amount")
        .eq("branch_id", b.id)
        .eq("year", monthYear)
        .eq("month", monthNum)
        .maybeSingle(),
    ]);

    const last30 = last30Q.data ?? [];
    const prev30 = prev30Q.data ?? [];
    const month = monthQ.data ?? [];
    const target = targetQ.data
      ? Number((targetQ.data as { amount: number | string }).amount)
      : 0;

    const expectedDays = 30;
    const dates = new Set(last30.map((r) => r.report_date));
    const reportedDays = dates.size;
    // crude on-time = ?: assume report exists implies on-time for cron baseline
    const onTimeDays = reportedDays;
    // balanced when total_sales == sum of received
    const balancedDays = last30.filter((r) => {
      const recv =
        Number(r.cash || 0) +
        Number(r.transfer || 0) +
        Number(r.card || 0) +
        Number(r.credit || 0) +
        Number(r.shortage || 0);
      return Math.abs(Number(r.total_sales || 0) - recv) < 0.01;
    }).length;
    const totalSales = last30
      .filter((r) => r.status !== "rejected")
      .reduce((s, r) => s + Number(r.total_sales || 0), 0);
    const prevTotalSales = prev30
      .filter((r) => r.status !== "rejected")
      .reduce((s, r) => s + Number(r.total_sales || 0), 0);
    const actualThisMonth = month
      .filter((r) => r.status === "approved")
      .reduce((s, r) => s + Number(r.total_sales || 0), 0);

    // Detect 3 consecutive declining days
    const sortedByDate = [...last30].sort((a, b2) =>
      a.report_date.localeCompare(b2.report_date),
    );
    let consec = 0;
    for (let i = sortedByDate.length - 1; i > 0; i--) {
      const today = Number(sortedByDate[i]!.total_sales || 0);
      const prev = Number(sortedByDate[i - 1]!.total_sales || 0);
      if (today < prev) consec += 1;
      else break;
    }

    const result = computeHealth({
      expectedDays,
      reportedDays,
      onTimeDays,
      balancedDays,
      diffOnePctDays: 0,
      diffFivePctDays: 0,
      totalSales,
      prevTotalSales,
      targetThisMonth: target,
      actualThisMonth,
      daysIntoMonth,
      daysInMonth,
      consecutiveDeclineDays: consec,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from as any)("branch_health_scores").upsert(
      {
        id: crypto.randomUUID(),
        org_id: b.org_id,
        branch_id: b.id,
        computed_for: today,
        score: result.score,
        grade: result.grade,
        breakdown: { items: result.breakdown },
      },
      { onConflict: "branch_id,computed_for" },
    );
    computed += 1;
  }

  // Run batches of BATCH_SIZE in parallel
  for (let i = 0; i < branches.length; i += BATCH_SIZE) {
    const chunk = branches.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(processBranch));
  }

  return NextResponse.json({ ok: true, computed });
}
