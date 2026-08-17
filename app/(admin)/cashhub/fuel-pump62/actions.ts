"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { cashhubFuelV1 } from "@/lib/cashhub/flags";
import { PUMP_KEY, toDbRow } from "@/lib/cashhub/fuel-import-core";
import { mapStoredMonthToDaily, type StoredMonth } from "@/lib/cashhub/fuel-daily-from-raw";
import type { FuelSheetHeader, FuelSheetRow } from "@/lib/cashhub/fuel-raw-parser";
import {
  FUEL_CHANNELS,
  type FuelChannelCode,
} from "@/lib/cashhub/fuel-channels";
import { loadFuelChannelConfig } from "@/lib/cashhub/fuel-settlement-data";
import {
  aggregateFuelDeposits,
  resolveFuelSourceColumns,
  computeFuelDeposits,
  sendFuelDaysToReconcile,
  readFuelReconcileStatus,
  type StoredHeader,
  type StoredRow,
} from "@/lib/cashhub/fuel-reconcile";
import { listBankAccounts } from "@/lib/cashhub/amazon-settlement-data";

export interface FuelSheetMonthData {
  periodKey: string;
  label: string;
  headers: FuelSheetHeader[];
  rows: FuelSheetRow[];
  ncol: number;
  daysPresent: number;
  expectedDays: number;
  missingDays: number[];
}

/** Lazily load one month's full grid (selected in the "ตารางเต็มเหมือนชีต" view). */
export async function getFuelSheetMonth(
  periodKey: string,
): Promise<FuelSheetMonthData | null> {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
  if (!cashhubFuelV1()) return null;
  if (!/^\d{4}-\d{2}$/.test(periodKey)) return null;

  const admin = adminClient();
  const { data } = await admin
    .from("cashhub_fuel_sheet_month")
    .select(
      "period_key, label, headers, rows, ncol, days_present, expected_days, missing_days",
    )
    .eq("org_id", session.user.org_id)
    .eq("pump_key", PUMP_KEY)
    .eq("period_key", periodKey)
    .maybeSingle();

  if (!data) return null;
  return {
    periodKey: data.period_key as string,
    label: data.label as string,
    headers: (data.headers ?? []) as FuelSheetHeader[],
    rows: (data.rows ?? []) as FuelSheetRow[],
    ncol: (data.ncol ?? 0) as number,
    daysPresent: (data.days_present ?? 0) as number,
    expectedDays: (data.expected_days ?? 0) as number,
    missingDays: (data.missing_days ?? []) as number[],
  };
}

export interface PromoteResult {
  ok: boolean;
  error?: string;
  imported?: { label: string; rows: number }[];
  totalRows?: number;
}

/**
 * Promote selected month(s) from the stored full-grid (correct on every layout) into the
 * กระทบยอด table (cashhub_fuel_daily). Lets the CEO pick exactly which month to pull —
 * no re-fetch, header-driven so old layouts read correctly. Idempotent (upsert).
 */
