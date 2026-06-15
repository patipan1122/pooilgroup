// CashHub ⛽ ปั๊มน้ำมัน — นิยามช่องทางชำระ + config (ช่องทาง → บัญชี)
// pure (client/server ใช้ได้ — ห้าม import node builtins) mirror tea-channels.ts.
// ช่องทางปั๊ม: เงินสด · QR/เงินโอน · บัตร (จาก cashhub_fuel_daily: cash_submitted / transfer_total / card_total)

export type FuelChannelCode = "cash" | "qr" | "card";

export type FuelChannelDef = {
  code: FuelChannelCode;
  label: string;
  isSettle: boolean; // เป็นเงินเข้าธนาคารจริงไหม
  feePercent: number;
  minSettleBaht: number;
};

// ลำดับ = ลำดับแสดงในตาราง
export const FUEL_CHANNELS: FuelChannelDef[] = [
  { code: "cash", label: "เงินสด", isSettle: true, feePercent: 0, minSettleBaht: 0 },
  { code: "qr", label: "QR / เงินโอน", isSettle: true, feePercent: 0, minSettleBaht: 0 },
  { code: "card", label: "บัตร (EDC)", isSettle: true, feePercent: 0, minSettleBaht: 0 },
];

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
