// CashHub Café Amazon — ตรรกะค่าธรรมเนียม + เงินเข้าจริงต่อช่องทาง (pure · server/client ใช้ได้)
//
// เงินเข้าจริง = ยอดช่องทาง − ค่าธรรมเนียม(%). ถ้ายอด/วัน < ขั้นต่ำ = ยังไม่โอน (รอสะสม).
// ช่องที่ไม่ใช่เงินจริง (Redeem/ส่วนลด) → is_settle=false → ไม่เข้าธนาคาร.
//
// 2026-08-15 — CEO gave the EXACT real business rule for how the bank posts "QR + Wallet"
// (verified against real 2026-08-01 data: QRPayment=฿65, QRPayment(API)=฿4,505,
// blueplus+wallet=฿70, blueplus+wallet(API)=฿0):
//   Group "qrapi" = QRPayment(API) + blueplus+ wallet (API) → 4,505+0 = ฿4,505 (= the real
//     large bank deposit line, exactly)
//   Group "qrstd" = QRPayment + blueplus+ wallet → 65+70 = ฿135 (= the real small bank
//     deposit line, exactly)
// This replaces an earlier same-day attempt (send 1 ledger row per raw POS label + let a
// generic N:M combo-matcher figure out the grouping) — CEO knows the real grouping, so we
// encode it directly: cheaper (plain 1:1 bank match works for most days), more accurate
// (no guessing), same tie-out safety net (fall back to the old single combined row when
// posBreakdown is missing or doesn't tie out, e.g. TRCloud reclassified money).

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
  // ช่องทางที่ 3 (POS_EXTRACT_GROUPS "qrcredit") — CEO 2026-08-20: ต้องแก้ค่าธรรมเนียมได้จากหน้า
  // ตั้งค่าเหมือนช่องอื่น (เดิม feePercent ของกลุ่มนี้ hardcode ใน POS_EXTRACT_GROUPS ด้านล่าง ไม่มี
  // ที่แก้เลย) — "cvar" ตรงนี้ไม่ใช่ c-number จริง แต่ใช้ key ของ POS_EXTRACT_GROUPS ("qrcredit") เป็น
  // ตัวระบุแทน (ChannelConfig.cvar เป็นแค่ string ไม่บังคับรูปแบบ) ดู computeSendRows ที่ค้นหา config
  // ด้วย key นี้ · ไม่กระทบใบกำกับ TRCloud เลย (createAmazonIv ใช้ channels ดิบ c2/c15 ไม่เกี่ยวกับกลุ่มนี้)
  { cvar: "qrcredit", label: "QRCredit + blueplus Credit (API)", isSettle: true, feePercent: 0.91, minSettleBaht: 0, companyId: null, bankAccountId: null },
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
// CEO 2026-06-15: QR Payment + blueplus wallet โอนรวมเข้าด้วยกัน · blueplus credit แยกเดี่ยว

export type QrPosGroup = {
  key: "qrapi" | "qrstd";
  label: string;
  // raw POS column labels (ดู CHANNEL_CVAR ใน amazon-parse.ts) ที่รวมเข้ากลุ่มนี้
  rawLabels: string[];
};

// CEO 2026-08-15 (verified 2026-08-01 data — ดู comment บนสุดไฟล์): ธนาคารแยกยอด "QR + Wallet"
// เป็น 2 ก้อนตาม API/ไม่ API ไม่ใช่ตาม cvar — qrapi ครอบ QRPayment(API) + blueplus wallet(API)
// (CEO ระบุตรงตัว) · qrstd ครอบ QRPayment + blueplus wallet (CEO ระบุตรงตัว)
//
// ✅ ยืนยันแล้ว CEO 2026-08-19 (คุยเรื่องตารางใหม่ CashHub Amazon): "QR Manual(API)" **ไม่ได้**
// รวมกับ qrapi — เป็นช่องทางแยกเดี่ยวของตัวเอง ไม่ผูกกับ QRPayment(API)/blueplus wallet(API) เลย
// (เดิมเคยเดาแบบ symmetry ไว้ว่าเข้า qrapi — CEO ยืนยันว่าผิด) → ตัดออกจาก rawLabels · c13 (cvar
// ของ QR Manual(API)) เอาออกจาก SETTLEMENT_GROUPS.cvars ด้วย ทำให้ส่งเป็นบรรทัดเดี่ยวของตัวเองแทน
// (เหมือน c12/c20/c21/c22 — ช่องทางเดี่ยวที่ไม่อยู่ในกลุ่มไหนเลย)
//
// ✅ ยืนยันแล้ว CEO 2026-08-19 เช่นกัน: "blueplus+ wallet Manual" (คนละคอลัมน์กับ "blueplus+ wallet"
// เฉยๆ — เดิมระบบไม่รู้จักชื่อนี้เลย) เป็นเงินจริง รวมอยู่ใน qrstd ด้วยกันกับ QRPayment + blueplus+
// wallet (ดู CHANNEL_CVAR ใน amazon-parse.ts — map เข้า c14 เดียวกับ blueplus+ wallet)
//
// ✅ ยืนยันแล้วด้วย DB จริงเทียบ statement ธนาคาร 10 วัน (2026-08-15): QRCredit(API) **ไม่ได้**
// รวมกับ qrapi — มันไปช่องทางที่ 3 แยกต่างหาก (บัญชี "AMZ A_SD4097" คนละเลขบัญชีเลย พร้อมกับ
// blueplus+ credit(API)) → เดิมเคยเดาไว้ผิด (08-05/08-09 ที่ QRCredit(API)≠0 ยอด qrapi เกินยอด
// ธนาคารจริงพอดีเท่ากับ QRCredit(API) เป๊ะทั้ง 2 วัน) → ตัดออกจาก rawLabels · วันที่ QRCredit(API)
// ≠0 จะทำให้ tiesOut=false (breakdownSum ไม่ครบ gross) → fallback ไปส่งรวม 1 บรรทัดแบบเดิมอัตโนมัติ
// (ปลอดภัย — ไม่บังคับแยก 2 กลุ่มทั้งที่จริงมี 3 กระแสเงินซ่อนอยู่)
export const QR_POS_GROUPS: QrPosGroup[] = [
  {
    key: "qrapi",
    label: "QR + Wallet (API)",
    rawLabels: ["QRPayment(API)", "blueplus+ wallet (API)"],
  },
  {
    key: "qrstd",
    label: "QR + Wallet",
    rawLabels: ["QRPayment", "blueplus+ wallet", "blueplus+ wallet Manual"],
  },
];

