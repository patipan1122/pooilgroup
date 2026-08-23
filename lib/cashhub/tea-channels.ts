// CashHub ร้านชาไข่มุก — นิยามช่องทางชำระ (POS Foodstory) + ตรรกะเงินเข้าจริง
// pure (client/server ใช้ได้ — ห้าม import node builtins) เพราะ tea-parse/tea-excel-grid เรียกฝั่ง client.
//
// ต่างจาก Amazon (ผูกกับ c-var ของสูตร TRCloud) — ร้านชาไม่ได้สร้าง IV → ใช้ "ถัง" (bucket) มาตรฐาน
//   จับยอดจากชื่อคอลัมน์ด้วย keyword (กันชื่อคอลัมน์เปลี่ยนข้ามเดือน). 1 ถัง = 1 ช่องทาง reconcile.

export type TeaChannelCode =
  | "cash"
  | "qr"
  | "kplus"
  | "thaichuaithaiplus"
  | "card"
  | "grab"
  | "lineman"
  | "shopee"
  | "wallet"
  | "discount"
  | "other";

export type TeaChannelDef = {
  code: TeaChannelCode;
  label: string;
  /** keyword ในชื่อคอลัมน์ Foodstory (lower-cased contains) → จัดเข้า bucket นี้ */
  match: string[];
  isSettle: boolean; // เป็นเงินเข้าธนาคารจริงไหม
  feePercent: number; // ค่าธรรมเนียมตั้งต้น %
  minSettleBaht: number; // ยอด/วันต่ำกว่านี้ = ยังไม่โอน (รอสะสม)
};

// ลำดับ = ลำดับแสดงในตาราง Excel + สมุดบัญชี
export const TEA_CHANNELS: TeaChannelDef[] = [
  { code: "cash", label: "เงินสด", match: ["ชำระด้วยเงินสด"], isSettle: true, feePercent: 0, minSettleBaht: 0 },
  { code: "qr", label: "QR", match: ["qrpayment", "qrmanual", "qr "], isSettle: true, feePercent: 0, minSettleBaht: 0 },
  // CEO 2026-08-23: เดิม "K Plus" ปนอยู่ในถัง QR (บัญชีปลายทางจริงคนละบัญชีกัน) — แยกถังของตัวเอง
  { code: "kplus", label: "K Plus", match: ["kplus", "k plus"], isSettle: true, feePercent: 0, minSettleBaht: 0 },
  // เดิมไม่มีถังนี้เลย → ตกไป "other" (ไม่ settle เงินหายจากระบบเงียบๆ ฿31,268/74 วัน ก่อนแก้) — เพิ่มถังใหม่
  { code: "thaichuaithaiplus", label: "ไทยช่วยไทยพลัส", match: ["ไทยช่วยไทยพลัส"], isSettle: true, feePercent: 0, minSettleBaht: 0 },
  { code: "card", label: "เครดิต EDC", match: ["edc"], isSettle: true, feePercent: 0.7, minSettleBaht: 0 },
  { code: "grab", label: "Grab", match: ["grab"], isSettle: true, feePercent: 18, minSettleBaht: 0 },
  { code: "lineman", label: "Lineman", match: ["lineman"], isSettle: true, feePercent: 0, minSettleBaht: 0 },
  { code: "shopee", label: "ShopeeFood", match: ["shopee"], isSettle: true, feePercent: 0, minSettleBaht: 0 },
  { code: "wallet", label: "blueplus", match: ["blueplus"], isSettle: true, feePercent: 0, minSettleBaht: 0 },
  // ไม่ใช่เงินเข้าธนาคาร (ส่วนลด/แต้ม/คูปอง) — โชว์ไว้ให้ครบยอดแต่ไม่ส่ง reconcile
  { code: "discount", label: "ส่วนลด/แต้ม", match: ["ส่วนลด", "คูปอง", "redeem"], isSettle: false, feePercent: 0, minSettleBaht: 0 },
  // ช่องทางที่ระบบยังไม่รู้จัก/เงินเชื่อ/comp — กันไป settle ผิด (default ของ classifyTeaPayment)
  { code: "other", label: "อื่น ๆ", match: [], isSettle: false, feePercent: 0, minSettleBaht: 0 },
];

export const TEA_CHANNEL_BY_CODE: Record<string, TeaChannelDef> = Object.fromEntries(
  TEA_CHANNELS.map((c) => [c.code, c]),
);

/**
 * จับ "ประเภทการชำระเงิน" รายบิล (รายงานแยกตามบิล) → channel_code
 * ค่าเช่น Cash / K Plus / Bank Transfer / Grab / Line Man / ShopeeFood / Credit Card / True Money.
 * แยกจาก classifyTeaChannel (ซึ่งจับ "หัวคอลัมน์" ของรายงานปิดสิ้นวัน) เพราะคำศัพท์ต่างกัน.
 */
