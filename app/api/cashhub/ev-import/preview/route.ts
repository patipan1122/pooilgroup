// POST /api/cashhub/ev-import/preview
// Dry-run companion to /api/cashhub/ev-import — returns diff vs existing
// DailyReport rows WITHOUT writing anything. Required for the
// "ตรวจก่อนนำเข้า" UX so CEO can see new/same/changed counts before commit.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";

const AggSchema = z.object({
  stationName: z.string().min(1).max(200),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessions: z.number().int().min(0).max(100000),
  totalKwh: z.number().min(0).max(10_000_000),
  totalRevenue: z.number().min(0).max(1_000_000_000),
});

const Schema = z.object({
  aggregates: z.array(AggSchema).min(1).max(5000),
});

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

const EPSILON = 0.01; // 1 satang — Decimal precision tolerance

function isClose(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }
  const { aggregates } = parsed.data;
  const orgId = session.user.org_id;
  const admin = adminClient();

  // 1. Map station name → existing EV branch (if any)
  const { data: existingBranches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", orgId)
    .eq("is_active", true);

  const branchByNormName = new Map<string, { id: string; code: string }>();
  for (const b of (existingBranches ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    business_type: string;
  }>) {
    if (b.business_type === "ev_station") {
      branchByNormName.set(normalizeName(b.name), { id: b.id, code: b.code });
    }
  }

  const stationsInPayload = Array.from(
    new Set(aggregates.map((a) => a.stationName)),
  );
  const missingStations = stationsInPayload.filter(
    (s) => !branchByNormName.has(normalizeName(s)),
  );

  // 2. For rows that DO have a matching branch, look up existing DailyReport
  const matchedBranchIds = new Set<string>();
  const dateBounds = aggregates.reduce(
    (acc, a) => {
      if (!acc.min || a.reportDate < acc.min) acc.min = a.reportDate;
      if (!acc.max || a.reportDate > acc.max) acc.max = a.reportDate;
      return acc;
    },
    { min: null as string | null, max: null as string | null },
  );

  for (const a of aggregates) {
    const branch = branchByNormName.get(normalizeName(a.stationName));
    if (branch) matchedBranchIds.add(branch.id);
  }

  // Bulk-load existing reports for matched branches in the date range.
  // If everything is missing, skip the query.
  let existingByKey = new Map<
    string,
    { totalSales: number; qty1: number | null; qty2: number | null }
  >();

  if (matchedBranchIds.size > 0 && dateBounds.min && dateBounds.max) {
    const { data: existingReports } = await admin
      .from("daily_reports")
      .select("branch_id, report_date, shift, total_sales, qty1, qty2")
      .eq("org_id", orgId)
      .eq("shift", "all")
      .in("branch_id", Array.from(matchedBranchIds))
      .gte("report_date", dateBounds.min)
      .lte("report_date", dateBounds.max);

    for (const r of (existingReports ?? []) as Array<{
      branch_id: string;
      report_date: string;
      total_sales: string | number;
      qty1: string | number | null;
      qty2: string | number | null;
    }>) {
      existingByKey.set(`${r.branch_id}__${r.report_date}`, {
        totalSales: Number(r.total_sales ?? 0),
        qty1: r.qty1 == null ? null : Number(r.qty1),
        qty2: r.qty2 == null ? null : Number(r.qty2),
      });
    }
  }

  // 3. Classify each aggregate
  type ChangedRow = {
    stationName: string;
    reportDate: string;
    old: { totalSales: number; sessions: number | null; kwh: number | null };
    new: { totalSales: number; sessions: number; kwh: number };
  };

  let newCount = 0;
  let sameCount = 0;
  const changed: ChangedRow[] = [];
  let skippedNoBranchCount = 0;

  for (const agg of aggregates) {
    const branch = branchByNormName.get(normalizeName(agg.stationName));
    if (!branch) {
      skippedNoBranchCount++;
      continue;
    }
    const key = `${branch.id}__${agg.reportDate}`;
    const existing = existingByKey.get(key);
    if (!existing) {
      newCount++;
      continue;
    }
    if (
      isClose(existing.totalSales, agg.totalRevenue) &&
      isClose(existing.qty1 ?? 0, agg.sessions) &&
      isClose(existing.qty2 ?? 0, agg.totalKwh)
    ) {
      sameCount++;
      continue;
    }
    changed.push({
      stationName: agg.stationName,
      reportDate: agg.reportDate,
      old: {
        totalSales: existing.totalSales,
        sessions: existing.qty1,
        kwh: existing.qty2,
      },
      new: {
        totalSales: agg.totalRevenue,
        sessions: agg.sessions,
        kwh: agg.totalKwh,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    summary: {
      total: aggregates.length,
      new: newCount,
      same: sameCount,
      changed: changed.length,
      skippedNoBranch: skippedNoBranchCount,
    },
    missingStations,
    changedSample: changed.slice(0, 20), // first 20 for UI display
    changedTotal: changed.length,
  });
}
