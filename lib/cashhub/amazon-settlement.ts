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
  key: string; // source_ref suffix (group key หรือ cvar)
  label: string;
  channelCode: string;
  gross: number;
  fee: number;
  net: number;
  feePercent: number; // ค่าธรรมเนียมรวม % (สำหรับแสดงผล)
  companyId: string | null;
  bankAccountId: string | null;
  memberCvars: string[];
};

/**
 * แปลงยอดขายต่อวัน → "บรรทัดที่จะส่งเข้า reconcile" (หลังรวมช่องที่โอนก้อนเดียว)
 * ใช้ร่วมกันทั้งตัวส่งจริง (sendDaysToReconcile) และพรีวิวในหน้าตั้งค่า → เลขตรงกันเสมอ
 */
export function computeSendRows(
  channels: Record<string, number> | null,
  configByCvar: Map<string, ChannelConfig>,
): { rows: SettlementSendRow[]; totalNet: number } {
  const { perChannel } = computeDaySettlement(channels, configByCvar);
  const settled = perChannel.filter((s) => s.settled);
  const rows: SettlementSendRow[] = [];

  // 1) ช่องที่โอนรวมเข้าบัญชีก้อนเดียว → รวมเป็น 1 บรรทัด/กลุ่ม
  for (const g of SETTLEMENT_GROUPS) {
    const members = settled.filter((s) => g.cvars.includes(s.cvar));
    if (members.length === 0) continue;
    const gross = round2(members.reduce((a, m) => a + m.gross, 0));
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

  // 2) ช่องเดี่ยว (ไม่อยู่ในกลุ่ม) → 1 บรรทัด/ช่อง
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
  return { rows, totalNet };
}
