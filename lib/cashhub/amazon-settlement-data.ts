// CashHub Café Amazon — DB layer ของการตั้งค่าชำระเงิน + bridge ส่งเงินเข้าจริง → reconcile (revenue entry)
import type { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_CHANNELS,
  computeSendRows,
  legacyRefsForDay,
  type ChannelConfig,
} from "./amazon-settlement";
import type { SavedAmazonDay } from "./amazon-data";
import { BANK_LABELS } from "@/lib/ledger/bank-adapters/types";

type Admin = ReturnType<typeof adminClient>;

/** โหลด config ช่องทาง (merge กับ default — ช่องใหม่โผล่อัตโนมัติ)
 *  branchCode = "" → ค่าเริ่มต้นทุกสาขา (org default) · ระบุสาขา → ใช้ค่าสาขานั้นถ้ามี ไม่งั้น fallback ค่าเริ่มต้น */
export async function loadChannelConfig(
  admin: Admin,
  orgId: string,
  branchCode = "",
): Promise<ChannelConfig[]> {
  const { data } = await admin
    .from("cashhub_amazon_channel_config")
    .select("branch_code, channel_cvar, label, is_settle, fee_percent, min_settle_satang, company_id, bank_account_id")
    .eq("org_id", orgId);
  const orgDefault = new Map<string, Record<string, unknown>>();
  const branchRows = new Map<string, Record<string, unknown>>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const bc = String(r.branch_code ?? "");
    if (bc === "") orgDefault.set(String(r.channel_cvar), r);
    else if (bc === branchCode) branchRows.set(String(r.channel_cvar), r);
  }
  return DEFAULT_CHANNELS.map((d) => {
    const s = branchRows.get(d.cvar) ?? orgDefault.get(d.cvar);
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

/** เช็คว่าสาขานี้มีค่าตั้งเป็นของตัวเองไหม (ไม่อิงค่าเริ่มต้น) — ใช้โชว์ใน UI */
export async function branchHasOwnConfig(
  admin: Admin,
  orgId: string,
  branchCode: string,
): Promise<boolean> {
  if (!branchCode) return false;
  const { count } = await admin
    .from("cashhub_amazon_channel_config")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("branch_code", branchCode);
  return (count ?? 0) > 0;
}

/** บันทึก config (super_admin) — upsert ต่อช่องทาง/สาขา (branchCode="" = ค่าเริ่มต้นทุกสาขา) */
export async function saveChannelConfig(
  admin: Admin,
  orgId: string,
  configs: ChannelConfig[],
  branchCode = "",
): Promise<{ ok: boolean; error?: string }> {
  const rows = configs.map((c) => ({
    org_id: orgId,
    branch_code: branchCode,
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
    .upsert(rows, { onConflict: "org_id,branch_code,channel_cvar" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export type BankAccountOpt = { id: string; name: string; bankCode: string; last4: string; label: string };

// ป้าย dropdown: "ธนาคาร ****เลข4ตัวท้าย" — ระบุบัญชีจากธนาคาร+เลขชัดเจน ไม่โชว์ชื่อที่ตั้งเอง (CEO: กันสับสน)
// name ใช้เป็น fallback เฉพาะกรณีไม่มีชื่อธนาคาร (กันป้ายว่าง)
export function bankAccountLabel(bankCode: string, last4: string, name: string): string {
  const bank = BANK_LABELS[bankCode] || bankCode || name || "บัญชี";
  const num = last4 ? ` ****${last4}` : "";
  return `${bank}${num}`;
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
): Promise<{ inserted: number; skippedNoConfig: number; sentUnbalanced: string[]; error?: string }> {
  const configByCvar = new Map(configs.map((c) => [c.cvar, c]));
  const rows: ReconcileRow[] = [];
  // source_ref รูปแบบเก่าที่อาจค้าง unmatched อยู่ (ก่อนรวมก้อนเดียว 2026-06 · หรือก้อนรวมกลุ่ม
  // ที่วันนี้เปลี่ยนไปส่งแบบ granular แทน 2026-08) → เก็บไว้ลบกันนับซ้ำ (ดู legacyRefsForDay)
  const legacyRefs: string[] = [];
  let skippedNoConfig = 0;
  // วันที่ "ยอด POS ไม่ลงตัว" (ปิดกะไม่ครบ/มีช่องตกหล่น) แต่ยังส่งยอดช่องทางจริงเข้า reconcile
  //   → จดไว้รายงานให้ CEO เห็น (กันเงียบ)
  //   ⚠️ เดิม `if (!day.balanced) continue` กันทั้งวัน → เงินสด/QR ที่เข้าธนาคารจริงแล้วไม่มีคู่ให้จับ
  //      (เช่น 3,6,11,16 เม.ย. ยอดต่าง 20-30฿ ทำให้เงินหมื่นกว่าบาทค้างเงียบ ทั้งวัน)
  //   ตอนนี้ส่งยอดช่องทางที่อ่านได้เข้าไปเหมือน Hotel (sendHotelDaysToReconcile ไม่มี gate นี้) —
  //      ส่วนต่างเล็ก ๆ เป็นเรื่อง POS↔ยอดขายรวม (คนละชั้นกับการจับคู่ธนาคาร) ไม่บล็อกเงินทั้งวัน
  const sentUnbalanced: string[] = [];
  for (const day of days) {
    // แหล่งยอดต่อช่องทาง: ใช้ iv_channels (ไส้ในใบ TRCloud ที่ยืนยันแล้ว) ก่อนเสมอถ้ามี —
    //   TRCloud บางวัน reclassify เงินข้ามช่องทาง (เช่น ย้าย QR บางส่วนไป Grab) เทียบกับไฟล์ POS ดิบ
    //   ยืนยันกับยอดธนาคารจริงแล้วว่า iv_channels ตรงเป๊ะถึงสตางค์ ส่วน channels (POS ดิบ) อาจเพี้ยนวันที่มีการจัดหมวดใหม่
    //   fallback ไป channels เฉพาะวันที่ยังไม่มีใบ IV ยืนยัน (เช่นวันล่าสุดที่ TRCloud ยังไม่ประมวลผล)
    const channels =
      day.iv_channels && Object.keys(day.iv_channels).length > 0 ? day.iv_channels : day.channels;
    // รวมช่องที่โอนเข้าบัญชีก้อนเดียว (QR+QR Manual+wallet) เป็น 1 บรรทัด — หรือแยกราย
    // POS-column ดิบ (granular) ถ้ามี posBreakdown ของวันนั้นครบ+ตรงกับ channels ที่ใช้จริง
    // — สูตรเดียวกับพรีวิว (amazon/settings/page.tsx)
    const { rows: sendRows, granularGroupKeys } = computeSendRows(
      channels,
      configByCvar,
      day.posBreakdown,
    );
    // ref เก่าที่ต้องพิจารณาลบ: ก้อนแยก-cvar-ก่อนรวมกลุ่ม (เดิม) + ก้อนรวมกลุ่มของวันนี้
    //   ถ้าวันนี้เปลี่ยนไปส่งแบบ granular แทน (กันซ้อนเงินสองรูปแบบ — ดู legacyRefsForDay)
    legacyRefs.push(...legacyRefsForDay(storeCode, day.sales_date, granularGroupKeys));
    let dayContributed = false;
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
      dayContributed = true;
    }
    // ส่งเงินจริงของวันนี้เข้าไปแล้ว แต่ยอด POS วันนี้ไม่ลงตัว → แจ้ง CEO ให้ไปตรวจไฟล์ปิดกะ
    if (dayContributed && !day.balanced) sentUnbalanced.push(day.sales_date);
  }
  if (rows.length === 0) return { inserted: 0, skippedNoConfig, sentUnbalanced };

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
        DO UPDATE SET
          amount_satang = EXCLUDED.amount_satang,
          payment_channel = EXCLUDED.payment_channel,
          channel_code = EXCLUDED.channel_code,
          expected_bank_account_id = EXCLUDED.expected_bank_account_id,
          description = EXCLUDED.description,
          customer_name = EXCLUDED.customer_name,
          updated_at = now()
        WHERE ledger_revenue_entry.match_state = 'unmatched'
        RETURNING id`;
      if (res.length) inserted++;
    }
  } catch (e) {
    return {
      inserted,
      skippedNoConfig,
      sentUnbalanced,
      error: e instanceof Error ? e.message : "insert error",
    };
  }
  return { inserted, skippedNoConfig, sentUnbalanced };
}