export const SETTLEMENT_GROUPS: {
  key: string;
  label: string;
  channelCode: string;
  cvars: string[];
  // ถ้ามี: กติกาแยกก้อนย่อยตาม raw POS label (แทนที่จะรวมเป็น 1 ก้อน) เมื่อ posBreakdown
  // ของวันนั้นมี+ตรงยอด (ดู computeSendRows) — ไม่มี = กลุ่มนี้ไม่มีการแยกย่อย ส่งรวมเสมอ
  posGroups?: QrPosGroup[];
}[] = [
  // c13 (QR Manual) ตัดออกจากกลุ่มนี้ 2026-08-19 — CEO ยืนยันว่าส่งเป็นบรรทัดเดี่ยวของตัวเอง ดู
  // comment เหนือ QR_POS_GROUPS
  { key: "qr", label: "QR + Wallet", channelCode: "qr", cvars: ["c2", "c14"], posGroups: QR_POS_GROUPS },
];

// cvar → group key (ช่องที่ไม่อยู่ในกลุ่ม = ส่งเดี่ยว 1 บรรทัด/วัน)
export const CVAR_GROUP: Record<string, string> = Object.fromEntries(
  SETTLEMENT_GROUPS.flatMap((g) => g.cvars.map((cv) => [cv, g.key] as const)),
);

