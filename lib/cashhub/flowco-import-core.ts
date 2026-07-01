// FlowCo import core — turns aggregated fuel sales into daily_reports rows.
// Shared by the preview (dry-run diff) and commit (upsert) routes so both see the
// exact same classification.
//
// Safety notes:
//  • unmapped ste_id (สาขาที่ยังไม่จับคู่ / 3001 / 9999) are NEVER written — they are
//    reported back so the CEO can map them first. no-silent-drop.
//  • idempotent: upsert onConflict (branch_id, report_date, shift) → re-importing the
//    same day overwrites, never double-counts. For CHANGED rows we reuse the existing
//    row id so the PK (and anything referencing it) stays stable.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchFlowcoAggregates,
  type FlowcoDayAgg,
} from "./flowco-source";
import { resolveSteToBranch } from "./flowco-branch-map";

type Admin = SupabaseClient;

const SHIFT = "all";
const EPS = 0.01;
const r2 = (n: number) => Math.round(n * 100) / 100;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** ตรวจ+จัดเรียงช่วงวันที่ (YYYY-MM-DD). คืน null ถ้ารูปแบบผิด. */
export function normalizeDateRange(
  from: unknown,
  to: unknown,
): { dateFrom: string; dateTo: string } | null {
  const f = String(from ?? "");
  const t = String(to ?? "");
  if (!YMD.test(f) || !YMD.test(t)) return null;
  return f <= t ? { dateFrom: f, dateTo: t } : { dateFrom: t, dateTo: f };
}

export interface FlowcoPlanRow {
  steId: number;
  branchId: string;
  branchName: string;
  reportDate: string;
  totalSales: number;
  liters: number;
  cash: number;
  card: number;
  credit: number;
  transfer: number;
  payOther: number;
  payTotal: number;
  reconDiff: number; // payTotal - totalSales (≈0 ปกติ)
  status: "new" | "same" | "changed";
  oldTotal: number | null;
  /** payload พร้อม upsert เข้า daily_reports (มีเฉพาะ new/changed) */
  payload: Record<string, unknown> | null;
}

export interface FlowcoPlan {
  rows: FlowcoPlanRow[];
  unmapped: { steId: number; days: number; totalSales: number }[];
  summary: {
    total: number; // แถวที่จับคู่ได้ทั้งหมด
    new: number;
    same: number;
    changed: number;
    unmappedDays: number;
    branches: number;
    baht: number;
    mappedStations: number; // จำนวนสาขาที่จับคู่ไว้แล้วทั้งหมด (ไม่ขึ้นกับช่วงวัน)
  };
  reconFlags: number; // จำนวนแถวที่ payTotal ต่างจาก totalSales เกิน ฿5
  dateFrom: string;
  dateTo: string;
}

