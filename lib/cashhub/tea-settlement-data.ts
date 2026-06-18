// CashHub ร้านชาไข่มุก — DB layer (server-only): bridge ส่งยอดเข้าจริง → reconcile (ledger_revenue_entry)
// mirror lib/cashhub/hotel-settlement-data.ts — ส่ง book entry (net หักค่าธรรมเนียมต่อช่องทาง)
// แล้วนักบัญชีกระทบกับ statement ในหน้า bank-recon → match_state='matched' → หน้า tea อ่านกลับขึ้นเขียว.
// ⚠️ ใช้ prisma (node-only) — ห้าม import จาก client. ตรรกะ net ต่อช่องทางอยู่ใน tea-channels.ts (pure).
import { prisma } from "@/lib/prisma";
import {
  computeTeaSettlement,
  type TeaChannelConfig,
  type TeaChannelCode,
} from "./tea-channels";

// channel → channel_code มาตรฐานของ bank-recon (hint จับคู่ statement)
const CHANNEL_CODE: Record<string, string> = {
  cash: "cash",
  qr: "qr",
  card: "card",
  grab: "transfer",
  lineman: "transfer",
  shopee: "transfer",
  wallet: "transfer",
};

export type TeaSendDay = {
  date: string;
  posChannels: Partial<Record<TeaChannelCode, number>> | null;
};

/** ส่งยอดเข้าจริงต่อวัน/ช่องทาง (net หักค่าธรรมเนียม) → ledger_revenue_entry (idempotent + race-safe).
 *  ส่งเฉพาะช่องทางที่ตั้ง "เป็นเงินเข้าธนาคาร" (isSettle) + ผูกบริษัทแล้ว + ถึงขั้นต่ำ (settled). */
export async function sendTeaDaysToReconcile(
  orgId: string,
  branchCode: string,
  branchLabel: string,
  days: TeaSendDay[],
  configs: TeaChannelConfig[],
): Promise<{ inserted: number; skippedNoConfig: number; pendingDays: number; error?: string }> {
  const configByCode = new Map(configs.map((c) => [c.code, c]));
  type Row = {
    companyId: string;
    entryDate: string;
    amountSatang: number;
    sourceRef: string;
    description: string;
    channelCode: string;
    bankAccountId: string | null;
    label: string;
  };
  const rows: Row[] = [];
  let skippedNoConfig = 0;
  let pendingDays = 0;
  for (const d of days) {
    const { perChannel } = computeTeaSettlement(d.posChannels ?? null, configByCode);
    for (const ch of perChannel) {
      if (ch.pending) {
        pendingDays++; // ยังไม่ถึงขั้นต่ำ → รอสะสม (ไม่ส่ง)
        continue;
      }
      if (!ch.settled) continue; // ไม่ใช่เงินเข้าธนาคาร (ส่วนลด/อื่นๆ)
      if (!(ch.net > 0)) continue; // ไม่มียอดเข้าช่องนี้วันนี้
      if (!ch.companyId) {
        skippedNoConfig++; // ยังไม่ผูกบริษัท/บัญชี → ข้าม
        continue;
      }
      rows.push({
        companyId: ch.companyId,
        entryDate: d.date,
        amountSatang: Math.round(ch.net * 100),
        sourceRef: `tea:${branchCode}:${d.date}:${ch.code}`,
        description: `ร้านชา ${branchLabel} · ${ch.label} · ${d.date}`,
        channelCode: CHANNEL_CODE[ch.code] ?? "other",
        bankAccountId: ch.bankAccountId,
        label: ch.label,
      });
    }
  }
  if (rows.length === 0) return { inserted: 0, skippedNoConfig, pendingDays };

  // ห่อ transaction เดียว (all-or-nothing) — ถ้าพังกลางทางไม่เข้า ledger บางส่วน
  let inserted = 0;
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const res = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ledger_revenue_entry
          (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
           description, customer_name, payment_channel, channel_code, match_state,
           expected_bank_account_id)
        VALUES (
          ${orgId}::uuid, ${r.companyId}::uuid, ${r.entryDate}::date, ${r.amountSatang},
          'CASHHUB_TEA', ${r.sourceRef}, ${r.description}, ${`ร้านชา ${branchLabel}`},
          ${r.label}, ${r.channelCode}, 'unmatched',
          ${r.bankAccountId}::uuid
        )
        ON CONFLICT (org_id, company_id, source_type, source_ref)
          WHERE source_ref IS NOT NULL
        -- ส่งซ้ำ = อัปเดตทั้งยอด + เลขบัญชีปลายทาง (กันรายการเก่าที่ยังไม่ผูกบัญชี/ยอดเพี้ยน)
        -- แตะเฉพาะรายการที่ยัง "ไม่กระทบ" (unmatched) เท่านั้น — ปลอดภัยกับที่ reconcile ไปแล้ว
        DO UPDATE SET amount_satang = EXCLUDED.amount_satang,
                      expected_bank_account_id = EXCLUDED.expected_bank_account_id,
                      payment_channel = EXCLUDED.payment_channel,
                      channel_code = EXCLUDED.channel_code,
                      updated_at = now()
          WHERE ledger_revenue_entry.match_state = 'unmatched'
            AND (ledger_revenue_entry.amount_satang IS DISTINCT FROM EXCLUDED.amount_satang
                 OR ledger_revenue_entry.expected_bank_account_id IS DISTINCT FROM EXCLUDED.expected_bank_account_id)
        RETURNING id`;
        if (res.length) inserted++;
      }
    });
  } catch (e) {
    return {
      inserted: 0,
      skippedNoConfig,
      pendingDays,
      error: e instanceof Error ? e.message : "insert error",
    };
  }
  return { inserted, skippedNoConfig, pendingDays };
}

export type TeaReconcileCell = {
  sent: boolean;
  reconciled: boolean; // matched กับ statement ธนาคารแล้ว (=เขียว)
  amount: number; // บาท
};

/** อ่านสถานะ reconcile กลับมาทุกสาขาในช่วง — key = source_ref (`tea:{branchCode}:{date}:{channel}`) */
export async function readTeaReconcileStatus(
  orgId: string,
  from: string,
  to: string,
): Promise<Record<string, TeaReconcileCell>> {
  // 🟢 = กระทบ "ยืนยันแล้ว" เท่านั้น (กัน false-green): match_item ถูกสร้างตั้งแต่ตอน "suggest"
  // (group.status='suggested') → ต้อง JOIN group แล้วเช็ค status='confirmed'.
  const rows = await prisma.$queryRaw<
    { source_ref: string; amount_satang: bigint; reconciled: boolean }[]
  >`
    SELECT r.source_ref, r.amount_satang,
      (r.match_state='matched' OR EXISTS(
        SELECT 1 FROM ledger_bank_match_item mi
        JOIN ledger_bank_match_group g ON g.id=mi.group_id
        WHERE mi.book_type='revenue' AND mi.book_id=r.id
          AND g.status='confirmed')) as reconciled
    FROM ledger_revenue_entry r
    WHERE r.org_id=${orgId}::uuid
      AND r.source_type='CASHHUB_TEA'
      AND r.entry_date BETWEEN ${from}::date AND ${to}::date`;
  const out: Record<string, TeaReconcileCell> = {};
  for (const r of rows) {
    out[r.source_ref] = {
      sent: true,
      reconciled: Boolean(r.reconciled),
      amount: Number(r.amount_satang) / 100,
    };
  }
  return out;
}