// ─────────────────────────────────────────────────────────────────────────────
// POS_EXTRACT_GROUPS — ดึงเงินเฉพาะ "raw label" (ไม่ใช่ทั้ง cvar) ออกมาเป็นบรรทัดแยกต่างหาก
// ก่อนคำนวณกลุ่ม/ช่องเดี่ยวตามปกติ — ใช้เมื่อเงินก้อนหนึ่ง "ฝัง" อยู่ในเงินก้อนใหญ่ของ cvar เดิม
// แต่จริง ๆ ธนาคารโอนเข้าเป็นอีกก้อนแยกต่างหาก (คนละ fee/คนละจังหวะ) — ต่างจาก QR_POS_GROUPS
// (ซึ่งแค่ "จัดกลุ่มย่อยภายในกลุ่มเดิม") ตรงที่ POS_EXTRACT_GROUPS ดึงออกจาก cvar ต้นทางไปเลย
//
// 2026-08-15 — CEO อนุมัติกลุ่มที่ 3 หลังยืนยันกับ DB จริง (statement KBank 1657 · 12 บรรทัด
// เดือน 07-08/2569 ที่คำอธิบาย "จาก ... AMZ A_SD4097 CHAKKARAT..."): QRCredit(API) (raw label
// ใน cvar c2 ปนอยู่กับ QRPayment/QRPayment(API)) และ blueplus+ credit(API) (raw label ใน cvar
// c15 ปนอยู่กับ "blueplus+ Credit" ที่ไม่ใช่ (API)) ไม่ได้โอนรวมกับ qrapi/qrstd หรือกับ
// "blueplus credit" ช่องเดี่ยวเดิม — แต่โอนเป็นก้อนที่ 3 แยกต่างหาก หักค่าธรรมเนียม ~0.91%
// (วัดจากข้อมูลจริง 3 วัน: 08-03=0.9105% · 08-05=0.9130% · 08-09=0.9130% — ใกล้เคียงสูตร
// ค่าธรรมเนียมของ "เครดิต EDC" (c12, 0.9%) มาก แสดงว่าน่าจะเป็นเรทการ์ดเน็ตเวิร์กเดียวกัน)
//
// ทำไมต้องมีกลไกแยกจาก QR_POS_GROUPS:
//   1. กลุ่มนี้คร่อม 2 cvar ที่อยู่คนละที่ในโครงสร้างเดิม — c2 อยู่ใน SETTLEMENT_GROUPS "qr"
//      ส่วน c15 เป็นช่องเดี่ยวส่งแยกบรรทัดเสมอ (ไม่เคยอยู่ในกลุ่มไหน) — ถ้าเพิ่ม c15 เข้าไปใน
//      cvars ของกลุ่ม "qr" ตรง ๆ จะทำให้ "fallback ก้อนรวม" (เวลา tie-out ไม่ผ่าน) ปนเงิน
//      QRPayment(API) (หลักพัน-หมื่นบาท/วัน) กับเงิน blueplus credit (หลักร้อยบาท/วัน) เข้า
//      ก้อนเดียว ซึ่งไม่ตรงกับยอดธนาคารจริงทั้ง 2 เส้นเลย
//   2. กลุ่มนี้ต้องมีค่าธรรมเนียมเป็นของตัวเอง (~0.9%) ในขณะที่ config ปัจจุบันของ c2/c15 ตั้ง
//      ไว้ที่ 0% — ChannelConfig.feePercent คิดค่าธรรมเนียมระดับ cvar ทั้งก้อน สั่งแยกค่า
//      ธรรมเนียมเฉพาะ raw label เดียวใน cvar เดียวกันไม่ได้ จึงต้องมี feePercent ของตัวเองใน
//      POS_EXTRACT_GROUPS แทน (ไม่ใช้ configByCvar)
// ผลพลอยได้: วันที่ QRCredit(API)≠0 (เช่น 08-05/08-09 ที่ CEO เห็นคอลัมน์ split ว่างเปล่า) —
// เดิม tie-out ของ qrapi/qrstd ล้มเหลวเพราะ QRCredit(API) ทำให้ยอดรวม c2 เกินผลรวม raw label
// ที่ qrapi/qrstd รู้จัก → พอดึง QRCredit(API) ออกก่อนแล้ว ส่วนที่เหลือของ c2 จะ tie-out ได้ปกติ
// อีกครั้ง → qrapi/qrstd จะแยกสำเร็จเองในวันเหล่านั้นด้วย (ไม่ใช่แค่ qrcredit อย่างเดียว)
export type PosExtractMember = { rawLabel: string; cvar: string };
export type PosExtractGroup = {
  key: string; // source_ref suffix (เช่น "qrcredit") — ต้องไม่ชนกับ key อื่นที่มีอยู่
  label: string;
  channelCode: string; // ledger_revenue_entry.channel_code — ต้องอยู่ใน REVENUE_CHANNELS enum
  // ค่าธรรมเนียม default ของกลุ่มนี้ — ตั้งแต่ 2026-08-20 แค่ fallback เฉยๆ ถ้ายังไม่มี config ใน
  // DEFAULT_CHANNELS/DB (ดู cvar:"qrcredit" ด้านบน) · computeSendRows จะเช็ค configByCvar.get(key)
  // ก่อนเสมอ ให้ CEO แก้จากหน้าตั้งค่าได้เหมือนช่องอื่น ไม่ต้องแก้โค้ด
  feePercent: number;
  members: PosExtractMember[];
};

export const POS_EXTRACT_GROUPS: PosExtractGroup[] = [
  {
    key: "qrcredit",
    label: "QRCredit + blueplus Credit (API)",
    // ~0.91% + จ่ายช้ากว่า real-time = พฤติกรรมแบบบัตร ไม่ใช่ QR/wallet real-time — ใช้ bucket
    // เดียวกับ c12 "เครดิต EDC" (ดู CVAR_CHANNEL_CODE) สอดคล้องกับที่มาของค่าธรรมเนียม
    channelCode: "card",
    // วัดจากข้อมูลจริง 3 วัน (08-03/08-05/08-09) = 0.9105–0.9130% เฉลี่ย ~0.912% — ปัดใช้ 0.91
    // ให้ตรงกับ convention ของ c12 ที่ตั้งไว้จริงในระบบ (0.91) · แก้ได้จากหน้าตั้งค่าแล้วตั้งแต่นี้ไป
    feePercent: 0.91,
    members: [
      { rawLabel: "QRCredit(API)", cvar: "c2" },
      { rawLabel: "blueplus+ credit(API)", cvar: "c15" },
      // ⚠️ "blueplus+ Credit" (ไม่มี "(API)") ตั้งใจไม่รวม — ไม่มีข้อมูลจริงยืนยันว่าโอนแบบเดียวกัน
      // (ไฟล์ POS สาขานี้เดือนนี้ไม่มีคอลัมน์ non-API เลย — ดู comment ใน amazon-parse.ts) ยังคง
      // ไหลเข้าบรรทัดเดี่ยว "blueplus credit" (c15) เหมือนเดิมทุกประการ ไม่แตะ
    ],
  },
];

export type SettlementSendRow = {
  key: string; // source_ref suffix — group key (เช่น "qr") · cvar เดี่ยว · posGroup key ("qrapi"/"qrstd")
  // · หรือ POS_EXTRACT_GROUPS key ("qrcredit")
  label: string;
  channelCode: string;
  gross: number;
  fee: number;
  net: number;
  feePercent: number; // ค่าธรรมเนียมรวม % (สำหรับแสดงผล)
  companyId: string | null;
  bankAccountId: string | null;
  memberCvars: string[];
  split?: boolean; // true = แถวนี้คือกลุ่มย่อย (qrapi/qrstd/qrcredit) ของก้อนรวม ไม่ใช่ก้อนรวมทั้งกลุ่ม
};

