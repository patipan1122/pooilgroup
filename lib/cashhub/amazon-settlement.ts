// CashHub Café Amazon — ตรรกะค่าธรรมเนียม + เงินเข้าจริงต่อช่องทาง (pure · server/client ใช้ได้)
//
// เงินเข้าจริง = ยอดช่องทาง − ค่าธรรมเนียม(%). ถ้ายอด/วัน < ขั้นต่ำ = ยังไม่โอน (รอสะสม).
// ช่องที่ไม่ใช่เงินจริง (Redeem/ส่วนลด) → is_settle=false → ไม่เข้าธนาคาร.

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
  { cvar: "c12", label: "เครดิต EDC", isSettle: true, feePercent: 0.7, minSettleBaht: 0, companyId: null, bankAccountId: null },
  // Grab/LineMan/Shopee หักค่าธรรมเนียม ~18% แล้วโอนยอดสุทธิเข้าวันละครั้ง (CEO 2026-06-14)
  { cvar: "c20", label: "Grab", isSettle: true, feePercent: 18, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c21", label: "Lineman", isSettle: true, feePercent: 18, minSettleBaht: 0, companyId: null, bankAccountId: null },
  { cvar: "c22", label: "ShopeeFood", isSettle: true, feePercent: 18, minSettleBaht: 0, companyId: null, bankAccountId: null },
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
