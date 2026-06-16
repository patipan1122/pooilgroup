// CashHub ⛽ ปั๊มน้ำมัน — นิยามช่องทาง "เงินเข้าจริง" + config (ช่องทาง → บัญชี)
// pure (client/server ใช้ได้ — ห้าม import node builtins) mirror tea-channels.ts.
//
// CEO 2026-06-16 — ปั๊ม 62 ส่งเข้ากระทบยอดแบบ "ยึดคอลัมน์ในชีต" (ไม่ใช่ cash/qr/card กว้าง ๆ):
//   1) เงินสดนำฝาก  = คอลัมน์ "ยอดเงินเข้าบัญชี" (เข้าบช)            → 1 ยอด/วัน
//   2) QR + บัตร K+ = "ยอดเข้าบัญชี K+" + "ยอดรวมบัตรเครดิต" รวมกัน  → 1 ยอด/วัน
//   3) บัตรเครดิต   = "ยอดเข้าบัตรเครดิต"                            → 1 ยอด/วัน
//   4) คุณแอ้ม      = "คุณแอ้ม" (เงินคุณแอ้มนำฝาก)                   → 1 ยอด/วัน
// ทุกช่อง default → TTB …3134 (เลือกบัญชีต่อช่องได้ในหน้าตั้งค่า). ไม่หักค่าธรรมเนียม
// (ยอดในคอลัมน์เหล่านี้คือ "เงินเข้าบัญชีจริง" อยู่แล้ว).

export type FuelChannelCode = "cash" | "qr_kplus" | "card" | "aem";

// แต่ละช่อง = ผลรวมของคอลัมน์ในชีต (จับด้วยชื่อหัวตาราง กันผังเลื่อน).
// group: "" = คอลัมน์ที่ไม่อยู่ใต้กลุ่มธนาคาร · substring = ต้องอยู่ในกลุ่มธนาคารนั้น · undefined = กลุ่มไหนก็ได้
export type FuelSourceCol = { group?: string; nameIncludes: string; nameExcludes?: string[] };

export type FuelChannelDef = {
  code: FuelChannelCode;
  label: string;
  sourceHint: string; // อธิบายคนทั่วไปว่าช่องนี้มาจากคอลัมน์ไหน (โชว์ในหน้าตั้งค่า + พรีวิว)
  sourceCols: FuelSourceCol[];
  isSettle: boolean; // เป็นเงินเข้าธนาคารจริงไหม
  feePercent: number;
  minSettleBaht: number;
};

// ลำดับ = ลำดับแสดงในตาราง
export const FUEL_CHANNELS: FuelChannelDef[] = [
  {
    code: "cash",
    label: "เงินสดนำฝาก",
    sourceHint: "คอลัมน์ “ยอดเงินเข้าบัญชี” (เงินสดที่นำฝาก)",
    sourceCols: [{ group: "", nameIncludes: "ยอดเงินเข้า" }],
    isSettle: true,
    feePercent: 0,
    minSettleBaht: 0,
  },
  {
    code: "qr_kplus",
    label: "QR + บัตร (K+)",
    sourceHint: "“ยอดเข้าบัญชี K+” + “ยอดรวมบัตรเครดิต” (รวมเป็น 1 ยอด)",
    sourceCols: [
      { group: "กสิกร", nameIncludes: "ยอดเข้าบัญชี", nameExcludes: ["บัตร"] },
      { group: "กสิกร", nameIncludes: "ยอดรวมบัตรเครดิต" },
    ],
    isSettle: true,
    feePercent: 0,
    minSettleBaht: 0,
  },
  {
    code: "card",
    label: "บัตรเครดิต",
    sourceHint: "คอลัมน์ “ยอดเข้าบัตรเครดิต”",
    sourceCols: [{ group: "ทหารไทย", nameIncludes: "ยอดเข้าบัตรเครดิต" }],
    isSettle: true,
    feePercent: 0,
    minSettleBaht: 0,
  },
  {
    code: "aem",
    label: "คุณแอ้ม",
    sourceHint: "คอลัมน์ “คุณแอ้ม” (เงินคุณแอ้มนำฝาก)",
    sourceCols: [{ nameIncludes: "คุณแอ้ม" }],
    isSettle: true,
    feePercent: 0,
    minSettleBaht: 0,
  },
];

// ช่องทาง → channel_code มาตรฐานของ bank-recon (ใช้ตอนส่ง book entry)
export const FUEL_CHANNEL_CODE: Record<FuelChannelCode, string> = {
  cash: "cash",
  qr_kplus: "qr",
  card: "card",
  aem: "transfer",
};

export type FuelChannelConfig = {
  code: FuelChannelCode;
  label: string;
  isSettle: boolean;
  feePercent: number;
  minSettleBaht: number;
  companyId: string | null;
  bankAccountId: string | null;
};

/** config ตั้งต้น (ยังไม่ผูกบริษัท/บัญชี) */
export function defaultFuelChannelConfigs(): FuelChannelConfig[] {
  return FUEL_CHANNELS.map((c) => ({
    code: c.code,
    label: c.label,
    isSettle: c.isSettle,
    feePercent: c.feePercent,
    minSettleBaht: c.minSettleBaht,
    companyId: null,
    bankAccountId: null,
  }));
}