// ยอมให้ยอด "กลุ่ม" (จาก channels/iv_channels ที่ใช้ครั้งนี้) ต่างจากผลรวม posBreakdown
// ของกลุ่มเดียวกันได้ไม่เกินนี้ก่อนไว้ใจแยกกลุ่มย่อย — ใช้ค่าเดียวกับ sumOk/checkOk ใน
// amazon-parse.ts (0.5 บาท) ให้เป็นมาตรฐานเดียวกันทั้งระบบ
const BREAKDOWN_TIE_OUT_TOLERANCE = 0.5;

/**
 * แปลงยอดขายต่อวัน → "บรรทัดที่จะส่งเข้า reconcile"
 * - -1) wide-domain tie-out (2026-08-17) — ถ้า SETTLEMENT_GROUPS ที่มี posGroups (เช่น "qr")
 *   คร่อม cvar เดียวกับ POS_EXTRACT_GROUPS ตัวไหน (เช่น "qrcredit" ใช้ c2 ร่วมกับ "qr") และ
 *   วันนี้ iv_channels ย้ายเงินของ extract-group cvar ตัวหนึ่ง (เช่น c15) ไปรวมกับ cvar ใน
 *   settlement group เดียวกัน (เช่น c14) จน cvar ต้นทางหายไปจาก settled เลย — ขั้น 0 ปกติด้านล่าง
 *   จะหาไม่เจอว่าจะหักออกจากไหน (เสี่ยงนับซ้ำ ถ้าดึงออกมาเป็นบรรทัดใหม่โดยไม่หักที่เดิม) → เช็ค
 *   ผลรวมกว้างขึ้นแทน: sum(settled ครอบ g.cvars ∪ extract cvars ทั้งหมด) เทียบ sum(raw label
 *   ของทั้ง posGroups + extract group นั้น) ถ้าตรงกันเป๊ะ (แปลว่าเงินยังอยู่ครบ แค่ TRCloud ย้าย
 *   cvar ภายในโดเมนเดียวกัน) → คำนวณทุกบรรทัด (extract + posGroups) จาก posBreakdown ล้วนๆ ตรงๆ
 *   เลย ไม่พึ่ง settled ต่อ cvar อีก (เงินไม่หาย/ไม่ซ้ำ ไม่ว่า TRCloud จะนับเงินไว้ใต้ cvar ไหน)
 *   ถ้าผลรวมกว้างนี้ไม่ตรง (เช่นเงินย้ายออกนอกโดเมนไปเลย อย่างเคส 06-14 ที่ย้ายไป Grab) → ปล่อยผ่าน
 *   ให้ขั้น 0-1 ปกติจัดการ (ซึ่งจะ fallback รวมก้อนอย่างปลอดภัยเหมือนเดิม กันบั๊กเดิม 2026-08-16)
 * - 0) POS_EXTRACT_GROUPS (ตอนนี้มีแค่ "qrcredit") — ถ้ามี posBreakdown + raw label ของกลุ่มนี้
 *   มีเงิน → ดึงออกมาเป็นบรรทัดของตัวเองก่อน (ค่าธรรมเนียมของกลุ่มเอง ไม่ใช่ของ cvar ต้นทาง)
 *   แล้วหักยอดที่ดึงออกไปแล้วออกจาก cvar ต้นทาง ก่อนคำนวณขั้น 1-2 ด้านล่าง — กันคิดซ้ำ
 * - 1) กลุ่มที่มี posGroups (ตอนนี้มีแค่ "qr") + posBreakdown ของวันนั้น "ครบ" (ผลรวม raw label
 *   ทั้งหมดของกลุ่มตรงกับยอดกลุ่มที่ใช้จริงในคอลนี้ — กันกรณี channels เป็น iv_channels ที่
 *   TRCloud จัดหมวดใหม่ไปแล้วจนไม่ตรงกับ POS ดิบอีกต่อไป) → ส่งแยก 2 บรรทัดตาม posGroups
 *   (qrapi/qrstd — ดู QR_POS_GROUPS ด้านบน)
 * - ไม่มี/ไม่ครบ → กลับไปพฤติกรรมเดิมเป๊ะ (ก่อน 2026-08-15 ทั้งหมด): รวมเป็น 1 บรรทัด/กลุ่ม
 * ใช้ร่วมกันทั้งตัวส่งจริง (sendDaysToReconcile) และพรีวิวในหน้าตั้งค่า → เลขตรงกันเสมอ
 */
