/**
 * ClawFleet v2 — Mock data adapter
 *
 * Ported verbatim from `~/ตู้คีบ/src/data.jsx` to TypeScript.
 *
 * STATUS: Mock data for the redesign showcase.
 *
 * TODO[v2-wire-db]: replace each export with a prisma query against the real
 * CfMachine / CfCollectionSession / CfStockMovement models. See
 * `lib/clawfleet/queries.ts` for the existing helpers we'll wrap.
 */

import type { BranchTone } from "@/components/clawfleet/v2/chrome";

export type { BranchTone };

export type Branch = {
  id: string;
  name: string;
  code: string;
  area: string;
  machines: number;
  manager: string;
  avatar: string;
  tone: BranchTone;
};

export type Sku = {
  code: string;
  name: string;
  cost: number;
  retail: number;
};

export type Machine = {
  code: string;
  name: string;
  meterBefore: number;
  meterAfter: number;
  coinRate: number;
  prizeBefore: number;
  prizeAfter: number;
  refilled: number;
  skuMix: string;
  cashIn: number;
  prizeMeterPrev: number;
  prizeMeterNow: number;
  photos: number;
  flag: boolean;
  note?: string;
};

export type AnomalySeverity = "P0" | "P1" | "P2";
export type AnomalyType = "cash_short" | "prize_short";

export type Anomaly = {
  id: string;
  branchId: string;
  severity: AnomalySeverity;
  type: AnomalyType;
  typeLabel: string;
  reason: string;
  expectedCash: number;
  actualCash: number;
  gap: number;
  gapPct: number;
  prizeExpected: number;
  prizeActual: number;
  prizeGap: number;
  sessionStart: string;
  sessionEnd: string;
  duration: string;
  timeAgo: string;
  timestamp: string;
  staff: string;
  staffAvatar: string;
  machines: Machine[];
};

export type ActiveSession = {
  id: string;
  branchId: string;
  machines: number;
  done: number;
  staff: string;
  staffAvatar: string;
  elapsed: string;
  startedAt: string;
  stale: boolean;
};

export type ClosedSession = {
  id: string;
  branchId: string;
  revenue: number;
  machines: number;
  prizeOut: number;
  staff: string;
  staffAvatar: string;
  closedAt: string;
};

export type StockEntry = {
  sku: string;
  name: string;
  warehouse: number;
  inMachines: number;
  lastDelivery: string;
  velocity: number;
  cost: number;
};

export type DeliveryStatus = "in_transit" | "scheduled";

export type Delivery = {
  id: string;
  branchId: string;
  items: number;
  units: number;
  eta: string;
  status: DeliveryStatus;
  from: string;
};

export type TodaySummary = {
  revenue: number;
  yesterdayRevenue: number;
  sessions: number;
  sessionsExpected: number;
  anomaliesOpen: number;
  stockAlerts: number;
  staffActive: number;
  staffTotal: number;
  prizesOut: number;
};

export type TrendDay = {
  day: string;
  date: string;
  revenue: number;
  anomaly: number;
  today?: boolean;
};

export type BranchPerfStatus = "attention" | "ok";

export type BranchPerf = {
  id: string;
  revenue: number;
  change: number;
  sessions: number;
  anomaly: number;
  prizeOut: number;
  status: BranchPerfStatus;
};

export type InsightStatus = "ok" | "review";

export type InsightRow = {
  time: string;
  id: string;
  branchId: string;
  staff: string;
  expectedCash: number;
  actualCash: number;
  prizeOut: number;
  status: InsightStatus;
  severity?: AnomalySeverity;
};

/* ============================================================ */
/* DATA                                                          */
/* ============================================================ */