interface ExistingRow {
  id: string;
  total_sales: number | string | null;
  qty1: number | string | null;
  cash: number | string | null;
  card: number | string | null;
  credit: number | string | null;
  transfer: number | string | null;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

function buildPayload(
  agg: FlowcoDayAgg,
  branchId: string,
  orgId: string,
  userId: string,
  id: string,
  now: string,
): Record<string, unknown> {
  return {
    id,
    org_id: orgId,
    branch_id: branchId,
    report_date: agg.reportDate,
    shift: SHIFT,
    total_sales: r2(agg.totalSales),
    qty1: r2(agg.liters),
    qty1_unit: "ลิตร",
    qty2: null,
    qty2_unit: null,
    cash: r2(agg.cash),
    transfer: r2(agg.transfer),
    card: r2(agg.card),
    credit: r2(agg.credit),
    shortage: 0,
    notes: `[FlowCo ${agg.reportDate}]`,
    extra_fields: {
      source: "flowco",
      ste_id: agg.steId,
      liters: r2(agg.liters),
      test_liters: r2(agg.testLiters),
      grade_count: agg.gradeCount,
      pay_other: r2(agg.payOther),
      pay_total: r2(agg.payTotal),
    },
    status: "submitted",
    submitted_by_id: userId,
    submitted_at: now,
    // updated_at = NOT NULL ไม่มี default (Prisma @updatedAt) → ต้องใส่เอง (created_at มี default CURRENT_TIMESTAMP)
    updated_at: now,
  };
}

/** สร้างแผนนำเข้า (ใช้ทั้ง preview และ commit) */
export async function computeFlowcoPlan(
  admin: Admin,
  orgId: string,
  userId: string,
  dateFrom: string,
  dateTo: string,
): Promise<FlowcoPlan> {
  const now = new Date().toISOString();
  const [aggs, steToBranch] = await Promise.all([
    fetchFlowcoAggregates(admin, dateFrom, dateTo),
    resolveSteToBranch(admin, orgId),
  ]);

  // split mapped vs unmapped
  const mapped: FlowcoDayAgg[] = [];
  const unmappedMap = new Map<number, { steId: number; days: number; totalSales: number }>();
  for (const a of aggs) {
    if (steToBranch.has(a.steId)) mapped.push(a);
    else {
      const u = unmappedMap.get(a.steId) ?? {
        steId: a.steId,
        days: 0,
        totalSales: 0,
      };
      u.days += 1;
      u.totalSales += a.totalSales;
      unmappedMap.set(a.steId, u);
    }
  }

  // load existing daily_reports for the mapped branches within date range (one query)
  const branchIds = [...new Set(mapped.map((a) => steToBranch.get(a.steId)!.id))];
  const existing = new Map<string, ExistingRow>();
  if (branchIds.length > 0) {
    const dates = mapped.map((a) => a.reportDate);
    const minDate = dates.reduce((m, d) => (d < m ? d : m), dates[0]);
    const maxDate = dates.reduce((m, d) => (d > m ? d : m), dates[0]);
    const PAGE = 1000;
    let offset = 0;
    for (;;) {
      const { data, error } = await admin
        .from("daily_reports")
        .select("id,branch_id,report_date,shift,total_sales,qty1,cash,card,credit,transfer")
        .in("branch_id", branchIds)
        .eq("shift", SHIFT)
        .gte("report_date", minDate)
        .lte("report_date", maxDate)
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`อ่าน daily_reports ไม่สำเร็จ: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data as (ExistingRow & { branch_id: string; report_date: string })[]) {
        existing.set(`${row.branch_id}__${row.report_date}`, row);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  const rows: FlowcoPlanRow[] = [];
  let reconFlags = 0;
  for (const a of mapped) {
    const branch = steToBranch.get(a.steId)!;
    const prev = existing.get(`${branch.id}__${a.reportDate}`);
    const reconDiff = r2(a.payTotal - a.totalSales);
    if (Math.abs(reconDiff) > 5) reconFlags += 1;

    let status: FlowcoPlanRow["status"];
    let id: string;
    if (!prev) {
      status = "new";
      id = crypto.randomUUID();
    } else {
      id = prev.id;
      const same =
        Math.abs(num(prev.total_sales) - r2(a.totalSales)) < EPS &&
        Math.abs(num(prev.qty1) - r2(a.liters)) < EPS &&
        Math.abs(num(prev.cash) - r2(a.cash)) < EPS &&
        Math.abs(num(prev.card) - r2(a.card)) < EPS &&
        Math.abs(num(prev.credit) - r2(a.credit)) < EPS &&
        Math.abs(num(prev.transfer) - r2(a.transfer)) < EPS;
      status = same ? "same" : "changed";
    }

    rows.push({
      steId: a.steId,
      branchId: branch.id,
      branchName: branch.name,
      reportDate: a.reportDate,
      totalSales: r2(a.totalSales),
      liters: r2(a.liters),
      cash: r2(a.cash),
      card: r2(a.card),
      credit: r2(a.credit),
      transfer: r2(a.transfer),
      payOther: r2(a.payOther),
      payTotal: r2(a.payTotal),
      reconDiff,
      status,
      oldTotal: prev ? num(prev.total_sales) : null,
      payload:
        status === "same"
          ? null
          : buildPayload(a, branch.id, orgId, userId, id, now),
    });
  }

  const unmapped = [...unmappedMap.values()].sort((a, b) => a.steId - b.steId);
  return {
    rows,
    unmapped,
    summary: {
      total: rows.length,
      new: rows.filter((r) => r.status === "new").length,
      same: rows.filter((r) => r.status === "same").length,
      changed: rows.filter((r) => r.status === "changed").length,
      unmappedDays: unmapped.reduce((s, u) => s + u.days, 0),
      branches: branchIds.length,
      baht: r2(rows.reduce((s, r) => s + r.totalSales, 0)),
      mappedStations: steToBranch.size,
    },
    reconFlags,
    dateFrom,
    dateTo,
  };
}

/** เขียนแผน (เฉพาะ new + changed) ลง daily_reports แบบ upsert กันซ้ำ */
export async function commitFlowcoPlan(
  admin: Admin,
  plan: FlowcoPlan,
): Promise<{ created: number; updated: number }> {
  const toWrite = plan.rows.filter((r) => r.payload);
  if (toWrite.length === 0) return { created: 0, updated: 0 };

  // upsert in batches (guard against very large windows)
  const BATCH = 500;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const chunk = toWrite.slice(i, i + BATCH).map((r) => r.payload!);
    const { error } = await admin
      .from("daily_reports")
      .upsert(chunk, { onConflict: "branch_id,report_date,shift" });
    if (error) throw new Error(`บันทึก daily_reports ไม่สำเร็จ: ${error.message}`);
  }
  return {
    created: toWrite.filter((r) => r.status === "new").length,
    updated: toWrite.filter((r) => r.status === "changed").length,
  };
}