export function computeSendRows(
  channels: Record<string, number> | null,
  configByCvar: Map<string, ChannelConfig>,
  posBreakdown?: Record<string, number> | null,
): {
  rows: SettlementSendRow[];
  totalNet: number;
  splitGroupKeys: string[];
  // cvar เดี่ยว (ไม่อยู่ใน SETTLEMENT_GROUPS ใด ๆ เช่น "c15") ที่ POS_EXTRACT_GROUPS แตะยอดวันนี้
  // → ref เดี่ยวเดิมของ cvar นั้นอาจค้าง unmatched ถ้ายอดวันนี้หายไปทั้งหมด/เปลี่ยน (ดู legacyRefsForDay)
  extractedStandaloneCvars: string[];
} {
  const { perChannel } = computeDaySettlement(channels, configByCvar);
  let settled = perChannel.filter((s) => s.settled);
  const rows: SettlementSendRow[] = [];
  const splitGroupKeys: string[] = [];
  const extractedStandaloneCvars: string[] = [];
  const wideHandledExtractKeys = new Set<string>();
  const cfgFor = (cv: string) => configByCvar.get(cv) ?? DEFAULT_CHANNELS.find((c) => c.cvar === cv) ?? null;

  // -1) wide-domain tie-out — ดู comment ด้านบนฟังก์ชัน
  if (posBreakdown) {
    for (const g of SETTLEMENT_GROUPS) {
      if (!g.posGroups) continue;
      const relatedExtracts = POS_EXTRACT_GROUPS.filter((eg) =>
        eg.members.some((m) => g.cvars.includes(m.cvar)),
      );
      if (relatedExtracts.length === 0) continue;
      const wideCvars = new Set<string>(g.cvars);
      for (const eg of relatedExtracts) for (const m of eg.members) wideCvars.add(m.cvar);
      // คุ้มเช็คก็ต่อเมื่อมี cvar ของ extract group ที่ตั้งใจ settle ไว้ แต่หายไปจาก settled จริง
      // (เงินถูก iv_channels ย้ายไปรวมที่อื่นในโดเมนเดียวกัน) — ไม่งั้นขั้น 0 ปกติจัดการได้อยู่แล้ว
      const anyExtractCvarMissing = relatedExtracts.some((eg) =>
        eg.members.some((m) => !settled.some((s) => s.cvar === m.cvar) && cfgFor(m.cvar)?.isSettle),
      );
      if (!anyExtractCvarMissing) continue;

      const wideGross = round2(
        [...wideCvars].reduce((a, cv) => a + (settled.find((s) => s.cvar === cv)?.gross ?? 0), 0),
      );
      const wideLabels = [
        ...g.posGroups.flatMap((pg) => pg.rawLabels),
        ...relatedExtracts.flatMap((eg) => eg.members.map((m) => m.rawLabel)),
      ];
      const wideBreakdownSum = round2(wideLabels.reduce((a, label) => a + (posBreakdown[label] ?? 0), 0));
      if (Math.abs(wideBreakdownSum - wideGross) >= BREAKDOWN_TIE_OUT_TOLERANCE) continue; // ไม่ตรงแม้กว้างขึ้น → ปล่อยขั้น 0-1 ปกติ fallback รวมก้อนอย่างปลอดภัย

      // ตรงกัน → คำนวณทุกบรรทัด (extract group(s) + g.posGroups) จาก posBreakdown ล้วนๆ ตรงๆ
      for (const eg of relatedExtracts) {
        const egGross = round2(eg.members.reduce((a, m) => a + (posBreakdown[m.rawLabel] ?? 0), 0));
        if (egGross === 0) continue;
        // ค่าธรรมเนียม/บริษัท/บัญชี — เช็ค config ของกลุ่มนี้เอง (cvar:"qrcredit") ก่อนเสมอ ให้ CEO
        // แก้จากหน้าตั้งค่าได้ (ดู DEFAULT_CHANNELS ด้านบนไฟล์) · ไม่มี config → fallback ค่า default
        const egCfg = cfgFor(eg.key);
        const egFeePercent = egCfg?.feePercent ?? eg.feePercent;
        const egFee = round2((egGross * egFeePercent) / 100);
        const touchedCvars = [...new Set(eg.members.map((m) => m.cvar))];
        const rep =
          settled.find((s) => touchedCvars.includes(s.cvar) && s.companyId) ??
          touchedCvars.map(cfgFor).find((c) => c?.companyId);
        rows.push({
          key: eg.key,
          label: eg.label,
          channelCode: eg.channelCode,
          gross: egGross,
          fee: egFee,
          net: round2(egGross - egFee),
          feePercent: egFeePercent,
          companyId: egCfg?.companyId ?? rep?.companyId ?? null,
          bankAccountId: egCfg?.bankAccountId ?? rep?.bankAccountId ?? null,
          memberCvars: touchedCvars,
          split: true,
        });
        for (const cv of touchedCvars) {
          if (!CVAR_GROUP[cv] && !extractedStandaloneCvars.includes(cv)) extractedStandaloneCvars.push(cv);
        }
        wideHandledExtractKeys.add(eg.key);
      }
      for (const pg of g.posGroups) {
        let pgGross = 0;
        let pgFee = 0;
        const pgCvars = new Set<string>();
        for (const label of pg.rawLabels) {
          const amt = posBreakdown[label];
          if (!amt) continue;
          const cvar = CHANNEL_CVAR[label];
          const feePercent = cfgFor(cvar)?.feePercent ?? 0;
          pgGross = round2(pgGross + amt);
          pgFee = round2(pgFee + round2((amt * feePercent) / 100));
          pgCvars.add(cvar);
        }
        if (pgGross === 0) continue;
        const repCvars = [...pgCvars];
        const rep =
          settled.find((s) => repCvars.includes(s.cvar) && s.companyId) ??
          repCvars.map(cfgFor).find((c) => c?.companyId);
        rows.push({
          key: pg.key,
          label: pg.label,
          channelCode: g.channelCode,
          gross: pgGross,
          fee: pgFee,
          net: round2(pgGross - pgFee),
          feePercent: pgGross > 0 ? round2((pgFee / pgGross) * 100) : 0,
          companyId: rep?.companyId ?? null,
          bankAccountId: rep?.bankAccountId ?? null,
          memberCvars: repCvars,
          split: true,
        });
      }
      splitGroupKeys.push(g.key);
      // เอา cvar ทั้งโดเมนออกจาก settled ทั้งหมด (ถูกจัดการครบแล้วด้านบน กันขั้น 0-1 ด้านล่างมาซ้ำ)
      settled = settled.filter((s) => !wideCvars.has(s.cvar));
    }
  }

  // 0) POS_EXTRACT_GROUPS — ดึง raw label ที่รู้แล้วว่าโอนเป็นก้อนแยกออกจาก cvar ต้นทางก่อน
  //    (ดู comment เหนือ POS_EXTRACT_GROUPS ด้านบนไฟล์) — ต้อง "มี posBreakdown" เท่านั้น (เดือน
  //    เก่าไม่มี posBreakdown เลย → ปล่อยเงินอยู่ใน cvar เดิมเหมือนก่อน 2026-08-15 ทั้งหมด ปลอดภัย
  //    เพราะแยกไม่ได้จริง ๆ ว่า raw label ไหนอยู่ไหน)
  if (posBreakdown) {
    // safety gate (2026-08-17): ก่อนหักเงินออกจาก cvar ต้นทาง เช็คก่อนว่า cvar นั้นมีเงินตาม
    // settled "น้อยกว่า" ที่ posBreakdown บอกไว้รวมทุก raw label ที่แม็พมา cvar นี้ไหม — ถ้าน้อยกว่า
    // แปลว่า TRCloud (iv_channels) ย้ายเงินบางส่วนออกจาก cvar นี้ไปที่อื่นแล้ว (เช่นเคส 06-14 ที่
    // ย้าย QRCredit(API) ไป Grab c20) → posBreakdown ใช้เชื่อไม่ได้กับ cvar นี้อีกต่อไป ข้ามการหัก
    // กันคิดซ้ำ (ถ้าเท่ากันหรือมากกว่า — เช่น cvar มีเงินอื่นเพิ่มที่ posBreakdown ไม่ครอบ — หักได้ปกติ)
    const cvarShortOfBreakdown = (cv: string): boolean => {
      const expected = round2(
        Object.entries(CHANNEL_CVAR)
          .filter(([, mappedCvar]) => mappedCvar === cv)
          .reduce((a, [label]) => a + (posBreakdown[label] ?? 0), 0),
      );
      const actual = settled.find((s) => s.cvar === cv)?.gross ?? 0;
      return actual < expected - BREAKDOWN_TIE_OUT_TOLERANCE;
    };
    for (const eg of POS_EXTRACT_GROUPS) {
      if (wideHandledExtractKeys.has(eg.key)) continue; // จัดการไปแล้วในขั้น -1) wide-domain ด้านบน
      const present: { cvar: string; amt: number }[] = [];
      for (const m of eg.members) {
        const amt = posBreakdown[m.rawLabel];
        if (!amt) continue;
        if (!settled.some((s) => s.cvar === m.cvar)) continue; // cvar นี้ settle=false ตาม config → ข้าม
        if (cvarShortOfBreakdown(m.cvar)) continue; // เงินย้ายออกนอกโดเมนไปแล้ว → ไม่หัก กันคิดซ้ำ
        present.push({ cvar: m.cvar, amt: round2(amt) });
      }
      if (present.length === 0) continue; // วันนี้ไม่มีเงินกลุ่มนี้เลย → ไม่ต้องดึงอะไร
      const egGross = round2(present.reduce((a, p) => a + p.amt, 0));
      // ค่าธรรมเนียม/บริษัท/บัญชี — เช็ค config ของกลุ่มนี้เอง (cvar:"qrcredit") ก่อนเสมอ (เหมือน
      // block wide-domain ด้านบน) ให้ CEO แก้จากหน้าตั้งค่าได้ ไม่ต้องแก้โค้ด
      const egCfg = cfgFor(eg.key);
      const egFeePercent = egCfg?.feePercent ?? eg.feePercent;
      const egFee = round2((egGross * egFeePercent) / 100);
      const egNet = round2(egGross - egFee);
      const touchedCvars = [...new Set(present.map((p) => p.cvar))];
      const rep =
        settled.find((s) => touchedCvars.includes(s.cvar) && s.companyId) ??
        settled.find((s) => touchedCvars.includes(s.cvar));
      if (!rep) continue; // ไม่ควรเกิด (เช็ค settled.some ไปแล้วข้างบน) — กันพังเฉย ๆ
      rows.push({
        key: eg.key,
        label: eg.label,
        channelCode: eg.channelCode,
        gross: egGross,
        fee: egFee,
        net: egNet,
        feePercent: egFeePercent,
        companyId: egCfg?.companyId ?? rep.companyId,
        bankAccountId: egCfg?.bankAccountId ?? rep.bankAccountId,
        memberCvars: touchedCvars,
        split: true,
      });
      // หมายเหตุ: "qrcredit" (key ของกลุ่มนี้) ไม่ต้องใส่ splitGroupKeys — ไม่เคยมี ref รูปแบบนี้
      // มาก่อนเลย (เป็นบรรทัดใหม่ล้วน ๆ) ต่างจาก "qr" ที่มี ref ก้อนรวมเดิมอยู่ก่อนแล้วต้องลบทิ้ง
      // (เหมือนกับที่ qrapi/qrstd เองก็ไม่ถูกใส่ splitGroupKeys ด้วยเหตุผลเดียวกัน — ดู (d) ใน test)
      settled = settled
        .map((s) => {
          const p = present.find((x) => x.cvar === s.cvar);
          if (!p) return s;
          const newGross = round2(s.gross - p.amt);
          const cfg = configByCvar.get(s.cvar) ?? DEFAULT_CHANNELS.find((c) => c.cvar === s.cvar);
          const feePercent = cfg?.feePercent ?? 0;
          const newFee = round2((newGross * feePercent) / 100);
          return { ...s, gross: newGross, fee: newFee, net: round2(newGross - newFee) };
        })
        .filter((s) => s.gross > 0.004); // ดึงออกหมดพอดี (เหลือ ~0) → ตัดทิ้ง ไม่ส่งบรรทัด 0 บาท
      // cvar เดี่ยวที่ถูกแตะ (ไม่อยู่ใน SETTLEMENT_GROUPS ใด ๆ) → จำไว้เผื่อ ref เดี่ยวเดิมค้าง
      // (cvar ที่อยู่ในกลุ่มอยู่แล้ว เช่น c2 ถูก legacyRefsForDay ลบทุกวันอยู่แล้วจาก g.cvars loop)
      for (const cv of touchedCvars) {
        if (!CVAR_GROUP[cv] && !extractedStandaloneCvars.includes(cv)) extractedStandaloneCvars.push(cv);
      }
    }
  }

  // 1) ช่องที่โอนรวมเข้าบัญชีก้อนเดียว (ปกติ) — หรือแยก 2 กลุ่มย่อยตามกฎ CEO (posGroups)
  for (const g of SETTLEMENT_GROUPS) {
    const members = settled.filter((s) => g.cvars.includes(s.cvar));
    if (members.length === 0) continue;
    const gross = round2(members.reduce((a, m) => a + m.gross, 0));

    let tiesOut = false;
    const splitRows: SettlementSendRow[] = [];
    if (g.posGroups && posBreakdown) {
      // raw label ทั้งหมดที่ประกาศไว้ใน posGroups ของกลุ่มนี้ (ครอบ cvar เดียวกับ g.cvars พอดี)
      const allRawLabels = g.posGroups.flatMap((pg) => pg.rawLabels);
      const present = allRawLabels
        .map((label) => [label, posBreakdown[label] ?? 0] as const)
        .filter(([, amt]) => amt !== 0);
      const breakdownSum = round2(present.reduce((a, [, amt]) => a + amt, 0));
      tiesOut = present.length > 0 && Math.abs(breakdownSum - gross) < BREAKDOWN_TIE_OUT_TOLERANCE;

      if (tiesOut) {
        for (const pg of g.posGroups) {
          let pgGross = 0;
          let pgFee = 0;
          const pgCvars = new Set<string>();
          for (const label of pg.rawLabels) {
            const amt = posBreakdown[label];
            if (!amt) continue;
            const cvar = CHANNEL_CVAR[label];
            const member = members.find((m) => m.cvar === cvar);
            if (!member) continue; // cvar นี้ settle=false ตาม config → ข้ามเหมือนพฤติกรรมเดิม
            const feePercent = configByCvar.get(cvar)?.feePercent ?? 0;
            pgGross = round2(pgGross + amt);
            pgFee = round2(pgFee + round2((amt * feePercent) / 100));
            pgCvars.add(cvar);
          }
          if (pgGross === 0) continue; // ไม่มีเงินกลุ่มย่อยนี้วันนี้ (เช่น wallet(API)=0) → ไม่ส่งบรรทัด 0 บาท
          const repCvars = [...pgCvars];
          const rep = members.find((m) => repCvars.includes(m.cvar) && m.companyId)
            ?? members.find((m) => repCvars.includes(m.cvar));
          if (!rep) continue;
          const pgNet = round2(pgGross - pgFee);
          splitRows.push({
            key: pg.key,
            label: pg.label,
            channelCode: g.channelCode,
            gross: pgGross,
            fee: pgFee,
            net: pgNet,
            feePercent: pgGross > 0 ? round2((pgFee / pgGross) * 100) : 0,
            companyId: rep.companyId,
            bankAccountId: rep.bankAccountId,
            memberCvars: repCvars,
            split: true,
          });
        }
      }
    }

    if (tiesOut && splitRows.length > 0) {
      rows.push(...splitRows);
      splitGroupKeys.push(g.key);
    } else {
      // เดิมเป๊ะ (ก่อน 2026-08-15 ทั้งหมด): รวมเป็น 1 บรรทัด/กลุ่ม
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
  return { rows, totalNet, splitGroupKeys, extractedStandaloneCvars };
}

/**
 * เลือกว่า computeSendRows ควรใช้ channels ชุดไหนสำหรับวันนั้น (sendDaysToReconcile เรียกก่อน
 * ทุกครั้ง): iv_channels (ใบกำกับภาษียืนยันแล้ว) ถ้ามี ไม่งั้น channels ดิบจาก POS.
 *
 * bug 2026-08-16: sendDaysToReconcile เคยส่ง posBreakdown (ของ POS ดิบ) เข้าคู่กับ channels=
 * iv_channels เสมอไม่สนว่ามาจากไหน — วันไหนใบกำกับภาษีจัดหมวดต่างจาก POS ไปแล้ว (เช่น ย้ายเงิน
 * "QRCredit(API)" 80 บาทไปฝากไว้ใต้ช่อง Grab แทน) POS_EXTRACT_GROUPS จะหักเงินก้อนเดียวกันออกจาก
 * iv_channels ซ้ำอีกรอบ → ยอด QR หายไป 80 บาทซ้อน (store 4097 06-14: ฿6,939 แทนที่จะเป็น ฿7,019
 * จริง — ดู post-mortem 2026-08-16). ตอนนั้นแก้ด้วยการตัด posBreakdown ทิ้งทุกครั้งที่ใช้
 * iv_channels (ปลอดภัยแต่หยาบ — ทำให้วันไหน TRCloud ย้าย cvar ภายในโดเมนเดียวกันเอง เช่น
 * "blueplus+ credit(API)" (c15) ไปรวมกับ "blueplus wallet" (c14) ก็เลิกแยกไปด้วยทั้งที่ไม่จำเป็น).
 *
 * 2026-08-17: ย้าย safety check เข้าไปอยู่ใน computeSendRows เองแทน (wide-domain tie-out ขั้น -1)
 * + per-cvar guard ในขั้น 0) — ปลอดภัยละเอียดกว่าเดิม แยกแยะได้ว่าเงินย้าย "ในโดเมนเดียวกัน"
 * (กู้คืนการแยกได้ปลอดภัย) กับ "ย้ายออกนอกโดเมนไปเลย" (fallback รวมก้อนเหมือน 06-14) จึงไม่ต้อง
 * ตัด posBreakdown ทิ้งแบบเหมาที่นี่อีกแล้ว — ส่งผ่านเสมอ ให้ computeSendRows ตัดสินใจเอง
 */
export function resolveSendChannels(day: {
  channels: Record<string, number> | null;
  iv_channels?: Record<string, number> | null;
  posBreakdown?: Record<string, number> | null;
}): {
  channels: Record<string, number> | null;
  posBreakdown: Record<string, number> | null | undefined;
  usingIvChannels: boolean;
} {
  const usingIvChannels = !!(day.iv_channels && Object.keys(day.iv_channels).length > 0);
  return {
    channels: usingIvChannels ? day.iv_channels! : day.channels,
    posBreakdown: day.posBreakdown,
    usingIvChannels,
  };
}

/** สร้างรายการ source_ref เก่าที่ต้องพิจารณาลบ (legacy-shape cleanup) สำหรับ 1 วัน:
 *  - ref แบบ "แยก cvar ก่อนมีการรวมกลุ่ม" (ก่อน 2026-06) — เดิมอยู่แล้ว ลบทุกครั้งที่ส่งวันนั้น
 *  - ref แบบ "รวมกลุ่มก้อนเดียว" (เช่น "...-qr") — ลบเฉพาะกลุ่มที่วันนี้เปลี่ยนไปส่งแบบแยก
 *    กลุ่มย่อยแทน (splitGroupKeys) กันไม่ให้ก้อนรวมเก่าค้าง unmatched ซ้อนกับบรรทัดใหม่
 *  - ref แบบ "ช่องเดี่ยวเดิม" ที่ POS_EXTRACT_GROUPS ดึงเงินออกไปวันนี้ (extractedStandaloneCvars
 *    เช่น "c15") — ต่างจาก g.cvars loop ด้านล่างตรงที่ cvar เหล่านี้ไม่เคยอยู่ใน SETTLEMENT_GROUPS
 *    เลย (ไม่ถูก loop ด้านล่างครอบคลุม) กันยอดเต็มเดิม (ก่อนดึง qrcredit ออก) ค้าง unmatched
 *  ตัวลบจริง (SQL) อยู่ที่ sendDaysToReconcile — ฟังก์ชันนี้คืนแค่ "รายชื่อ ref ที่ควรพิจารณา"
 *  การป้องกันแถว matched/confirmed อยู่ที่ WHERE match_state='unmatched' ในฝั่ง SQL (ไม่แตะที่นี่)
 *
 *  หมายเหตุ: commit 6a46089b (2026-08-15 ก่อนหน้า commit นี้) เคยส่งแบบ per-raw-label ("qr-c2-
 *  qrpayment-api" ฯลฯ) ช่วงสั้นๆ — แต่ commit นั้นไม่เคย push/deploy จริง (verified) จึงไม่มี
 *  ledger_revenue_entry รูปแบบนั้นค้างอยู่ใน DB ไหนเลย → ไม่ต้องเพิ่ม cleanup รูปแบบนั้นที่นี่
 */
export function legacyRefsForDay(
  storeCode: string,
  salesDate: string,
  splitGroupKeys: string[],
  extractedStandaloneCvars: string[] = [],
): string[] {
  const refs: string[] = [];
  for (const g of SETTLEMENT_GROUPS) {
    for (const cv of g.cvars) refs.push(`amz-${storeCode}-${salesDate}-${cv}`);
  }
  for (const gKey of splitGroupKeys) refs.push(`amz-${storeCode}-${salesDate}-${gKey}`);
  for (const cv of extractedStandaloneCvars) refs.push(`amz-${storeCode}-${salesDate}-${cv}`);
  return refs;
}