export function classifyTeaPayment(payment: string): TeaChannelCode {
  const p = payment.trim().toLowerCase();
  if (!p) return "other"; // เซลล์ว่าง (บิล comp/void) → ไม่ใช่เงินเข้าธนาคาร
  if (/grab/.test(p)) return "grab";
  if (/line\s?man/.test(p)) return "lineman";
  if (/shopee(?!pay)/.test(p)) return "shopee";
  if (/voucher|ส่วนลด|คูปอง|redeem|แต้ม/.test(p)) return "discount";
  if (/cash|เงินสด/.test(p)) return "cash";
  if (/edc|credit|debit|บัตร|\bcard\b/.test(p)) return "card";
  if (/blueplus|true\s?money|truemoney|wallet|rabbit|shopeepay|linepay/.test(p)) return "wallet";
  // ต้องเช็คก่อนกฎ qr ทั่วไปด้านล่าง (เดิม K Plus โดนจับรวมเป็น qr — CEO 2026-08-23 ขอแยกถัง
  // เพราะบัญชีปลายทางจริงคนละบัญชีกัน)
  if (/k\s?plus|kplus/.test(p)) return "kplus";
  if (/ไทยช่วยไทยพลัส/.test(p)) return "thaichuaithaiplus";
  // เข้าธนาคารทางอิเล็กทรอนิกส์ → qr (จับเฉพาะที่รู้จัก · ที่เหลือ → other กัน bucket เพี้ยน)
  if (/qr|promptpay|prompt\s?pay|scb|krungthai|ktb|bualuang|kma|bbl|transfer|โอน|ธนาคาร|bank|พร้อมเพย/.test(p))
    return "qr";
  return "other"; // เงินเชื่อ/ไม่รู้จัก → ไม่ settle (เดิม default qr ทำให้ยอด QR เกินจริง)
}

/** จับชื่อคอลัมน์ Foodstory → channel_code (null = ไม่ใช่ช่องทางชำระ / จับไม่ได้) */
export function classifyTeaChannel(header: string): TeaChannelCode | null {
  const h = header.trim().toLowerCase();
  if (!h) return null;
  // discount/แต้ม มาก่อน — กัน "คูปอง blueplus+100 คะแนน" (มี "blueplus") โดนจับเป็น wallet ผิด
  const disc = TEA_CHANNEL_BY_CODE.discount;
  if (disc.match.some((m) => h.includes(m))) return "discount";
  for (const c of TEA_CHANNELS) {
    if (c.code === "discount") continue;
    if (c.match.some((m) => h.includes(m))) return c.code;
  }
  return null;
}

// ── config (เลือกบัญชี/บริษัท/ค่าธรรมเนียม ต่อช่องทาง) ───────────────────
export type TeaChannelConfig = {
  code: TeaChannelCode;
  label: string;
  isSettle: boolean;
  feePercent: number;
  minSettleBaht: number;
  companyId: string | null;
  bankAccountId: string | null;
};

/** config ตั้งต้น (ยังไม่ผูกบริษัท/บัญชี) */
export function defaultTeaChannelConfigs(): TeaChannelConfig[] {
  return TEA_CHANNELS.map((c) => ({
    code: c.code,
    label: c.label,
    isSettle: c.isSettle,
    feePercent: c.feePercent,
    minSettleBaht: c.minSettleBaht,
    companyId: null,
    bankAccountId: null,
  }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type TeaChannelSettlement = {
  code: TeaChannelCode;
  label: string;
  gross: number; // ยอดช่องทาง (จาก POS)
  fee: number; // ค่าธรรมเนียม
  net: number; // เงินเข้าจริง = gross − fee
  settled: boolean; // เข้าธนาคารวันนี้ไหม (is_settle && gross ≥ min)
  pending: boolean; // is_settle แต่ยังไม่ถึงขั้นต่ำ
  companyId: string | null;
  bankAccountId: string | null;
};

/** คำนวณเงินเข้าจริง/ค่าธรรมเนียมต่อช่องทาง สำหรับยอด POS 1 วัน (มิเรอร์ Amazon computeDaySettlement) */
export function computeTeaSettlement(
  channels: Record<string, number> | null,
  configByCode: Map<string, TeaChannelConfig>,
): {
  perChannel: TeaChannelSettlement[];
  totalNet: number;
  totalFee: number;
  totalPending: number;
} {
  const perChannel: TeaChannelSettlement[] = [];
  let totalNet = 0;
  let totalFee = 0;
  let totalPending = 0;
  for (const def of TEA_CHANNELS) {
    const gross = round2(channels?.[def.code] ?? 0);
    if (!gross) continue;
    const cfg = configByCode.get(def.code);
    const isSettle = cfg?.isSettle ?? def.isSettle;
    const feePercent = cfg?.feePercent ?? def.feePercent;
    const minBaht = cfg?.minSettleBaht ?? def.minSettleBaht;
    if (!isSettle) {
      perChannel.push({ code: def.code, label: def.label, gross, fee: 0, net: 0, settled: false, pending: false, companyId: null, bankAccountId: null });
      continue;
    }
    const fee = round2((gross * feePercent) / 100);
    const net = round2(gross - fee);
    const belowMin = gross < minBaht;
    perChannel.push({
      code: def.code,
      label: def.label,
      gross,
      fee,
      net,
      settled: !belowMin,
      pending: belowMin,
      companyId: cfg?.companyId ?? null,
      bankAccountId: cfg?.bankAccountId ?? null,
    });
    if (belowMin) totalPending = round2(totalPending + gross);
    else {
      totalFee = round2(totalFee + fee);
      totalNet = round2(totalNet + net);
    }
  }
  return { perChannel, totalNet, totalFee, totalPending };
}
