// POST /api/cashhub/fuel-import/preview  (multipart)
// Dry-run companion to /api/cashhub/fuel-import — parses the gas-station workbook
// (pull the public link OR an uploaded .xlsx) and returns a diff vs existing
// cashhub_fuel_daily rows WITHOUT writing. Powers the "ตรวจก่อนนำเข้า" step.

import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { cashhubFuelV1 } from "@/lib/cashhub/flags";
import {
  loadWorkbook,
  parseAndClassify,
  PUMP_KEY,
  importKey,
  type ImportMode,
} from "@/lib/cashhub/fuel-import-core";

export const dynamic = "force-dynamic";

const EPS = 0.01;
const isClose = (a: number, b: number) => Math.abs(a - b) < EPS;

export async function POST(req: NextRequest) {
  if (!cashhubFuelV1()) {
    return NextResponse.json({ error: "ปิดใช้งานอยู่" }, { status: 404 });
  }
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  const orgId = session.user.org_id;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }
  const mode = (form.get("mode") as ImportMode) || "pull";
  const latest = Number(form.get("latest") ?? 2);
  const file = form.get("file");

  const loaded = await loadWorkbook(
    mode,
    file instanceof File ? file : null,
  );
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.reason }, { status: 422 });
  }

  let outcome;
  try {
    outcome = parseAndClassify(loaded.buf, mode === "pull" ? latest : 0);
  } catch (e) {
    return NextResponse.json(
      { error: `แกะไฟล์ไม่สำเร็จ: ${(e as Error).message}` },
      { status: 422 },
    );
  }
  if (outcome.errors.length > 0 || outcome.rows.length === 0) {
    return NextResponse.json(
      { error: outcome.errors[0] ?? "ไม่พบข้อมูลในไฟล์", warnings: outcome.warnings },
      { status: 422 },
    );
  }

  // existing rows for this pump in the parsed date range
  const dates = outcome.rows.map((r) => r.reportDate).sort();
  const minDate = dates[0]!;
  const maxDate = dates[dates.length - 1]!;
  const admin = adminClient();
  const { data: existing } = await admin
    .from("cashhub_fuel_daily")
    .select("report_date, shift, total_sales")
    .eq("org_id", orgId)
    .eq("pump_key", PUMP_KEY)
    .gte("report_date", minDate)
    .lte("report_date", maxDate);

  const existingByKey = new Map<string, number>();
  for (const r of (existing ?? []) as Array<{
    report_date: string;
    shift: string;
    total_sales: string | number | null;
  }>) {
    existingByKey.set(importKey(r.report_date, r.shift), Number(r.total_sales ?? 0));
  }

  let newCount = 0;
  let sameCount = 0;
  const changed: Array<{
    date: string;
    shift: string;
    old: number;
    new: number;
  }> = [];

  for (const c of outcome.classified) {
    const key = importKey(c.row.reportDate, c.row.shift);
    const prev = existingByKey.get(key);
    const next = c.row.totalSales ?? 0;
    if (prev === undefined) newCount++;
    else if (isClose(prev, next)) sameCount++;
    else changed.push({ date: c.row.reportDate, shift: c.row.shift, old: prev, new: next });
  }

  // recon status tally (so preview can warn "พบ N แถวที่ต้องตรวจ")
  const statusTally: Record<string, number> = {};
  for (const c of outcome.classified) {
    statusTally[c.recon.reconStatus] = (statusTally[c.recon.reconStatus] ?? 0) + 1;
  }
  const flaggedCount = outcome.classified.filter(
    (c) =>
      c.recon.reconStatus === "shortage" ||
      c.recon.reconStatus === "mismatch" ||
      c.recon.reconStatus === "overage" ||
      c.recon.anomalyCodes.length > 0,
  ).length;

  return NextResponse.json({
    ok: true,
    mode,
    summary: {
      total: outcome.rows.length,
      new: newCount,
      same: sameCount,
      changed: changed.length,
    },
    months: outcome.months.map((m) => ({
      tab: m.sheetTab,
      label: m.monthLabel,
      days: m.dayCount,
      rows: m.rowCount,
      parsedTotal: m.parsedTotalSales,
      sheetTotal: m.sheetSummaryTotalSales,
      summaryMatches: m.summaryMatches,
    })),
    statusTally,
    flaggedCount,
    changedSample: changed.slice(0, 20),
    tabsParsed: outcome.tabsParsed,
    warnings: outcome.warnings.slice(0, 20),
  });
}
