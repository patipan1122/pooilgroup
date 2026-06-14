// CashHub Hotel — DB layer: แมปช่องทาง→บัญชี + bridge ส่งยอดเข้าจริง → reconcile (ledger_revenue_entry)
// mirror lib/cashhub/amazon-settlement-data.ts — ส่ง book entry แล้วนักบัญชีกระทบกับ statement
// ในหน้า bank-recon → match_state='matched' → หน้า hotel อ่านกลับขึ้นเขียว.
import type { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";

type Admin = ReturnType<typeof adminClient>;

export type HotelChannelConfig = {
  channel: string; // 'qr' | 'cash' | 'ota_agoda' | ...
  label: string;
  isSettle: boolean;
  feePercent: number;
  bankAccountId: string | null;
  companyId: string | null;
  active: boolean;
};

// channel → channel_code มาตรฐานของ bank-recon
const CHANNEL_CODE: Record<string, string> = {
  qr: "qr",
  cash: "cash",
  ota_agoda: "transfer",
  ota_expedia: "transfer",
  ota_booking: "transfer",
};

/** โหลด config ช่องทางโรงแรมที่ active */
export async function loadHotelChannelConfig(
  admin: Admin,
  orgId: string,
): Promise<HotelChannelConfig[]> {
  const { data } = await admin
    .from("cashhub_hotel_channel_config")
    .select("channel, label, is_settle, fee_percent, bank_account_id, company_id, active")
    .eq("org_id", orgId)
    .eq("active", true);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    channel: String(r.channel),
    label: String(r.label ?? r.channel),
    isSettle: r.is_settle == null ? true : Boolean(r.is_settle),
    feePercent: r.fee_percent != null ? Number(r.fee_percent) : 0,
    bankAccountId: (r.bank_account_id as string | null) ?? null,
    companyId: (r.company_id as string | null) ?? null,
    active: Boolean(r.active),
  }));
}

export type HotelDeposit = {
  date: string;
  qrBanked: number;
  cashDeposited: number;
  qrIv: number | null; // qr_banked จาก IV (TTB) — ใช้เตือนถ้าต่างจาก Sheet
  qrSheet: number | null; // qr_banked จาก Sheet (คีย์มือ)
};

/** วันที่ QR จาก IV กับ Sheet ต่างกันเกิน threshold (default 1%) — เตือนก่อนกระทบ */
export function qrDivergences(
  deposits: HotelDeposit[],
  pct = 0.01,
): Array<{ date: string; iv: number; sheet: number; diffPct: number }> {
  const out: Array<{ date: string; iv: number; sheet: number; diffPct: number }> = [];
  for (const d of deposits) {
    if (d.qrIv == null || d.qrSheet == null) continue;
    const base = Math.max(Math.abs(d.qrIv), Math.abs(d.qrSheet));
    if (base === 0) continue;
    const diff = Math.abs(d.qrIv - d.qrSheet) / base;
    if (diff > pct) out.push({ date: d.date, iv: d.qrIv, sheet: d.qrSheet, diffPct: diff });
  }
  return out;
}

