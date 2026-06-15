"use server";

import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { cashhubFuelV1 } from "@/lib/cashhub/flags";
import { PUMP_KEY } from "@/lib/cashhub/fuel-import-core";
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