export async function promoteMonthsToReconcile(
  periodKeys: string[],
): Promise<PromoteResult> {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
  if (!cashhubFuelV1()) return { ok: false, error: "ปิดใช้งานอยู่" };
  const keys = periodKeys.filter((k) => /^\d{4}-\d{2}$/.test(k));
  if (keys.length === 0) return { ok: false, error: "ยังไม่ได้เลือกเดือน" };

  const admin = adminClient();
  const orgId = session.user.org_id;
  const { data, error } = await admin
    .from("cashhub_fuel_sheet_month")
    .select("period_key, year, month, sheet_tab, label, headers, rows, source_fetched_at")
    .eq("org_id", orgId)
    .eq("pump_key", PUMP_KEY)
    .in("period_key", keys);

  if (error) return { ok: false, error: `อ่านข้อมูลไม่สำเร็จ: ${error.message}` };
  if (!data || data.length === 0) return { ok: false, error: "ไม่พบเดือนที่เลือกในตารางเต็ม" };

  const nowIso = new Date().toISOString();
  const imported: { label: string; rows: number }[] = [];
  const payloads: Record<string, unknown>[] = [];

  for (const m of data) {
    const stored: StoredMonth = {
      period_key: m.period_key as string,
      year: m.year as number,
      month: m.month as number,
      sheet_tab: m.sheet_tab as string,
      headers: (m.headers ?? []) as StoredMonth["headers"],
      rows: (m.rows ?? []) as StoredMonth["rows"],
    };
    const classified = mapStoredMonthToDaily(stored);
    for (const c of classified) {
      payloads.push({
        ...toDbRow(c, {
          orgId,
          userId: session.user.id,
          fetchedAt: (m.source_fetched_at as string | null) ?? null,
          source: "ym62_sheet",
        }),
        updated_at: nowIso,
      });
    }
    imported.push({ label: (m.label as string) ?? (m.period_key as string), rows: classified.length });
  }

  // Dedupe by the conflict key (date|shift): a month-end spillover row (e.g. a "วันที่ 31"
  // in a 30-day month, clamped to day 30) can collide with the real day-30 same-shift row.
  // Postgres rejects two rows hitting the same ON CONFLICT target in one statement, so keep
  // the larger-sales row (the real full shift) and drop the small straggler.
  const byKey = new Map<string, Record<string, unknown>>();
  for (const p of payloads) {
    const k = `${String(p.report_date)}|${String(p.shift)}`;
    const ex = byKey.get(k);
    const pv = Math.abs(Number(p.total_sales) || 0);
    const ev = ex ? Math.abs(Number(ex.total_sales) || 0) : -1;
    if (!ex || pv > ev) byKey.set(k, p);
  }
  const deduped = [...byKey.values()];

  const { error: upErr } = await admin
    .from("cashhub_fuel_daily")
    .upsert(deduped, { onConflict: "org_id,pump_key,report_date,shift" });
  if (upErr) return { ok: false, error: `บันทึกไม่สำเร็จ: ${upErr.message}` };

  revalidatePath("/cashhub/fuel-pump62");
  return { ok: true, imported, totalRows: deduped.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// ส่งเข้ากระทบยอด (reconcile) — เงินเข้าจริงต่อวัน/ช่อง → ledger_revenue_entry
// CEO 2026-06-16. พรีวิวก่อนส่ง (โชว์คอลัมน์ต้นทาง + ยอด + บัญชีปลายทาง) แล้วค่อยกดส่ง.

export interface FuelPreviewChannel {
  code: FuelChannelCode;
  label: string;
  sourceHint: string;
  headerNames: string[]; // คอลัมน์จริงที่จับได้ในเดือนนี้ (โปร่งใส กันนับซ้ำ)
  resolved: boolean;
  accountLabel: string | null; // บัญชีปลายทาง (ธนาคาร ****เลข4)
  companyOk: boolean;
  willSend: boolean;
  warn: string | null; // เหตุผลที่จะไม่ส่ง
  total: number;
  daysWithAmount: number;
}
export interface FuelPreviewDay {
  date: string;
  cells: { code: FuelChannelCode; amount: number; state: "reconciled" | "pending" | "unsent" }[];
}
export interface FuelReconcilePreview {
  ok: boolean;
  error?: string;
  periodKey?: string;
  periodLabel?: string;
  channels?: FuelPreviewChannel[];
  days?: FuelPreviewDay[];
  grandTotal?: number;
}

/** พรีวิวยอดที่จะส่งจริง (read-only) — รันสูตรส่งเดียวกับตอนกดส่ง = ความจริง */
export async function previewFuelReconcile(periodKey: string): Promise<FuelReconcilePreview> {
  const session = await requireRole("super_admin");
  if (!cashhubFuelV1()) return { ok: false, error: "ปิดใช้งานอยู่" };
  if (!/^\d{4}-\d{2}$/.test(periodKey)) return { ok: false, error: "เดือนไม่ถูกต้อง" };
  const admin = adminClient();
  const orgId = session.user.org_id;

  const { data: m } = await admin
    .from("cashhub_fuel_sheet_month")
    .select("period_key, label, headers, rows")
    .eq("org_id", orgId)
    .eq("pump_key", PUMP_KEY)
    .eq("period_key", periodKey)
    .maybeSingle();
  if (!m) return { ok: false, error: "ยังไม่มีข้อมูลเดือนนี้ — นำเข้ายอด/ดึงเข้าตารางเต็มก่อน" };

  const headers = (m.headers ?? []) as StoredHeader[];
  const rows = (m.rows ?? []) as StoredRow[];
  const resolved = resolveFuelSourceColumns(headers);
  const deposits = aggregateFuelDeposits(headers, rows);

  const [configs, accounts] = await Promise.all([
    loadFuelChannelConfig(admin, orgId),
    listBankAccounts(admin, orgId),
  ]);
  const acctById = new Map(accounts.map((a) => [a.id, a.label] as const));
  const cfgByCode = new Map(configs.map((c) => [c.code, c] as const));

  const from = `${periodKey}-01`;
  const to = deposits.length ? deposits[deposits.length - 1]!.date : from;
  const statusMap = await readFuelReconcileStatus(orgId, from, to);

  const channels: FuelPreviewChannel[] = FUEL_CHANNELS.map((def) => {
    const cfg = cfgByCode.get(def.code);
    const r = resolved[def.code];
    const total = deposits.reduce((s, d) => s + (d[def.code] || 0), 0);
    const daysWithAmount = deposits.filter((d) => (d[def.code] || 0) > 0).length;
    const accountLabel = cfg?.bankAccountId ? acctById.get(cfg.bankAccountId) ?? null : null;
    const companyOk = Boolean(cfg?.companyId);
    const isSettle = cfg?.isSettle ?? def.isSettle;
    let warn: string | null = null;
    if (!isSettle) warn = "ปิดไม่ส่ง";
    else if (r.indices.length === 0) warn = "จับคอลัมน์ในชีตไม่เจอ";
    else if (!accountLabel) warn = "ยังไม่เลือกบัญชีปลายทาง";
    else if (!companyOk) warn = "ยังไม่เลือกบริษัท";
    const willSend = warn == null && total > 0;
    return {
      code: def.code,
      label: def.label,
      sourceHint: def.sourceHint,
      headerNames: r.headerNames,
      resolved: r.indices.length > 0,
      accountLabel,
      companyOk,
      willSend,
      warn,
      total,
      daysWithAmount,
    };
  });

  const days: FuelPreviewDay[] = deposits
    .map((d) => ({
      date: d.date,
      cells: FUEL_CHANNELS.map((def) => {
        const amt = d[def.code] || 0;
        const st = statusMap.get(`${d.date}:${def.code}`);
        const state: "reconciled" | "pending" | "unsent" = !st
          ? "unsent"
          : st.reconciled
            ? "reconciled"
            : "pending";
        return { code: def.code, amount: st ? st.amount : amt, state };
      }).filter((c) => c.amount > 0),
    }))
    .filter((d) => d.cells.length > 0);

  const grandTotal = channels.filter((c) => c.willSend).reduce((s, c) => s + c.total, 0);
  return {
    ok: true,
    periodKey,
    periodLabel: (m.label as string) ?? periodKey,
    channels,
    days,
    grandTotal,
  };
}

export interface FuelSendResult {
  ok: boolean;
  error?: string;
  inserted?: number;
  skipped?: number;
}

/** ส่งจริง → ledger_revenue_entry (super_admin · idempotent · transaction) */
export async function sendFuelReconcile(periodKeys: string[]): Promise<FuelSendResult> {
  const session = await requireRole("super_admin");
  if (!cashhubFuelV1()) return { ok: false, error: "ปิดใช้งานอยู่" };
  const keys = periodKeys.filter((k) => /^\d{4}-\d{2}$/.test(k));
  if (keys.length === 0) return { ok: false, error: "ยังไม่ได้เลือกเดือน" };
  const admin = adminClient();
  const orgId = session.user.org_id;

  const configs = await loadFuelChannelConfig(admin, orgId);
  if (!configs.some((c) => c.isSettle && c.companyId && c.bankAccountId))
    return { ok: false, error: "ยังไม่ได้ตั้งค่าช่องทาง→บัญชี/บริษัท (ไปที่ ⚙️ ตั้งค่าช่องทาง)" };

  const deposits = await computeFuelDeposits(admin, orgId, keys);
  if (deposits.length === 0) return { ok: false, error: "ไม่พบยอดในเดือนที่เลือก" };

  const res = await sendFuelDaysToReconcile(orgId, deposits, configs);
  if (res.error) return { ok: false, error: res.error };

  await audit({
    orgId,
    userId: session.user.id,
    action: "SEND_FUEL_RECONCILE",
    resourceType: "ledger_revenue_entry",
    diff: { new: { periodKeys: keys, inserted: res.inserted, skipped: res.skippedNoConfig } },
  });
  revalidatePath("/cashhub/fuel-pump62");
  return { ok: true, inserted: res.inserted, skipped: res.skippedNoConfig };
}
