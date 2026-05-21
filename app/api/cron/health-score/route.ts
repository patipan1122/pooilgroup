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
  if (!branches || branches.length === 0) {
    return NextResponse.json({ ok: true, computed: 0 });
  }

  const branchIds = branches.map((b) => b.id);

  // Bulk fetch — 4 queries total regardless of branch count. Replaces the
  // previous 4×N round-trips (e.g. 30 branches = 120 hits → 4 hits).
  const [last30Q, prev30Q, monthQ, targetQ] = await Promise.all([
    admin
      .from("daily_reports")
      .select(
        "branch_id, report_date, status, total_sales, submitted_at, approved_at, cash, transfer, card, credit, shortage",
      )
      .in("branch_id", branchIds)
      .gte("report_date", window30)
      .lte("report_date", today),
    admin
      .from("daily_reports")
      .select("branch_id, total_sales, status")
      .in("branch_id", branchIds)
      .gte("report_date", prevWindow30Start)
      .lte("report_date", prevWindow30End),
    admin
      .from("daily_reports")
      .select("branch_id, total_sales, status")
      .in("branch_id", branchIds)
      .gte("report_date", monthStart)
      .lte("report_date", monthEnd),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("branch_targets")
      .select("branch_id, amount")
      .in("branch_id", branchIds)
      .eq("year", monthYear)
      .eq("month", monthNum),
  ]);

  // Bucket rows by branch_id for O(1) per-branch access during compute.
  type Last30Row = NonNullable<typeof last30Q.data>[number];
  type StatusSalesRow = { branch_id: string; total_sales: number | string | null; status: string | null };
  type TargetRow = { branch_id: string; amount: number | string };

  const last30ByBranch = new Map<string, Last30Row[]>();
  for (const r of last30Q.data ?? []) {
    const arr = last30ByBranch.get(r.branch_id) ?? [];
    arr.push(r);
    last30ByBranch.set(r.branch_id, arr);
  }
  const prev30ByBranch = new Map<string, StatusSalesRow[]>();
  for (const r of (prev30Q.data ?? []) as StatusSalesRow[]) {
    const arr = prev30ByBranch.get(r.branch_id) ?? [];
    arr.push(r);
    prev30ByBranch.set(r.branch_id, arr);
  }
  const monthByBranch = new Map<string, StatusSalesRow[]>();
  for (const r of (monthQ.data ?? []) as StatusSalesRow[]) {
    const arr = monthByBranch.get(r.branch_id) ?? [];
    arr.push(r);
    monthByBranch.set(r.branch_id, arr);
  }
  const targetByBranch = new Map<string, number>();
  for (const r of (targetQ.data ?? []) as TargetRow[]) {
    targetByBranch.set(r.branch_id, Number(r.amount));
  }

  // Compute health-score rows in pure JS (no I/O).
  const upsertRows = branches.map((b) => {
    const last30 = last30ByBranch.get(b.id) ?? [];
    const prev30 = prev30ByBranch.get(b.id) ?? [];
    const month = monthByBranch.get(b.id) ?? [];
    const target = targetByBranch.get(b.id) ?? 0;

    const expectedDays = 30;
    const dates = new Set(last30.map((r) => r.report_date));
    const reportedDays = dates.size;
    const onTimeDays = reportedDays;
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

    const sortedByDate = [...last30].sort((a, b2) =>
      a.report_date.localeCompare(b2.report_date),
    );
    let consec = 0;
    for (let i = sortedByDate.length - 1; i > 0; i--) {
      const todayVal = Number(sortedByDate[i]!.total_sales || 0);
      const prev = Number(sortedByDate[i - 1]!.total_sales || 0);
      if (todayVal < prev) consec += 1;
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

    return {
      id: crypto.randomUUID(),
      org_id: b.org_id,
      branch_id: b.id,
      computed_for: today,
      score: result.score,
      grade: result.grade,
      breakdown: { items: result.breakdown },
    };
  });

  // Single bulk upsert.
  if (upsertRows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from as any)("branch_health_scores").upsert(upsertRows, {
      onConflict: "branch_id,computed_for",
    });
  }

  return NextResponse.json({ ok: true, computed: upsertRows.length });
}
