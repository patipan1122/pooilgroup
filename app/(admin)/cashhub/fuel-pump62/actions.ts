"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { cashhubFuelV1 } from "@/lib/cashhub/flags";
import { PUMP_KEY, toDbRow } from "@/lib/cashhub/fuel-import-core";
import { mapStoredMonthToDaily, type StoredMonth } from "@/lib/cashhub/fuel-daily-from-raw";
import type { FuelSheetHeader, FuelSheetRow } from "@/lib/cashhub/fuel-raw-parser";

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
  const session = await requireRole("super_admin", "org_admin", "admin");
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
  const session = await requireRole("super_admin", "org_admin", "admin");
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

  const { error: upErr } = await admin
    .from("cashhub_fuel_daily")
    .upsert(payloads, { onConflict: "org_id,pump_key,report_date,shift" });
  if (upErr) return { ok: false, error: `บันทึกไม่สำเร็จ: ${upErr.message}` };

  revalidatePath("/cashhub/fuel-pump62");
  return { ok: true, imported, totalRows: payloads.length };
}