// TODO[v2-wire-db]: replace with `prisma.branch.findMany({ where: { businessType: 'claw_machine' } })`
export const BRANCHES: Branch[] = [
  { id: "PTT-CKR", name: "ปตท. จักราช", code: "PTT-001", area: "นครราชสีมา", machines: 6, manager: "น้องเอ", avatar: "อ", tone: "indigo" },
  { id: "PTT-PKC", name: "ปตท. ปักธงชัย", code: "PTT-002", area: "นครราชสีมา", machines: 6, manager: "น้องบี", avatar: "บ", tone: "cyan" },
  { id: "PTT-SKR", name: "ปตท. สีคิ้ว", code: "PTT-003", area: "นครราชสีมา", machines: 5, manager: "น้องซี", avatar: "ซ", tone: "emerald" },
  { id: "PTT-DMV", name: "ปตท. ด่านขุนทด", code: "PTT-004", area: "นครราชสีมา", machines: 6, manager: "น้องดี", avatar: "ด", tone: "amber" },
  { id: "CTP-PKL", name: "เซ็นทรัล ปิ่นเกล้า", code: "BR-005", area: "กรุงเทพฯ", machines: 8, manager: "พี่หนึ่ง", avatar: "น", tone: "violet" },
  { id: "BYI-MKT", name: "ตลาดบางใหญ่", code: "BR-006", area: "นนทบุรี", machines: 14, manager: "พี่สอง", avatar: "ส", tone: "rose" },
  { id: "KKM-MAL", name: "ขอนแก่น มอลล์", code: "BR-007", area: "ขอนแก่น", machines: 7, manager: "พี่สาม", avatar: "ม", tone: "sky" },
  { id: "PTT-NMP", name: "ปตท. โนนสูง", code: "PTT-005", area: "นครราชสีมา", machines: 5, manager: "น้องอี", avatar: "อ", tone: "lime" },
  { id: "CRP-PKR", name: "CR. พิษณุโลก", code: "BR-008", area: "พิษณุโลก", machines: 6, manager: "พี่โอ", avatar: "โ", tone: "fuchsia" },
  { id: "PTT-CYM", name: "ปตท. เฉลิมพระเกียรติ", code: "PTT-006", area: "นครราชสีมา", machines: 6, manager: "น้องเอฟ", avatar: "ฟ", tone: "teal" },
];

// TODO[v2-wire-db]: replace with `prisma.cfProduct.findMany()`
export const SKUS: Sku[] = [
  { code: "SKU-001", name: "หมีน้ำตาล M", cost: 35, retail: 60 },
  { code: "SKU-002", name: "หมีขาว L", cost: 48, retail: 80 },
  { code: "SKU-003", name: "แมวขาว S", cost: 22, retail: 40 },
  { code: "SKU-004", name: "แมวดำ M", cost: 32, retail: 55 },
  { code: "SKU-005", name: "กระต่าย M", cost: 30, retail: 50 },
  { code: "SKU-006", name: "หมาชิวาวา", cost: 38, retail: 65 },
  { code: "SKU-007", name: "เพนกวิน S", cost: 25, retail: 45 },
  { code: "SKU-008", name: "ยูนิคอร์น L", cost: 55, retail: 90 },
  { code: "SKU-009", name: "เป็ดเหลือง", cost: 18, retail: 35 },
  { code: "SKU-010", name: "ปลาทอง M", cost: 28, retail: 48 },
];

type MachineOpts = Partial<Omit<Machine, "code" | "name">>;

function mkMachine(code: string, name: string, opts: MachineOpts = {}): Machine {
  const prizeBefore = opts.prizeBefore ?? 24;
  const prizeAfter = opts.prizeAfter ?? 18;
  return {
    code,
    name,
    meterBefore: opts.meterBefore ?? 12000,
    meterAfter: opts.meterAfter ?? 12080,
    coinRate: opts.coinRate ?? 10,
    prizeBefore,
    prizeAfter,
    refilled: opts.refilled ?? 0,
    skuMix: opts.skuMix ?? "SKU-001",
    cashIn: opts.cashIn ?? 0,
    prizeMeterPrev: opts.prizeMeterPrev ?? 1200,
    prizeMeterNow: opts.prizeMeterNow ?? 1200 + (prizeBefore - prizeAfter),
    photos: opts.photos ?? 5,
    flag: opts.flag ?? false,
    note: opts.note,
  };
}