/** ยอดเข้าจริงต่อวัน: QR เข้าบัญชี (ตัด 23:00 จาก TTB) + เงินสดฝาก (จากชีต) — รวม 2 ชุดข้อมูล */
export async function computeHotelDeposits(
  admin: Admin,
  orgId: string,
  branchId: string,
  from: string,
  to: string,
): Promise<HotelDeposit[]> {
  const { data } = await admin
    .from("cashhub_hotel_daily")
    .select("sales_date, shift, source, qr_banked, cash_deposited")
    .eq("org_id", orgId)
    .eq("branch_id", branchId)
    .gte("sales_date", from)
    .lte("sales_date", to);
  // ค่าระดับวันอยู่แถวกะเช้า (morning) — fallback กะค่ำถ้าเช้าว่าง. QR เอาจาก trcloud_iv ก่อน (TTB จริง)
  type Acc = { qr: number | null; cash: number | null };
  const iv = new Map<string, Acc>();
  const sheet = new Map<string, Acc>();
  const put = (m: Map<string, Acc>, r: Record<string, unknown>) => {
    const a = m.get(String(r.sales_date)) ?? { qr: null, cash: null };
    const isMorning = r.shift === "morning";
    if (r.qr_banked != null && (isMorning || a.qr == null)) a.qr = Number(r.qr_banked);
    if (r.cash_deposited != null && (isMorning || a.cash == null)) a.cash = Number(r.cash_deposited);
    m.set(String(r.sales_date), a);
  };
  for (const r of (data ?? []) as Record<string, unknown>[])
    put(r.source === "trcloud_iv" ? iv : sheet, r);

  const dates = new Set<string>([...iv.keys(), ...sheet.keys()]);
  return [...dates]
    .map((date) => ({
      date,
      qrBanked: iv.get(date)?.qr ?? sheet.get(date)?.qr ?? 0, // TTB จริงก่อน
      cashDeposited: sheet.get(date)?.cash ?? iv.get(date)?.cash ?? 0,
      qrIv: iv.get(date)?.qr ?? null,
      qrSheet: sheet.get(date)?.qr ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const amountByChannel = (d: HotelDeposit, ch: string): number =>
  ch === "qr" ? d.qrBanked : ch === "cash" ? d.cashDeposited : 0;

/** ส่งยอดเข้าจริงต่อวัน/ช่องทาง → ledger_revenue_entry (idempotent + race-safe) */
export async function sendHotelDaysToReconcile(
  orgId: string,
  branchCode: string,
  branchLabel: string,
  deposits: HotelDeposit[],
  configs: HotelChannelConfig[],
): Promise<{ inserted: number; skippedNoConfig: number; error?: string }> {
  const settleConfigs = configs.filter((c) => c.isSettle && c.active);
  type Row = {
    companyId: string;
    entryDate: string;
    amountSatang: number;
    sourceRef: string;
    description: string;
    channel: string;
    channelCode: string;
    bankAccountId: string | null;
    label: string;
  };
  const rows: Row[] = [];
  let skippedNoConfig = 0;
  for (const d of deposits) {
    for (const c of settleConfigs) {
      const amt = amountByChannel(d, c.channel);
      if (!(amt > 0)) continue; // ไม่มียอดเข้าช่องนี้วันนี้
      if (!c.companyId) {
        skippedNoConfig++; // ยังไม่ตั้งบริษัท/บัญชี → ข้าม
        continue;
      }
      rows.push({
        companyId: c.companyId,
        entryDate: d.date,
        amountSatang: Math.round(amt * 100),
        sourceRef: `hotel:${branchCode}:${d.date}:${c.channel}`,
        description: `โรงแรม ${branchLabel} · ${c.label} · ${d.date}`,
        channel: c.channel,
        channelCode: CHANNEL_CODE[c.channel] ?? "other",
        bankAccountId: c.bankAccountId,
        label: c.label,
      });
    }
  }
  if (rows.length === 0) return { inserted: 0, skippedNoConfig };

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
          'CASHHUB_HOTEL', ${r.sourceRef}, ${r.description}, ${`โรงแรม ${branchLabel}`},
          ${r.label}, ${r.channelCode}, 'unmatched',
          ${r.bankAccountId}::uuid
        )
        ON CONFLICT (org_id, company_id, source_type, source_ref)
          WHERE source_ref IS NOT NULL
        DO UPDATE SET amount_satang = EXCLUDED.amount_satang, updated_at = now()
          WHERE ledger_revenue_entry.match_state = 'unmatched'
            AND ledger_revenue_entry.amount_satang IS DISTINCT FROM EXCLUDED.amount_satang
        RETURNING id`;
        if (res.length) inserted++;
      }
    });
  } catch (e) {
    // transaction rolled back → ไม่มีอะไรเข้า ledger
    return {
      inserted: 0,
      skippedNoConfig,
      error: e instanceof Error ? e.message : "insert error",
    };
  }
  return { inserted, skippedNoConfig };
}

export type ReconcileCell = {
  sent: boolean;
  reconciled: boolean; // matched กับ statement ธนาคารแล้ว (=เขียว)
  amount: number; // บาท
};

/** อ่านสถานะ reconcile กลับมาต่อ (วัน×ช่องทาง) — key = `${date}:${channel}` */
export async function readHotelReconcileStatus(
  orgId: string,
  branchCode: string,
  from: string,
  to: string,
): Promise<Map<string, ReconcileCell>> {
  const prefix = `hotel:${branchCode}:`;
  // 🟢 = กระทบ "ยืนยันแล้ว" เท่านั้น (กัน false-green): match_item ถูกสร้างตั้งแต่ตอน
  // "suggest" (group.status='suggested') → ต้อง JOIN group แล้วเช็ค status='confirmed'
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
      AND r.source_type='CASHHUB_HOTEL'
      AND r.source_ref LIKE ${prefix + "%"}
      AND r.entry_date BETWEEN ${from}::date AND ${to}::date`;
  const out = new Map<string, ReconcileCell>();
  for (const r of rows) {
    // source_ref = hotel:{branchCode}:{date}:{channel}
    const parts = r.source_ref.split(":");
    const channel = parts[parts.length - 1];
    const date = parts[parts.length - 2];
    out.set(`${date}:${channel}`, {
      sent: true,
      reconciled: Boolean(r.reconciled),
      amount: Number(r.amount_satang) / 100,
    });
  }
  return out;
}

export type ReconcileChannelSummary = {
  channel: string;
  label: string;
  daysWithDeposit: number;
  reconciledDays: number; // 🟢 กระทบ statement แล้ว
  pendingDays: number; // 🟡 ส่งแล้ว รอกระทบ
  unsentDays: number; // ⚪ ยังไม่ส่ง
  totalAmount: number;
  reconciledAmount: number;
  outstandingAmount: number; // ยอดที่ยังไม่กระทบ (รอ+ยังไม่ส่ง)
};
export type ReconcileDayCell = {
  channel: string;
  amount: number;
  state: "reconciled" | "pending" | "unsent";
};
export type ReconcileDayView = { day: number; date: string; cells: ReconcileDayCell[] };

/** ประกอบมุมมอง reconcile (pure): สรุปต่อช่องทาง + รายวัน จาก deposits + สถานะ */
export function buildReconcileView(
  deposits: HotelDeposit[],
  statusMap: Map<string, ReconcileCell>,
  channels: { channel: string; label: string }[],
): { summary: ReconcileChannelSummary[]; days: ReconcileDayView[] } {
  const summary: ReconcileChannelSummary[] = channels.map((c) => ({
    channel: c.channel,
    label: c.label,
    daysWithDeposit: 0,
    reconciledDays: 0,
    pendingDays: 0,
    unsentDays: 0,
    totalAmount: 0,
    reconciledAmount: 0,
    outstandingAmount: 0,
  }));
  const byChannel = new Map(summary.map((s) => [s.channel, s]));
  const days: ReconcileDayView[] = [];
  for (const d of deposits) {
    const cells: ReconcileDayCell[] = [];
    for (const c of channels) {
      const amt = c.channel === "qr" ? d.qrBanked : c.channel === "cash" ? d.cashDeposited : 0;
      if (!(amt > 0)) continue;
      const st = statusMap.get(`${d.date}:${c.channel}`);
      const state: ReconcileDayCell["state"] = !st
        ? "unsent"
        : st.reconciled
          ? "reconciled"
          : "pending";
      // ส่งแล้ว → ใช้ยอดที่อยู่ใน ledger จริง (st.amount) ไม่ใช่ยอด deposit ปัจจุบัน
      // (กันยอดเพี้ยนถ้า deposit ถูกแก้หลังส่ง / รวมเรื่องปัดเศษ satang)
      const showAmt = st ? st.amount : amt;
      cells.push({ channel: c.channel, amount: showAmt, state });
      const s = byChannel.get(c.channel)!;
      s.daysWithDeposit += 1;
      s.totalAmount += showAmt;
      if (state === "reconciled") {
        s.reconciledDays += 1;
        s.reconciledAmount += showAmt;
      } else {
        if (state === "pending") s.pendingDays += 1;
        else s.unsentDays += 1;
        s.outstandingAmount += showAmt;
      }
    }
    if (cells.length) days.push({ day: Number(d.date.slice(8, 10)), date: d.date, cells });
  }
  return { summary, days };
}
