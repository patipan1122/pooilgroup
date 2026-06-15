// CashHub ⛽ ปั๊มน้ำมัน — DB layer ของการตั้งค่าช่องทาง → บัญชี/บริษัท (เตรียม reconcile)
// mirror lib/cashhub/tea-data.ts (loadTeaChannelConfig / saveTeaChannelConfig)
import type { adminClient } from "@/lib/db/server";
import {
  FUEL_CHANNELS,
  defaultFuelChannelConfigs,
  type FuelChannelConfig,
} from "./fuel-channels";

type Admin = ReturnType<typeof adminClient>;

/** โหลด config — merge default + ที่บันทึกไว้ (ช่องใหม่โผล่อัตโนมัติ) */
export async function loadFuelChannelConfig(
  admin: Admin,
  orgId: string,
): Promise<FuelChannelConfig[]> {
  const { data } = await admin
    .from("cashhub_fuel_channel_config")
    .select("channel_code, label, is_settle, fee_percent, min_settle_satang, company_id, bank_account_id")
    .eq("org_id", orgId);
  const saved = new Map<string, Record<string, unknown>>();
  for (const r of (data ?? []) as Record<string, unknown>[])
    saved.set(String(r.channel_code), r);
  return defaultFuelChannelConfigs().map((d) => {
    const s = saved.get(d.code);
    if (!s) return d;
    return {
      code: d.code,
      label: (s.label as string) ?? d.label,
      isSettle: s.is_settle == null ? d.isSettle : Boolean(s.is_settle),
      feePercent: s.fee_percent != null ? Number(s.fee_percent) : d.feePercent,
      minSettleBaht:
        s.min_settle_satang != null ? Number(s.min_settle_satang) / 100 : d.minSettleBaht,
      companyId: (s.company_id as string | null) ?? null,
      bankAccountId: (s.bank_account_id as string | null) ?? null,
    };
  });
}

/** บันทึก config (super_admin) — upsert ต่อช่องทาง.
 *  ⚠️ validate company_id/bank_account_id ว่าเป็นขององค์กรนี้จริง (กันชี้ข้ามองค์กร) — service-role bypass RLS */
export async function saveFuelChannelConfig(
  admin: Admin,
  orgId: string,
  configs: FuelChannelConfig[],
): Promise<{ ok: boolean; error?: string }> {
  const valid = new Set(FUEL_CHANNELS.map((c) => c.code));
  const [co, bank] = await Promise.all([
    admin.from("companies").select("id").eq("org_id", orgId),
    admin.from("ledger_bank_account").select("id").eq("org_id", orgId),
  ]);
  const validCo = new Set((co.data ?? []).map((r) => String((r as { id: unknown }).id)));
  const validBank = new Set((bank.data ?? []).map((r) => String((r as { id: unknown }).id)));
  const now = new Date().toISOString();
  const rows = configs
    .filter((c) => valid.has(c.code))
    .map((c) => ({
      org_id: orgId,
      channel_code: c.code,
      label: c.label,
      is_settle: c.isSettle,
      fee_percent: c.feePercent,
      min_settle_satang: Math.round((c.minSettleBaht ?? 0) * 100),
      // ช่องที่ไม่ใช่เงินเข้าธนาคาร → ล้างบัญชี/บริษัท · ค่าแปลกปลอม (ข้าม org) → null
      company_id: c.isSettle && c.companyId && validCo.has(c.companyId) ? c.companyId : null,
      bank_account_id: c.isSettle && c.bankAccountId && validBank.has(c.bankAccountId) ? c.bankAccountId : null,
      active: c.isSettle,
      updated_at: now,
    }));
  if (rows.length === 0) return { ok: true };
  const { error } = await admin
    .from("cashhub_fuel_channel_config")
    .upsert(rows, { onConflict: "org_id,channel_code" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