// TODO[v2-wire-db]: replace with `listAnomalies()` from `lib/clawfleet/queries.ts`
const BASE_ANOMALY_MACHINES: Machine[] = [
  mkMachine("PTT-CKR-01", "ตู้ 01 · ทางเข้า", { meterBefore: 14600, meterAfter: 14708, prizeBefore: 24, prizeAfter: 16, refilled: 0, cashIn: 1080, photos: 5, prizeMeterPrev: 980, prizeMeterNow: 988 }),
  mkMachine("PTT-CKR-02", "ตู้ 02 · ข้างกาแฟ", { meterBefore: 12320, meterAfter: 12450, prizeBefore: 28, prizeAfter: 17, refilled: 0, cashIn: 1300, photos: 5, prizeMeterPrev: 1140, prizeMeterNow: 1151 }),
  mkMachine("PTT-CKR-03", "ตู้ 03 · มุมห้องน้ำ", { meterBefore: 9870, meterAfter: 9993, prizeBefore: 26, prizeAfter: 19, refilled: 0, cashIn: 1230, photos: 5, prizeMeterPrev: 720, prizeMeterNow: 727 }),
  mkMachine("PTT-CKR-04", "ตู้ 04 · ทางออก", {
    meterBefore: 11210,
    meterAfter: 11285,
    prizeBefore: 20,
    prizeAfter: 16,
    refilled: 0,
    cashIn: 750,
    photos: 4,
    prizeMeterPrev: 1340,
    prizeMeterNow: 1349,
    flag: true,
    note: "มิเตอร์ตุ๊กตาบอกแจก 9 ตัว · แต่นับในตู้หายแค่ 4 ตัว — 5 ตัวหายไปไหน?",
  }),
  mkMachine("PTT-CKR-05", "ตู้ 05 · ใกล้ ATM", { meterBefore: 15200, meterAfter: 15350, prizeBefore: 22, prizeAfter: 13, refilled: 0, cashIn: 1500, photos: 5, prizeMeterPrev: 1480, prizeMeterNow: 1489 }),
  mkMachine("PTT-CKR-06", "ตู้ 06 · มุมเด็ก", { meterBefore: 8950, meterAfter: 8950, prizeBefore: 22, prizeAfter: 22, refilled: 0, cashIn: 0, photos: 3, prizeMeterPrev: 540, prizeMeterNow: 540, flag: true, note: "มิเตอร์ทั้งคู่ไม่ขึ้น · ตู้อาจเสีย" }),
];

export const ANOMALIES: Anomaly[] = [
  {
    id: "CFS-2569-000018",
    branchId: "PTT-CKR",
    severity: "P1",
    type: "cash_short",
    typeLabel: "เงินขาด",
    reason: "เงินที่เก็บได้น้อยกว่าเลขมิเตอร์",
    expectedCash: 8400,
    actualCash: 5860,
    gap: 2540,
    gapPct: 30.2,
    prizeExpected: 30,
    prizeActual: 28,
    prizeGap: 2,
    sessionStart: "12:35",
    sessionEnd: "13:20",
    duration: "45 นาที",
    timeAgo: "8 ชม.",
    timestamp: "13:20 · 27 พ.ค.",
    staff: "น้องเอ",
    staffAvatar: "อ",
    machines: BASE_ANOMALY_MACHINES,
  },
  {
    id: "CFS-2569-000004",
    branchId: "PTT-PKC",
    severity: "P1",
    type: "cash_short",
    typeLabel: "เงินขาด",
    reason: "มิเตอร์ตรงข้าม cash · prize loss สูง",
    expectedCash: 9800,
    actualCash: 7280,
    gap: 2520,
    gapPct: 25.7,
    prizeExpected: 32,
    prizeActual: 35,
    prizeGap: -3,
    sessionStart: "15:00",
    sessionEnd: "15:42",
    duration: "42 นาที",
    timeAgo: "2 วัน",
    timestamp: "15:42 · 25 พ.ค.",
    staff: "น้องบี",
    staffAvatar: "บ",
    machines: BASE_ANOMALY_MACHINES.map((m) => ({ ...m, code: m.code.replace("PTT-CKR", "PTT-PKC") })),
  },
  {
    id: "CFS-2569-000011",
    branchId: "CTP-PKL",
    severity: "P1",
    type: "cash_short",
    typeLabel: "เงินขาด",
    reason: "เงินที่เก็บได้น้อยกว่าเลขมิเตอร์",
    expectedCash: 9500,
    actualCash: 7060,
    gap: 2440,
    gapPct: 25.7,
    prizeExpected: 28,
    prizeActual: 27,
    prizeGap: 1,
    sessionStart: "10:30",
    sessionEnd: "11:15",
    duration: "45 นาที",
    timeAgo: "2 วัน",
    timestamp: "11:15 · 25 พ.ค.",
    staff: "พี่หนึ่ง",
    staffAvatar: "น",
    machines: BASE_ANOMALY_MACHINES.slice(0, 5).map((m) => ({ ...m, code: m.code.replace("PTT-CKR", "CTP-PKL") })),
  },
  {
    id: "CFS-2569-000025",
    branchId: "BYI-MKT",
    severity: "P1",
    type: "prize_short",
    typeLabel: "ตุ๊กตาหาย",
    reason: "ตุ๊กตาที่นับน้อยกว่าที่ระบบคำนวณ",
    expectedCash: 5000,
    actualCash: 5000,
    gap: 0,
    gapPct: 0,
    prizeExpected: 40,
    prizeActual: 35,
    prizeGap: 5,
    sessionStart: "13:20",
    sessionEnd: "14:05",
    duration: "45 นาที",
    timeAgo: "8 ชม.",
    timestamp: "14:05 · 27 พ.ค.",
    staff: "พี่สอง",
    staffAvatar: "ส",
    machines: BASE_ANOMALY_MACHINES.slice(0, 4).map((m, i) => ({
      ...m,
      code: m.code.replace("PTT-CKR", "BYI-MKT"),
      // deterministic stand-in for the original `Math.random()` so SSR + client match
      cashIn: 1250 + ((i * 47) % 200),
    })),
  },
];

