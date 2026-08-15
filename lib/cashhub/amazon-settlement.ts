// CashHub Café Amazon — ตรรกะค่าธรรมเนียม + เงินเข้าจริงต่อช่องทาง (pure · server/client ใช้ได้)
//
// เงินเข้าจริง = ยอดช่องทาง − ค่าธรรมเนียม(%). ถ้ายอด/วัน < ขั้นต่ำ = ยังไม่โอน (รอสะสม).
// ช่องที่ไม่ใช่เงินจริง (Redeem/ส่วนลด) → is_settle=false → ไม่เข้าธนาคาร.
//
// 2026-08-15 — granular send (CEO decision): ธนาคารบางวันโอนยอด "QR + Wallet" (กลุ่มเดียว)
// เป็น 2 ก้อนที่ไม่ตรงกับการแบ่งกลุ่มไหนที่เดาได้แน่นอนจากข้อมูล POS อย่างเดียว → แทนที่จะเดา
// กติกาแบ่งกลุ่ม (เสี่ยงผิด) เราส่งยอดราย "คอลัมน์ POS ดิบ" แยกบรรทัดแทน (เมื่อมี posBreakdown
// ของวันนั้นจริง) แล้วให้ pass 2/3 ของ auto-matcher (reconcile-combo-match.ts) รวมกันเองให้ตรง
// กับที่ธนาคารโอนมาจริงวันนั้น — ไม่ผูกกติกาการรวมกลุ่มที่ยังไม่พิสูจน์ลงไปในข้อมูลเงิน

import { CHANNEL_CVAR } from "./amazon-parse";

export type ChannelConfig = {
  cvar: string; // c1, c2, ...
  label: string;
  isSettle: boolean; // เป็นเงินเข้าธนาคารจริงไหม
  feePercent: number; // ค่าธรรมเนียม % (เช่น 0.7, 18)
  minSettleBaht: number; // ยอด/วันต่ำกว่านี้ = ยังไม่โอน (เช่น Lineman 500)
  companyId: string | null;
  bankAccountId: string | null;
};

