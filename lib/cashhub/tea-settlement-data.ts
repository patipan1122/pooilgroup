// CashHub ร้านชาไข่มุก — DB layer (server-only): bridge ส่งยอดเข้าจริง → reconcile (ledger_revenue_entry)
// mirror lib/cashhub/hotel-settlement-data.ts — ส่ง book entry (net หักค่าธรรมเนียมต่อช่องทาง)
// แล้วนักบัญชีกระทบกับ statement ในหน้า bank-recon → match_state='matched' → หน้า tea อ่านกลับขึ้นเขียว.
// ⚠️ ใช้ prisma (node-only) — ห้าม import จาก client. ตรรกะ net ต่อช่องทางอยู่ใน tea-channels.ts (pure).
import { prisma } from "@/lib/prisma";
import {
  computeTeaSettlement,
  TEA_CHANNEL_BY_CODE,
  type TeaChannelConfig,
  type TeaChannelCode,
} from "./tea-channels";

// channel → channel_code มาตรฐานของ bank-recon (hint จับคู่ statement)
const CHANNEL_CODE: Record<string, string> = {
  cash: "cash",
  qr: "qr",
  kplus: "transfer",
  thaichuaithaiplus: "transfer",
  online: "transfer",
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

type SendRow = {
  companyId: string;
  entryDate: string;
  amountSatang: number;
  sourceRef: string;
  description: string;
  channelCode: string;
  bankAccountId: string | null;
  label: string;
};

const sendRowSql = (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], orgId: string, branchLabel: string, r: SendRow) =>
  tx.$queryRaw<{ id: string }[]>`
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

/** ส่งยอดเข้าจริงต่อวัน/ช่องทาง (net หักค่าธรรมเนียม) → ledger_revenue_entry (idempotent + race-safe).
 *  ส่งเฉพาะช่องทางที่ตั้ง "เป็นเงินเข้าธนาคาร" (isSettle) + ผูกบริษัทแล้ว + ถึงขั้นต่ำ (settled).
 *
 *  txByDateChannel (CEO 2026-08-23): เงินเข้าจริงเป็นรายทรานเซกชัน ไม่ใช่ยอดรวมก้อนเดียว — ถ้ามีรายบิล
 *  ของ (วัน, ช่องทาง) นั้น (จาก cashhub_tea_pos_transaction ผ่าน loadTeaPosTransactionsRange) ให้ส่งแยก
 *  ทีละรายการแทน (source_ref ต่อท้าย `:index` เรียงยอดมาก→น้อย — คงที่ตราบใดที่ชุดยอดของวันนั้นไม่เปลี่ยน)
 *  ไม่มีรายบิล (ยังไม่ได้อัปโหลดไฟล์ใหม่) → fallback ส่งยอดรวม/วันเหมือนเดิม ไม่เปลี่ยนพฤติกรรม.
 *  ก้อนรวมเก่าที่เคยส่งไว้ (source_ref ไม่มี index) จะถูกลบทิ้งแทนที่ด้วยรายการย่อย — เฉพาะที่ยัง
 *  "unmatched" เท่านั้น (ปลอดภัย) · ถ้าก้อนรวมเก่าแมตช์กับธนาคารไปแล้ว จะไม่แตะ/ไม่ส่งรายการย่อยทับ
 *  (กันเงินซ้อน) — นับเป็น skippedMatchedAggregate ไว้ให้ CEO ตรวจเอง. */
export async function sendTeaDaysToReconcile(
  orgId: string,
  branchCode: string,
  branchLabel: string,
  days: TeaSendDay[],
  configs: TeaChannelConfig[],
  txByDateChannel: Map<string, number[]> = new Map(),
): Promise<{
  inserted: number;
  skippedNoConfig: number;
  pendingDays: number;
  itemizedDays: number;
  skippedMatchedAggregate: number;
  error?: string;
}> {
  const configByCode = new Map(configs.map((c) => [c.code, c]));
  const aggregateRows: SendRow[] = [];
  type ItemGroup = { aggregateRef: string; items: SendRow[] };
  const itemGroups: ItemGroup[] = [];
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
      // itemize เฉพาะช่องที่ธนาคารรวมยอดเป็นรายทรานเซกชันจริง (เช่น QR) — K Plus/ไทยช่วยไทยพลัส/อื่นๆ
      // ธนาคารรวมยอดเป็นก้อนเดียว/วัน (CEO ยืนยัน 2026-08-28) แม้จะมีรายบิลเก็บไว้ให้ดูไส้ในก็ตาม
      const canItemize = TEA_CHANNEL_BY_CODE[ch.code]?.itemizedSettle === true;
      const txAmounts = canItemize ? txByDateChannel.get(`${d.date}|${ch.code}`) : undefined;
      if (txAmounts && txAmounts.length > 0) {
        // หักค่าธรรมเนียมตามสัดส่วนเดียวกับยอดรวม (net/gross) ต่อรายการ — ผลรวมยังตรงกับยอดรวม/วันเป๊ะ
        const feeRatio = ch.gross > 0 ? ch.net / ch.gross : 1;
        const items: SendRow[] = [];
        txAmounts.forEach((raw, i) => {
          const net = Math.round(raw * feeRatio * 100) / 100;
          if (!(net > 0)) return;
          items.push({
            companyId: ch.companyId!,
            entryDate: d.date,
            amountSatang: Math.round(net * 100),
            sourceRef: `tea:${branchCode}:${d.date}:${ch.code}:${i}`,
            description: `ร้านชา ${branchLabel} · ${ch.label} #${i + 1} · ${d.date}`,
            channelCode: CHANNEL_CODE[ch.code] ?? "other",
            bankAccountId: ch.bankAccountId,
            label: ch.label,
          });
        });
        if (items.length > 0)
          itemGroups.push({ aggregateRef: `tea:${branchCode}:${d.date}:${ch.code}`, items });
      } else {
        aggregateRows.push({
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
  }
  if (aggregateRows.length === 0 && itemGroups.length === 0)
    return { inserted: 0, skippedNoConfig, pendingDays, itemizedDays: 0, skippedMatchedAggregate: 0 };

  // ห่อ transaction เดียว (all-or-nothing) — ถ้าพังกลางทางไม่เข้า ledger บางส่วน
  let inserted = 0;
  let itemizedDays = 0;
  let skippedMatchedAggregate = 0;
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of aggregateRows) {
        const res = await sendRowSql(tx, orgId, branchLabel, r);
        if (res.length) inserted++;
      }
      for (const grp of itemGroups) {
        const existing = await tx.$queryRaw<{ match_state: string }[]>`
          SELECT match_state FROM ledger_revenue_entry
          WHERE org_id = ${orgId}::uuid AND source_type = 'CASHHUB_TEA' AND source_ref = ${grp.aggregateRef}`;
        // ก้อนรวมเก่าแมตช์กับธนาคารไปแล้ว → ห้ามลบ/ห้ามส่งรายการย่อยทับ (กันเงินซ้อน) ข้ามวันนี้ทั้งช่องทาง
        if (existing.length > 0 && existing[0].match_state !== "unmatched") {
          skippedMatchedAggregate++;
          continue;
        }
        if (existing.length > 0) {
          await tx.$executeRaw`
            DELETE FROM ledger_revenue_entry
            WHERE org_id = ${orgId}::uuid AND source_type = 'CASHHUB_TEA' AND source_ref = ${grp.aggregateRef}
              AND match_state = 'unmatched'`;
        }
        for (const r of grp.items) {
          const res = await sendRowSql(tx, orgId, branchLabel, r);
          if (res.length) inserted++;
        }
        itemizedDays++;
      }
    });
  } catch (e) {
    return {
      inserted: 0,
      skippedNoConfig,
      pendingDays,
      itemizedDays: 0,
      skippedMatchedAggregate: 0,
      error: e instanceof Error ? e.message : "insert error",
    };
  }
  return { inserted, skippedNoConfig, pendingDays, itemizedDays, skippedMatchedAggregate };
}