// TODO[v2-wire-db]: replace with `listSessions({ status: 'active' })`
export const ACTIVE_SESSIONS: ActiveSession[] = [
  { id: "CFS-2569-000028", branchId: "BYI-MKT", machines: 14, done: 1, staff: "พี่สอง", staffAvatar: "ส", elapsed: "3 ชม. 16 นาที", startedAt: "18:20", stale: true },
  { id: "CFS-2569-000014", branchId: "CTP-PKL", machines: 8, done: 3, staff: "พี่หนึ่ง", staffAvatar: "น", elapsed: "1 ชม. 16 นาที", startedAt: "20:20", stale: false },
  { id: "CFS-2569-000021", branchId: "KKM-MAL", machines: 7, done: 4, staff: "พี่สาม", staffAvatar: "ม", elapsed: "38 นาที", startedAt: "20:58", stale: false },
  { id: "CFS-2569-000007", branchId: "PTT-NMP", machines: 5, done: 5, staff: "น้องอี", staffAvatar: "อ", elapsed: "52 นาที", startedAt: "20:44", stale: false },
];

// TODO[v2-wire-db]: replace with `listSessions({ status: 'closed', date: today })`
export const CLOSED_TODAY: ClosedSession[] = [
  { id: "CFS-2569-000020", branchId: "PTT-CYM", revenue: 7280, machines: 6, prizeOut: 28, staff: "น้องเอฟ", staffAvatar: "ฟ", closedAt: "18:42" },
  { id: "CFS-2569-000019", branchId: "PTT-DMV", revenue: 4220, machines: 6, prizeOut: 19, staff: "น้องดี", staffAvatar: "ด", closedAt: "16:20" },
  { id: "CFS-2569-000017", branchId: "PTT-SKR", revenue: 3140, machines: 5, prizeOut: 14, staff: "น้องซี", staffAvatar: "ซ", closedAt: "14:38" },
  { id: "CFS-2569-000016", branchId: "CRP-PKR", revenue: 5910, machines: 6, prizeOut: 22, staff: "พี่โอ", staffAvatar: "โ", closedAt: "13:55" },
];

function mkStockEntry(skuCode: string, warehouseQty: number, machineQty: number, lastDelivery: string, velocity: number): StockEntry {
  const sku = SKUS.find((s) => s.code === skuCode);
  if (!sku) throw new Error(`Unknown SKU code: ${skuCode}`);
  return {
    sku: skuCode,
    name: sku.name,
    warehouse: warehouseQty,
    inMachines: machineQty,
    lastDelivery,
    velocity,
    cost: sku.cost,
  };
}