// ค่าตั้งต้น (super_admin แก้ได้) — อิงข้อมูล CEO 2026-06-14
export const DEFAULT_CHANNELS: ChannelConfig[] = [
  { cvar: "c1", label: "เงินสด", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c2", label: "QR", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c13", label: "QR Manual", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
  // EDC บัตร: ค่าธรรมเนียมจริง ~0.9% (= 0.85% + VAT 7%) — verified prod 0886 (375→371.59 ฯลฯ = 0.91%)
  //   หมายเหตุ: bank stream "AMZ_SD" รวมบัตร(c12)+แต้มสะสม(c11) เป็นก้อนเดียว · แต้มเข้าคนละจังหวะ (จับแยก)
  { cvar: "c12", label: "เครดิต EDC", isSettle: true, feePercent: 0.9, minSettleBaht: 0, companyId: null, bankAccountId: null },
  // Grab/Shopee หักค่าธรรมเนียมแล้วโอนยอดสุทธิ — ค่าธรรมเนียมจริง verified จาก statement 0886 (เม.ย.–มิ.ย. 2026):
  //   Grab = 16.00% เป๊ะทุกวัน · ShopeeFood = 16.05% เป๊ะ (= 15% commission + VAT 7%) · net = gross × 0.8395
  { cvar: "c20", label: "Grab", isSettle: true, feePercent: 16, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c21", label: "Lineman", isSettle: true, feePercent: 18, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c22", label: "ShopeeFood", isSettle: true, feePercent: 16.05, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c14", label: "blueplus wallet", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c15", label: "blueplus credit", isSettle: true, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
  // ไม่ใช่เงินจริง (ไม่เข้าธนาคาร)
  { cvar: "c11", label: "Redeem", isSettle: false, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c7", label: "ส่วนลด AIS", isSettle: false, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c8", label: "ส่วนลด TRUE", isSettle: false, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c9", label: "คูปอง", isSettle: false, feePercent: 0, minSettleBaht: 0, companyId: null, bankAccountId: null },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ChannelSettlement = {
  cvar: string;
  label: string;
  gross: number; // ยอดช่องทาง (จาก POS)
  fee: number; // ค่าธรรมเนียม
  net: number; // เงินเข้าจริง = gross − fee
  settled: boolean; // จะเข้าธนาคารวันนี้ไหม (is_settle && gross ≥ min)
  pending: boolean; // is_settle แต่ยังไม่ถึงขั้นต่ำ → รอสะสม
  companyId: string | null;
  bankAccountId: string | null;
};

/** คำนวณค่าธรรมเนียม/เงินเข้าจริงต่อช่องทาง สำหรับ 1 วัน */
export function computeDaySettlement(
  channels: Record<string, number> | null,
  configByCvar: Map<string, ChannelConfig>,
): {
  perChannel: ChannelSettlement[];
  totalFee: number;
  totalNet: number; // รวมเงินเข้าจริง (เฉพาะที่ settled วันนี้)
  totalPending: number; // รวมยอดที่ยังไม่ถึงขั้นต่ำ (รอสะสม)
} {
  const perChannel: ChannelSettlement[] = [];
  let totalFee = 0,
    totalNet = 0,
    totalPending = 0;
  for (const [cvar, gross] of Object.entries(channels ?? {})) {
    if (!gross) continue;
    const cfg =
      configByCvar.get(cvar) ??
      DEFAULT_CHANNELS.find((c) => c.cvar === cvar) ??
      null;
    const isSettle = cfg?.isSettle ?? false;
    const feePercent = cfg?.feePercent ?? 0;
    const minBaht = cfg?.minSettleBaht ?? 0;
    const label = cfg?.label ?? cvar;
    if (!isSettle) {
      perChannel.push({ cvar, label, gross, fee: 0, net: 0, settled: false, pending: false, companyId: null, bankAccountId: null });
      continue;
    }
    const fee = round2((gross * feePercent) / 100);
    const net = round2(gross - fee);
    // นโยบาย CEO 2026-06-14: ส่งทุกช่อง "เงินเข้าธนาคาร" เข้า reconcile ทุกวัน — ไม่ตัดทิ้งตามขั้นต่ำ
    //   (แพลตฟอร์มมักโอนรวมหลายวัน → ปล่อยให้ bank-recon จับคู่ N:M เอง · กันเงินหายเงียบ)
    //   minSettleBaht เหลือเป็นแค่ "หมายเหตุ" (pending=true = วันนี้ยอดยังต่ำกว่าที่ตั้งไว้) ไม่ใช่ตัวกรอง
    const belowMin = minBaht > 0 && gross < minBaht;
    perChannel.push({
      cvar,
      label,
      gross,
      fee,
      net,
      settled: true,
      pending: belowMin,
      companyId: cfg?.companyId ?? null,
      bankAccountId: cfg?.bankAccountId ?? null,
    });
    totalFee = round2(totalFee + fee);
    totalNet = round2(totalNet + net);
    if (belowMin) totalPending = round2(totalPending + gross);
  }
  return { perChannel, totalFee, totalNet, totalPending };
}

// ─────────────────────────────────────────────────────────────────────────────
// การรวมช่องทาง → "บรรทัดที่ส่งเข้า reconcile"
// 1 ก้อนเงินที่เข้าบัญชีจริง = 1 บรรทัด = จับคู่ statement ธนาคาร 1:1
// ─────────────────────────────────────────────────────────────────────────────

// cvar → channel_code มาตรฐานของ bank-recon
export const CVAR_CHANNEL_CODE: Record<string, string> = {
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

// ช่องทางที่แพลตฟอร์มโอนรวมเข้าบัญชีเป็น "ก้อนเดียวต่อวัน" → ต้องส่ง reconcile เป็น 1 บรรทัด
// (ไม่งั้น statement มี 1 บรรทัด/วัน แต่ระบบส่งหลายบรรทัด → จับคู่ไม่ตรง)
// CEO 2026-06-15: QR Payment + QR Manual + blueplus wallet โอนรวมเข้าด้วยกัน · blueplus credit แยกเดี่ยว
export const SETTLEMENT_GROUPS: {
  key: string;
  label: string;
  channelCode: string;
  cvars: string[];
}[] = [
  { key: "qr", label: "QR + Wallet", channelCode: "qr", cvars: ["c2", "c13", "c14"] },
];

// cvar → group key (ช่องที่ไม่อยู่ในกลุ่ม = ส่งเดี่ยว 1 บรรทัด/วัน)
export const CVAR_GROUP: Record<string, string> = Object.fromEntries(
  SETTLEMENT_GROUPS.flatMap((g) => g.cvars.map((cv) => [cv, g.key] as const)),
);

export type SettlementSendRow = {
  key: string; // source_ref suffix (group key · cvar เดี่ยว · หรือ "<groupKey>-<cvar>-<sanitizedLabel>" สำหรับ granular)
  label: string;
  channelCode: string;
  gross: number;
  fee: number;
  net: number;
  feePercent: number; // ค่าธรรมเนียมรวม % (สำหรับแสดงผล)
  companyId: string | null;
  bankAccountId: string | null;
  memberCvars: string[];
  granular?: boolean; // true = แถวนี้คือ sub-line ต่อคอลัมน์ POS ดิบ (ไม่ใช่ก้อนรวมกลุ่ม)
};

/** ทำ raw POS label (เช่น "QRPayment(API)") ให้ปลอดภัยเป็นส่วนหนึ่งของ source_ref —
 *  ตัวพิมพ์เล็ก, ตัด char พิเศษ/เว้นวรรคเป็น "-", deterministic ข้ามการส่งซ้ำ (idempotent) */
export function sanitizeRefLabel(label: string): string {
  const cleaned = label
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "x"; // กัน label ว่างเปล่าหลัง sanitize (เช่นมีแต่สัญลักษณ์)
}

// ยอมให้ยอด "กลุ่ม" (จาก channels/iv_channels ที่ใช้ครั้งนี้) ต่างจากผลรวม posBreakdown
// ของกลุ่มเดียวกันได้ไม่เกินนี้ก่อนไว้ใจแยก granular — ใช้ค่าเดียวกับ sumOk/checkOk ใน
// amazon-parse.ts (0.5 บาท) ให้เป็นมาตรฐานเดียวกันทั้งระบบ
const BREAKDOWN_TIE_OUT_TOLERANCE = 0.5;

/**
 * แปลงยอดขายต่อวัน → "บรรทัดที่จะส่งเข้า reconcile"
 * - ถ้ามี posBreakdown (ไส้ในราย POS-column ดิบ) ของวันนั้น "ครบ" สำหรับกลุ่มไหน (ผลรวม
 *   ตรงกับยอดกลุ่มที่ใช้จริงในคอลนี้ — กันกรณี channels เป็น iv_channels ที่ TRCloud
 *   จัดหมวดใหม่ไปแล้วจนไม่ตรงกับ POS ดิบอีกต่อไป) → ส่งแยกราย label (granular)
 * - ไม่มี/ไม่ครบ → กลับไปพฤติกรรมเดิมเป๊ะ: รวมเป็น 1 บรรทัด/กลุ่ม
 * ใช้ร่วมกันทั้งตัวส่งจริง (sendDaysToReconcile) และพรีวิวในหน้าตั้งค่า → เลขตรงกันเสมอ
 */
export function computeSendRows(
  channels: Record<string, number> | null,
  configByCvar: Map<string, ChannelConfig>,
  posBreakdown?: Record<string, number> | null,
): { rows: SettlementSendRow[]; totalNet: number; granularGroupKeys: string[] } {
  const { perChannel } = computeDaySettlement(channels, configByCvar);
  const settled = perChannel.filter((s) => s.settled);
  const rows: SettlementSendRow[] = [];
  const granularGroupKeys: string[] = [];

  // 1) ช่องที่โอนรวมเข้าบัญชีก้อนเดียว (ปกติ) — หรือแยกราย POS-column ดิบ (granular)
  for (const g of SETTLEMENT_GROUPS) {
    const members = settled.filter((s) => g.cvars.includes(s.cvar));
    if (members.length === 0) continue;
    const gross = round2(members.reduce((a, m) => a + m.gross, 0));

    // labels ดิบที่มีเงิน (≠0) วันนี้ ซึ่ง map เข้ากลุ่มนี้ผ่าน CHANNEL_CVAR
    const groupLabels = posBreakdown
      ? Object.entries(posBreakdown).filter(
          ([label, amt]) => amt !== 0 && g.cvars.includes(CHANNEL_CVAR[label]),
        )
      : [];
    const breakdownSum = round2(groupLabels.reduce((a, [, amt]) => a + amt, 0));
    const tiesOut = groupLabels.length > 0 && Math.abs(breakdownSum - gross) < BREAKDOWN_TIE_OUT_TOLERANCE;

    if (tiesOut) {
      // granular: 1 บรรทัดต่อ raw POS label
      for (const [label, amt] of groupLabels) {
        const cvar = CHANNEL_CVAR[label];
        const member = members.find((m) => m.cvar === cvar);
        if (!member) continue; // cvar นี้ settle=false ตาม config → ข้ามเหมือนพฤติกรรมเดิม
        const feePercent = configByCvar.get(cvar)?.feePercent ?? 0;
        const lineGross = round2(amt);
        const fee = round2((lineGross * feePercent) / 100);
        const net = round2(lineGross - fee);
        rows.push({
          key: `${g.key}-${cvar}-${sanitizeRefLabel(label)}`,
          label: `${g.label} · ${label}`,
          channelCode: g.channelCode,
          gross: lineGross,
          fee,
          net,
          feePercent,
          companyId: member.companyId,
          bankAccountId: member.bankAccountId,
          memberCvars: [cvar],
          granular: true,
        });
      }
      granularGroupKeys.push(g.key);
    } else {
      // เดิม: รวมเป็น 1 บรรทัด/กลุ่ม (ไม่มี posBreakdown ครบ หรือยอดไม่ตรงกับ channels ที่ใช้จริง)
      const fee = round2(members.reduce((a, m) => a + m.fee, 0));
      const net = round2(members.reduce((a, m) => a + m.net, 0));
      // โอนรวม = บัญชีเดียวกัน → ใช้ config ของสมาชิกตัวแรกที่ตั้งบริษัทไว้
      const rep = members.find((m) => m.companyId) ?? members[0];
      rows.push({
        key: g.key,
        label: g.label,
        channelCode: g.channelCode,
        gross,
        fee,
        net,
        feePercent: gross > 0 ? round2((fee / gross) * 100) : 0,
        companyId: rep.companyId,
        bankAccountId: rep.bankAccountId,
        memberCvars: members.map((m) => m.cvar),
      });
    }
  }

  // 2) ช่องเดี่ยว (ไม่อยู่ในกลุ่ม) → 1 บรรทัด/ช่อง (ไม่มีอะไรให้แยกอยู่แล้ว — ไม่แตะ)
  for (const s of settled) {
    if (CVAR_GROUP[s.cvar]) continue;
    rows.push({
      key: s.cvar,
      label: s.label,
      channelCode: CVAR_CHANNEL_CODE[s.cvar] ?? "other",
      gross: s.gross,
      fee: s.fee,
      net: s.net,
      feePercent: configByCvar.get(s.cvar)?.feePercent ?? 0,
      companyId: s.companyId,
      bankAccountId: s.bankAccountId,
      memberCvars: [s.cvar],
    });
  }

  const totalNet = round2(rows.reduce((a, r) => a + r.net, 0));
  return { rows, totalNet, granularGroupKeys };
}

/** สร้างรายการ source_ref เก่าที่ต้องพิจารณาลบ (legacy-shape cleanup) สำหรับ 1 วัน:
 *  - ref แบบ "แยก cvar ก่อนมีการรวมกลุ่ม" (ก่อน 2026-06) — เดิมอยู่แล้ว ลบทุกครั้งที่ส่งวันนั้น
 *  - ref แบบ "รวมกลุ่มก้อนเดียว" (เช่น "...-qr") — ลบเฉพาะกลุ่มที่วันนี้เปลี่ยนไปส่งแบบ
 *    granular แทน (granularGroupKeys) กันไม่ให้ก้อนรวมเก่าค้าง unmatched ซ้อนกับบรรทัดใหม่
 *  ตัวลบจริง (SQL) อยู่ที่ sendDaysToReconcile — ฟังก์ชันนี้คืนแค่ "รายชื่อ ref ที่ควรพิจารณา"
 *  การป้องกันแถว matched/confirmed อยู่ที่ WHERE match_state='unmatched' ในฝั่ง SQL (ไม่แตะที่นี่)
 */
export function legacyRefsForDay(
  storeCode: string,
  salesDate: string,
  granularGroupKeys: string[],
): string[] {
  const refs: string[] = [];
  for (const g of SETTLEMENT_GROUPS) {
    for (const cv of g.cvars) refs.push(`amz-${storeCode}-${salesDate}-${cv}`);
  }
  for (const gKey of granularGroupKeys) refs.push(`amz-${storeCode}-${salesDate}-${gKey}`);
  return refs;
}
