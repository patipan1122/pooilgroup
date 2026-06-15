// POST /api/cashhub/fuel-import  (multipart)
// Commit the gas-station workbook into cashhub_fuel_daily. Parses SERVER-SIDE (pull the
// public link OR an uploaded .xlsx), re-derives recon_status, and upserts idempotently
// on (org_id, pump_key, report_date, shift). Re-pull is the NORMAL workflow — the sheet
// is the source of truth (no in-app editing in v1), so an existing row is UPDATED.
//
// v1 does NOT write a daily_reports summary: the pump isn't linked to a POOIL branch yet
// (daily_reports.branch_id is NOT NULL). When the CEO links a branch we flip that on with
// no re-import (see SPEC §6 / open question #1).

import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { cashhubFuelV1 } from "@/lib/cashhub/flags";
import {
  loadWorkbook,
  parseAndClassify,
  toDbRow,
  PUMP_KEY,
  importKey,
  type ImportMode,
} from "@/lib/cashhub/fuel-import-core";
import { parseFuelSheetMonths } from "@/lib/cashhub/fuel-raw-parser";

export const dynamic = "force-dynamic";

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

  const loaded = await loadWorkbook(mode, file instanceof File ? file : null);
  if (!loaded.ok) {
    await audit({
      orgId,
      userId: session.user.id,
      action: "BULK_IMPORT_FUEL_REPORTS",
      resourceType: "cashhub_fuel_daily",
      diff: { new: { status: "failed", reason: loaded.reason } },
    });
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
      { error: outcome.errors[0] ?? "ไม่พบข้อมูลในไฟล์" },
      { status: 422 },
    );
  }

  // Guard ONLY against a WILD parsed/sheet ratio (a column-shift would make our sum
  // an order of magnitude off). A small discrepancy is a real sheet data-quality issue
  // (the bookkeeper's own end-of-month total ≠ sum of days) that we IMPORT + flag, not
  // block — refusing it would throw away faithful daily data.
  const wild = outcome.months.find((m) => {
    if (m.sheetSummaryTotalSales == null || m.sheetSummaryTotalSales <= 0) return false;
    const ratio = m.parsedTotalSales / m.sheetSummaryTotalSales;
    return ratio < 0.5 || ratio > 2;
  });
  if (wild) {
    return NextResponse.json(
      {
        error: `ผลรวมที่อ่านได้ผิดปกติมากเทียบยอดท้ายชีต (แท็บ ${wild.sheetTab}) — โครงสร้างชีตอาจเปลี่ยน หยุดนำเข้าเพื่อความปลอดภัย`,
      },
      { status: 422 },
    );
  }

  const admin = adminClient();
  const nowIso = new Date().toISOString();

  // pre-query existing keys → report created vs updated
  const dates = outcome.rows.map((r) => r.reportDate).sort();
  const { data: existing } = await admin
    .from("cashhub_fuel_daily")
    .select("report_date, shift")
    .eq("org_id", orgId)
    .eq("pump_key", PUMP_KEY)
    .gte("report_date", dates[0]!)
    .lte("report_date", dates[dates.length - 1]!);
  const existingKeys = new Set(
    (existing ?? []).map((r: { report_date: string; shift: string }) =>
      importKey(r.report_date, r.shift),
    ),
  );

  const payloads = outcome.classified.map((c) => ({
    ...toDbRow(c, {
      orgId,
      userId: session.user.id,
      fetchedAt: loaded.fetchedAt,
      source: loaded.source,
    }),
    updated_at: nowIso,
  }));

  const { error: upsertErr } = await admin
    .from("cashhub_fuel_daily")
    .upsert(payloads, { onConflict: "org_id,pump_key,report_date,shift" });

  if (upsertErr) {
    return NextResponse.json(
      { error: `บันทึกไม่สำเร็จ: ${upsertErr.message}` },
      { status: 500 },
    );
  }

  // FULL-grid mirror for the "ตารางเต็มเหมือนชีต" view: parse EVERY month (all columns,
  // header-driven) from the same buffer and upsert one row per month. Additive — a
  // failure here must NOT fail the reconcile import that already succeeded above.
  let sheetMonths = 0;
  try {
    const months = parseFuelSheetMonths(loaded.buf);
    if (months.length > 0) {
      const monthPayloads = months.map((m) => ({
        org_id: orgId,
        pump_key: PUMP_KEY,
        year: m.year,
        month: m.month,
        period_key: m.periodKey,
        label: m.label,
        sheet_tab: m.sheetTab,
        headers: m.headers,
        rows: m.rows,
        ncol: m.ncol,
        days_present: m.daysPresent,
        expected_days: m.expectedDays,
        missing_days: m.missingDays,
        source: loaded.source,
        source_fetched_at: loaded.fetchedAt,
        imported_by_id: session.user.id,
        imported_at: nowIso,
        updated_at: nowIso,
      }));
      const { error: monthErr } = await admin
        .from("cashhub_fuel_sheet_month")
        .upsert(monthPayloads, { onConflict: "org_id,pump_key,year,month" });
      if (!monthErr) sheetMonths = monthPayloads.length;
    }
  } catch {
    // swallow — the reconcile data is already saved; full-grid is best-effort.
  }

  let created = 0;
  let updated = 0;
  for (const c of outcome.classified) {
    if (existingKeys.has(importKey(c.row.reportDate, c.row.shift))) updated++;
    else created++;
  }
  const flagged = outcome.classified.filter(
    (c) =>
      c.recon.reconStatus === "shortage" ||
      c.recon.reconStatus === "mismatch" ||
      c.recon.reconStatus === "overage" ||
      c.recon.anomalyCodes.length > 0,
  ).length;

  await audit({
    orgId,
    userId: session.user.id,
    action: "BULK_IMPORT_FUEL_REPORTS",
    resourceType: "cashhub_fuel_daily",
    diff: {
      new: {
        mode,
        tabsParsed: outcome.tabsParsed.length,
        rowsIn: outcome.rows.length,
        created,
        updated,
        flagged,
        sheetMonths,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    sheetMonths,
    created,
    updated,
    flagged,
    total: outcome.rows.length,
    months: outcome.months.map((m) => ({
      label: m.monthLabel,
      days: m.dayCount,
      parsedTotal: m.parsedTotalSales,
      sheetTotal: m.sheetSummaryTotalSales,
      summaryMatches: m.summaryMatches,
    })),
  });
}