// TODO[v2-wire-db]: replace with `getStockBalance({ branchId })` per branch
const SEED_BRANCH_STOCK: Record<string, StockEntry[]> = {
  "PTT-CKR": [
    mkStockEntry("SKU-001", 18, 42, "5 วันก่อน", 8),
    mkStockEntry("SKU-002", 3, 18, "5 วันก่อน", 4),
    mkStockEntry("SKU-003", 24, 48, "5 วันก่อน", 9),
    mkStockEntry("SKU-004", 12, 30, "5 วันก่อน", 5),
    mkStockEntry("SKU-005", 8, 24, "5 วันก่อน", 4),
    mkStockEntry("SKU-006", 0, 12, "5 วันก่อน", 3), // ใกล้หมด
    mkStockEntry("SKU-007", 15, 36, "5 วันก่อน", 6),
    mkStockEntry("SKU-008", 2, 6, "5 วันก่อน", 1),
    mkStockEntry("SKU-009", 32, 48, "5 วันก่อน", 7),
    mkStockEntry("SKU-010", 14, 30, "5 วันก่อน", 5),
  ],
  "PTT-PKC": [
    mkStockEntry("SKU-001", 12, 36, "6 วันก่อน", 6),
    mkStockEntry("SKU-002", 8, 24, "6 วันก่อน", 5),
    mkStockEntry("SKU-003", 1, 30, "6 วันก่อน", 8),
    mkStockEntry("SKU-004", 14, 24, "6 วันก่อน", 4),
    mkStockEntry("SKU-005", 18, 30, "6 วันก่อน", 5),
    mkStockEntry("SKU-006", 6, 18, "6 วันก่อน", 3),
    mkStockEntry("SKU-007", 9, 24, "6 วันก่อน", 5),
    mkStockEntry("SKU-008", 4, 12, "6 วันก่อน", 2),
    mkStockEntry("SKU-009", 22, 36, "6 วันก่อน", 6),
    mkStockEntry("SKU-010", 11, 24, "6 วันก่อน", 4),
  ],
};

const WAREHOUSE_FALLBACK = [22, 8, 15, 4, 18, 12, 6, 3, 28, 10] as const;
const MACHINE_FALLBACK = [36, 24, 30, 12, 24, 18, 15, 9, 42, 21] as const;
const VELOCITY_FALLBACK = [6, 4, 5, 2, 4, 3, 3, 1, 7, 4] as const;

export const BRANCH_STOCK: Record<string, StockEntry[]> = (() => {
  const out: Record<string, StockEntry[]> = { ...SEED_BRANCH_STOCK };
  for (const b of BRANCHES) {
    if (out[b.id]) continue;
    out[b.id] = SKUS.map((s, i) =>
      mkStockEntry(
        s.code,
        WAREHOUSE_FALLBACK[i] ?? 10,
        MACHINE_FALLBACK[i] ?? 20,
        `${3 + (i % 5)} วันก่อน`,
        VELOCITY_FALLBACK[i] ?? 4,
      ),
    );
  }
  return out;
})();

// TODO[v2-wire-db]: replace with deliveries query (new table TBD or stock_movement filter)
export const DELIVERIES: Delivery[] = [
  { id: "DLV-2569-014", branchId: "PTT-CKR", items: 6, units: 240, eta: "พรุ่งนี้ 09:00", status: "in_transit", from: "คลังกลาง บางนา" },
  { id: "DLV-2569-013", branchId: "PTT-PKC", items: 4, units: 120, eta: "29 พ.ค. 11:00", status: "scheduled", from: "คลังกลาง บางนา" },
  { id: "DLV-2569-012", branchId: "BYI-MKT", items: 8, units: 320, eta: "วันนี้ 22:00", status: "in_transit", from: "คลังกลาง บางนา" },
];

// TODO[v2-wire-db]: aggregate from CfCollectionSession + CfCollectionEvent
export const TODAY: TodaySummary = {
  revenue: 67970,
  yesterdayRevenue: 58420,
  sessions: 12,
  sessionsExpected: 16,
  anomaliesOpen: 4,
  stockAlerts: 6,
  staffActive: 7,
  staffTotal: 10,
  prizesOut: 142,
};

// TODO[v2-wire-db]: 7-day rolling aggregate
export const TREND_7D: TrendDay[] = [
  { day: "พ", date: "21 พ.ค.", revenue: 48200, anomaly: 1 },
  { day: "พฤ", date: "22 พ.ค.", revenue: 52800, anomaly: 0 },
  { day: "ศ", date: "23 พ.ค.", revenue: 71400, anomaly: 3 },
  { day: "ส", date: "24 พ.ค.", revenue: 84200, anomaly: 2 },
  { day: "อา", date: "25 พ.ค.", revenue: 79600, anomaly: 2 },
  { day: "จ", date: "26 พ.ค.", revenue: 58420, anomaly: 1 },
  { day: "อ", date: "27 พ.ค.", revenue: 67970, anomaly: 4, today: true },
];