export type TeaReconcileCell = {
  sent: boolean;
  reconciled: boolean; // matched กับ statement ธนาคารแล้ว (=เขียว/รุ้ง)
  amount: number; // บาท (ยอดที่ส่งเข้า ledger — net หักค่าธรรมเนียม)
  deltaBaht: number | null; // เงินเข้าธนาคารจริง − ยอดที่ส่ง (>0 เกิน · <0 ขาด) · null = ยังไม่จับคู่/ไม่มี delta
};

/** อ่านสถานะ reconcile กลับมาทุกสาขาในช่วง — key = source_ref (`tea:{branchCode}:{date}:{channel}`) */
export async function readTeaReconcileStatus(
  orgId: string,
  from: string,
  to: string,
): Promise<Record<string, TeaReconcileCell>> {
  // 🟢/รุ้ง = กระทบ "ยืนยันแล้ว" เท่านั้น (กัน false-green): match_item ถูกสร้างตั้งแต่ตอน "suggest"
  // (group.status='suggested') → ต้อง JOIN group แล้วเช็ค status='confirmed'.
  // delta_satang = bank_total − book_total ของกลุ่มที่ยืนยันแล้ว (>0 เกิน · <0 ขาด).
  const rows = await prisma.$queryRaw<
    { source_ref: string; amount_satang: bigint; reconciled: boolean; delta_satang: bigint | null }[]
  >`
    SELECT r.source_ref, r.amount_satang,
      (r.match_state='matched' OR EXISTS(
        SELECT 1 FROM ledger_bank_match_item mi
        JOIN ledger_bank_match_group g ON g.id=mi.group_id
        WHERE mi.book_type='revenue' AND mi.book_id=r.id
          AND g.status='confirmed')) as reconciled,
      (SELECT g.delta_satang FROM ledger_bank_match_item mi
        JOIN ledger_bank_match_group g ON g.id=mi.group_id
        WHERE mi.book_type='revenue' AND mi.book_id=r.id
          AND g.status='confirmed' LIMIT 1) as delta_satang
    FROM ledger_revenue_entry r
    WHERE r.org_id=${orgId}::uuid
      AND r.source_type='CASHHUB_TEA'
      AND r.entry_date BETWEEN ${from}::date AND ${to}::date`;

  // รายการย่อย (source_ref ลงท้าย `:index` เช่น tea:{branch}:{date}:qr:0) รวมกลับเป็น cell เดียว
  // ด้วยการตัด `:index` ท้ายออก (ก้อนรวมแบบเดิมไม่มี index อยู่แล้ว → ตัดแล้วไม่เปลี่ยนอะไร) เพื่อให้
  // ตารางฝั่ง UI (คีย์ด้วย tea:{branch}:{date}:{channel} เดิม) ยังหาเจอเหมือนเดิมแม้ส่งแยกทีละรายการ.
  // reconciled = true เฉพาะเมื่อ "ทุกรายการย่อย" ของ cell นั้นแมชแล้ว (กัน false-green ตอนแมชแค่บางส่วน).
  const groups = new Map<
    string,
    { amountSatang: number; allReconciled: boolean; deltaSatang: number; hasDelta: boolean }
  >();
  for (const r of rows) {
    const baseRef = r.source_ref.replace(/:\d+$/, "");
    const g = groups.get(baseRef) ?? { amountSatang: 0, allReconciled: true, deltaSatang: 0, hasDelta: false };
    g.amountSatang += Number(r.amount_satang);
    g.allReconciled = g.allReconciled && Boolean(r.reconciled);
    if (r.delta_satang != null) {
      g.deltaSatang += Number(r.delta_satang);
      g.hasDelta = true;
    }
    groups.set(baseRef, g);
  }
  const out: Record<string, TeaReconcileCell> = {};
  for (const [baseRef, g] of groups) {
    out[baseRef] = {
      sent: true,
      reconciled: g.allReconciled,
      amount: g.amountSatang / 100,
      deltaBaht: g.allReconciled && g.hasDelta ? g.deltaSatang / 100 : null,
    };
  }
  return out;
}
