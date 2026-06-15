// CashHub Café Amazon — DB layer ของการตั้งค่าชำระเงิน + bridge ส่งเงินเข้าจริง → reconcile (revenue entry)
import type { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_CHANNELS,
  computeSendRows,
  SETTLEMENT_GROUPS,
  type ChannelConfig,
} from "./amazon-settlement";
import type { SavedAmazonDay } from "./amazon-data";
import { BANK_LABELS } from "@/lib/ledger/bank-adapters/types";

type Admin = ReturnType<typeof adminClient>;

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

export type BankAccountOpt = { id: string; name: string; bankCode: string; last4: string; label: string };

// ป้าย dropdown: "ธนาคาร ****เลข4ตัวท้าย · ชื่อบัญชี" — ระบุบัญชีจากธนาคาร+เลขชัดเจน (ไม่ต้องเดาจากชื่อที่ตั้งเอง)
export function bankAccountLabel(bankCode: string, last4: string, name: string): string {
  const bank = BANK_LABELS[bankCode] ?? bankCode ?? "บัญชี";
  const num = last4 ? ` ****${last4}` : "";
  const nm = name ? ` · ${name}` : "";
  return `${bank}${num}${nm}`;
}

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
    const name = String(a.account_name ?? "");
    const bankCode = String(a.bank_code ?? "");
    const last4 = no.slice(-4);
    return {
      id: String(a.id),
      name,
      bankCode,
      last4,
      label: bankAccountLabel(bankCode, last4, name),
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
  // source_ref เก่าแบบ "แยก QR/QR Manual/wallet" (ก่อนรวมก้อนเดียว) → เก็บไว้ลบกันนับซ้ำ
  const legacyRefs: string[] = [];
  let skippedNoConfig = 0;
  for (const day of days) {
    if (!day.balanced) continue;
    // รวมช่องที่โอนเข้าบัญชีก้อนเดียว (QR+QR Manual+wallet) เป็น 1 บรรทัด — สูตรเดียวกับพรีวิว
    const { rows: sendRows } = computeSendRows(day.channels, configByCvar);
    for (const g of SETTLEMENT_GROUPS)
      for (const cv of g.cvars)
        legacyRefs.push(`amz-${storeCode}-${day.sales_date}-${cv}`);
    for (const s of sendRows) {
      if (!s.companyId) {
        skippedNoConfig++; // ยังไม่ตั้งบริษัท/บัญชี → ข้าม (ต้องตั้งก่อน)
        continue;
      }
      rows.push({
        companyId: s.companyId,
        entryDate: day.sales_date,
        amountSatang: Math.round(s.net * 100),
        sourceRef: `amz-${storeCode}-${day.sales_date}-${s.key}`,
        description: `Amazon ${branchLabel} · ${s.label} · ${day.sales_date}`,
        customerName: `Café Amazon ${branchLabel}`,
        paymentChannel: s.label,
        channelCode: s.channelCode,
        bankAccountId: s.bankAccountId,
      });
    }
  }
  if (rows.length === 0) return { inserted: 0, skippedNoConfig };

  // INSERT ... ON CONFLICT DO NOTHING (atomic + idempotent + race-safe) — mirror trcloud-revenue.ts
  // conflict target ตรงกับ partial unique index (org,company,source_type,source_ref WHERE source_ref NOT NULL)
  let inserted = 0;
  try {
    // ลบบรรทัดเก่าที่เคยส่งแบบ "แยก QR/QR Manual/wallet" และยัง unmatched — กันนับซ้ำหลังเปลี่ยนมารวมก้อนเดียว
    // (แตะเฉพาะที่ยังไม่จับคู่ statement · ของที่กระทบยอดแล้วไม่ถูกแตะ)
    if (legacyRefs.length) {
      await prisma.$executeRaw`
        DELETE FROM ledger_revenue_entry
        WHERE org_id = ${orgId}::uuid
          AND source_type = 'CASHHUB_AMAZON'
          AND match_state = 'unmatched'
          AND source_ref = ANY(${legacyRefs})
          AND NOT EXISTS (
            SELECT 1 FROM ledger_bank_match_item mi
            WHERE mi.book_type = 'revenue' AND mi.book_id = ledger_revenue_entry.id
          )`;
    }
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