// TODO[v2-wire-db]: per-branch today aggregate
export const BRANCH_PERF: BranchPerf[] = [
  { id: "BYI-MKT", revenue: 12140, change: 12, sessions: 1, anomaly: 1, prizeOut: 32, status: "attention" },
  { id: "PTT-CKR", revenue: 5860, change: -28, sessions: 1, anomaly: 1, prizeOut: 30, status: "attention" },
  { id: "PTT-PKC", revenue: 7280, change: -8, sessions: 1, anomaly: 1, prizeOut: 24, status: "attention" },
  { id: "CTP-PKL", revenue: 7060, change: -4, sessions: 1, anomaly: 1, prizeOut: 27, status: "attention" },
  { id: "KKM-MAL", revenue: 6420, change: 8, sessions: 1, anomaly: 0, prizeOut: 22, status: "ok" },
  { id: "PTT-CYM", revenue: 7280, change: 18, sessions: 1, anomaly: 0, prizeOut: 28, status: "ok" },
  { id: "PTT-DMV", revenue: 4220, change: -2, sessions: 1, anomaly: 0, prizeOut: 19, status: "ok" },
  { id: "PTT-SKR", revenue: 3140, change: 6, sessions: 1, anomaly: 0, prizeOut: 14, status: "ok" },
  { id: "CRP-PKR", revenue: 5910, change: 11, sessions: 1, anomaly: 0, prizeOut: 22, status: "ok" },
  { id: "PTT-NMP", revenue: 8660, change: 14, sessions: 1, anomaly: 0, prizeOut: 26, status: "ok" },
];

// TODO[v2-wire-db]: replace with `getReportEvents()` from queries
export const INSIGHTS_ROWS: InsightRow[] = [
  { time: "27 พ.ค. 13:20", id: "CFS-2569-000018", branchId: "PTT-CKR", staff: "น้องเอ", expectedCash: 8400, actualCash: 5860, prizeOut: 30, status: "review", severity: "P1" },
  { time: "27 พ.ค. 14:05", id: "CFS-2569-000025", branchId: "BYI-MKT", staff: "พี่สอง", expectedCash: 5000, actualCash: 5000, prizeOut: 35, status: "review", severity: "P1" },
  { time: "27 พ.ค. 18:42", id: "CFS-2569-000020", branchId: "PTT-CYM", staff: "น้องเอฟ", expectedCash: 7280, actualCash: 7280, prizeOut: 28, status: "ok" },
  { time: "27 พ.ค. 16:20", id: "CFS-2569-000019", branchId: "PTT-DMV", staff: "น้องดี", expectedCash: 4220, actualCash: 4220, prizeOut: 19, status: "ok" },
  { time: "27 พ.ค. 14:38", id: "CFS-2569-000017", branchId: "PTT-SKR", staff: "น้องซี", expectedCash: 3140, actualCash: 3140, prizeOut: 14, status: "ok" },
  { time: "27 พ.ค. 13:55", id: "CFS-2569-000016", branchId: "CRP-PKR", staff: "พี่โอ", expectedCash: 5910, actualCash: 5910, prizeOut: 22, status: "ok" },
  { time: "25 พ.ค. 15:42", id: "CFS-2569-000004", branchId: "PTT-PKC", staff: "น้องบี", expectedCash: 9800, actualCash: 7280, prizeOut: 35, status: "review", severity: "P1" },
  { time: "25 พ.ค. 11:15", id: "CFS-2569-000011", branchId: "CTP-PKL", staff: "พี่หนึ่ง", expectedCash: 9500, actualCash: 7060, prizeOut: 27, status: "review", severity: "P1" },
  { time: "24 พ.ค. 20:30", id: "CFS-2569-000010", branchId: "KKM-MAL", staff: "พี่สาม", expectedCash: 8200, actualCash: 8200, prizeOut: 26, status: "ok" },
  { time: "24 พ.ค. 18:12", id: "CFS-2569-000009", branchId: "PTT-NMP", staff: "น้องอี", expectedCash: 7400, actualCash: 7400, prizeOut: 24, status: "ok" },
];

/** Fallback shape when an id doesn't match a known branch (kept loose, like the mockup). */
export type BranchFallback = {
  id: string;
  name: string;
  code: string;
  tone?: BranchTone;
  area?: string;
  avatar?: string;
  machines?: number;
  manager?: string;
};

/** Look up branch by id with a graceful fallback (mirrors mockup `getBranch`). */
export function getBranch(id: string): Branch | BranchFallback {
  return BRANCHES.find((b) => b.id === id) ?? { id, name: id, code: id };
}
