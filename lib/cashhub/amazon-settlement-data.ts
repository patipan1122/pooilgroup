// CashHub Café Amazon — DB layer ของการตั้งค่าชำระเงิน + bridge ส่งเงินเข้าจริง → reconcile (revenue entry)
import type { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_CHANNELS,
  computeDaySettlement,
  type ChannelConfig,
} from "./amazon-settlement";
import type { SavedAmazonDay } from "./amazon-data";

type Admin = ReturnType<typeof adminClient>;

// cvar → channel_code มาตรฐานของ bank-recon (cash/transfer/card/qr/wallet)
const CVAR_CHANNEL_CODE: Record<string, string> = {
  c1: "cash",
  c2: "qr",
  c13: "qr",
  c12: "card",
  c20: "transfer",
  c21: "transfer",
  c22: "transfer",
  c14: "wallet",
  c15: "wallet",
};

/** โหลด config ช่องทาง (merge กับ default — ช่องใหม่โผล่อัตโนมัติ) */
export async function loadChannelConfig(
  admin: Admin,
  orgId: string,
): Promise<ChannelConfig[]> {
  const { data } = await admin
    .from("cashhub_amazon_channel_config")
    .select("channel_cvar, label, is_settle, fee_percent, min_settle_satang, company_id, bank_account_id")
    .eq("org_id", orgId);
  const saved = new Map<string, Record<string, unknown>>();
  for (const r of (data ?? []) as Record<string, unknown>[])
    saved.set(String(r.channel_cvar), r);
  return DEFAULT_CHANNELS.map((d) => {
    const s = saved.get(d.cvar);
    if (!s) return d;
    return {
      cvar: d.cvar,
      label: (s.label as string) ?? d.label,
      isSettle: s.is_settle == null ? d.isSettle : Boolean(s.is_settle),
      feePercent: s.fee_percent != null ? Number(s.fee_percent) : d.feePercent,
      minSettleBaht: s.min_settle_satang != null ? Number(s.min_settle_satang) / 100 : d.minSettleBaht,
      companyId: (s.company_id as string | null) ?? null,
      bankAccountId: (s.bank_account_id as string | null) ?? null,
    };
  });
}

/** บันทึก config (super_admin) — upsert ต่อช่องทาง */
export async function saveChannelConfig(
  admin: Admin,
  orgId: string,
  configs: ChannelConfig[],
): Promise<{ ok: boolean; error?: string }> {
  const rows = configs.map((c) => ({
    org_id: orgId,
    channel_cvar: c.cvar,
    label: c.label,
    is_settle: c.isSettle,
    fee_percent: c.feePercent,
    min_settle_satang: Math.round(c.minSettleBaht * 100),
    company_id: c.companyId,
    bank_account_id: c.bankAccountId,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await admin
    .from("cashhub_amazon_channel_config")
    .upsert(rows, { onConflict: "org_id,channel_cvar" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export type BankAccountOpt = { id: string; name: string; bankCode: string; last4: string };

/** บัญชีธนาคารทั้งหมด (สำหรับ dropdown เลือกบัญชีที่เงินเข้า) */
export async function listBankAccounts(
  admin: Admin,
  orgId: string,
): Promise<BankAccountOpt[]> {
  const { data } = await admin
    .from("ledger_bank_account")
    .select("id, account_name, bank_code, account_no, is_active")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("account_name");
  return ((data ?? []) as Record<string, unknown>[]).map((a) => {
    const no = String(a.account_no ?? "");
    return {
      id: String(a.id),
      name: String(a.account_name ?? ""),
      bankCode: String(a.bank_code ?? ""),
      last4: no.slice(-4),
    };
  });
}

export type CompanyOpt = { id: string; name: string };

/** บริษัทในองค์กร (สำหรับเลือกบริษัทที่เงินเข้า reconcile) */
export async function listCompanies(admin: Admin, orgId: string): Promise<CompanyOpt[]> {
  const { data } = await admin
    .from("companies")
    .select("id, name")
    .eq("org_id", orgId)
    .order("name");
  return ((data ?? []) as Record<string, unknown>[]).map((c) => ({
    id: String(c.id),
    name: String(c.name ?? ""),
  }));
}

type ReconcileRow = {
  companyId: string;
  entryDate: string;
  amountSatang: number;
  sourceRef: string;
  description: string;
  customerName: string;
  paymentChannel: string;
  channelCode: string;
  bankAccountId: string | null;
};

/** ส่งเงินเข้าจริงของวัน (ต่อช่องทางที่ settled) → ledger_revenue_entry (ไปโผล่หน้า reconcile) */
export async function sendDaysToReconcile(
  orgId: string,
  storeCode: string,
  branchLabel: string,
  days: SavedAmazonDay[],
  configs: ChannelConfig[],
): Promise<{ inserted: number; skippedNoConfig: number; error?: string }> {
  const configByCvar = new Map(configs.map((c) => [c.cvar, c]));
  const rows: ReconcileRow[] = [];
  let skippedNoConfig = 0;
  for (const day of days) {
    if (!day.balanced) continue;
    const { perChannel } = computeDaySettlement(day.channels, configByCvar);
    for (const s of perChannel) {
      if (!s.settled) continue; // ข้ามช่องที่ไม่เข้าธนาคาร/รอสะสม
      if (!s.companyId) {
        skippedNoConfig++; // ยังไม่ตั้งบริษัท → ข้าม (ต้องตั้งก่อน)
        continue;
      }
      rows.push({
        companyId: s.companyId,
        entryDate: day.sales_date,
        amountSatang: Math.round(s.net * 100),
        sourceRef: `amz-${storeCode}-${day.sales_date}-${s.cvar}`,
        description: `Amazon ${branchLabel} · ${s.label} · ${day.sales_date}`,
        customerName: `Café Amazon ${branchLabel}`,
        paymentChannel: s.label,
        channelCode: CVAR_CHANNEL_CODE[s.cvar] ?? "other",
        bankAccountId: s.bankAccountId,
      });
    }
  }
  if (rows.length === 0) return { inserted: 0, skippedNoConfig };

  // INSERT ... ON CONFLICT DO NOTHING (atomic + idempotent + race-safe) — mirror trcloud-revenue.ts
  // conflict target ตรงกับ partial unique index (org,company,source_type,source_ref WHERE source_ref NOT NULL)
  let inserted = 0;
  try {
    for (const r of rows) {
      const res = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO ledger_revenue_entry
          (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
           description, customer_name, payment_channel, channel_code, match_state,
           expected_bank_account_id)
        VALUES (
          ${orgId}::uuid, ${r.companyId}::uuid, ${r.entryDate}::date, ${r.amountSatang},
          'CASHHUB_AMAZON', ${r.sourceRef}, ${r.description}, ${r.customerName},
          ${r.paymentChannel}, ${r.channelCode}, 'unmatched',
          ${r.bankAccountId}::uuid
        )
        ON CONFLICT (org_id, company_id, source_type, source_ref)
          WHERE source_ref IS NOT NULL
        DO NOTHING
        RETURNING id`;
      if (res.length) inserted++;
    }
  } catch (e) {
    return {
      inserted,
      skippedNoConfig,
      error: e instanceof Error ? e.message : "insert error",
    };
  }
  return { inserted, skippedNoConfig };
}
