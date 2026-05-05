// Pooilgroup ERP — Business Type form configs
// Universal Form engine reads this to render the correct fields per branch
// Spec source: ดีเทลv1/CASHHUB.md §3 + §13

export type FieldType = "currency" | "number" | "text";
export type FieldGroup =
  | "sales"
  | "received"
  | "shortage"
  | "rental"
  | "training"
  | "notes"
  | "custom";

export interface FieldConfig {
  key: string;
  label: string;
  placeholder: string;
  type: FieldType;
  unit?: string;
  group: FieldGroup;
  required: boolean;
  hint?: string;
  /** When true, only digits + dot allowed. Defaults: currency/number=true, text=false. Admin override possible. */
  numericOnly?: boolean;
  /** Maps to which column on daily_reports */
  column:
    | "totalSales"
    | "qty1"
    | "qty2"
    | "cash"
    | "transfer"
    | "card"
    | "credit"
    | "shortage"
    | "rentalIncome"
    | "trainingSessions"
    | "notes";
  qtyUnit?: string;
}

export type BusinessTypeKey =
  | "fuel_station"
  | "lpg_station"
  | "lpg_retail"
  | "bottling_plant"
  | "hotel"
  | "convenience_store"
  | "ev_station"
  | "cafe"
  | "cafe_punthai"
  | "massage_chair"
  | "claw_machine"
  | "training_center";

export interface BusinessTypeConfig {
  type: BusinessTypeKey;
  label: string;
  emoji: string;
  hasShifts: boolean;
  shifts: ("morning" | "midday" | "evening" | "all")[];
  hasReconcile: boolean;
  /** Daily reporting cadence — kiosks may collect cash weekly/biweekly */
  reportingCadence: "daily" | "weekly" | "biweekly" | "monthly" | "none";
  /** If false, this branch type doesn't submit CashHub reports (e.g. training center) */
  hasCashReport: boolean;
  fields: FieldConfig[];
  /**
   * Reconcile formula description (human-readable)
   * Always: totalSales == cash + transfer + card + credit + shortage
   * (when hasReconcile)
   */
  reconcileFormula: string;
}

const RECEIVED_FIELDS: FieldConfig[] = [
  {
    key: "cash",
    label: "เงินสด",
    placeholder: "เช่น 80000",
    type: "currency",
    unit: "฿",
    group: "received",
    required: false,
    column: "cash",
  },
  {
    key: "transfer",
    label: "โอนธนาคาร",
    placeholder: "เช่น 45000",
    type: "currency",
    unit: "฿",
    group: "received",
    required: false,
    column: "transfer",
  },
  {
    key: "card",
    label: "บัตรเครดิต",
    placeholder: "เช่น 20000",
    type: "currency",
    unit: "฿",
    group: "received",
    required: false,
    column: "card",
  },
  {
    key: "credit",
    label: "เครดิต/ลูกหนี้",
    placeholder: "เช่น 0",
    type: "currency",
    unit: "฿",
    group: "received",
    required: false,
    hint: "ลูกค้าที่ยังไม่ได้จ่าย",
    column: "credit",
  },
];

const SHORTAGE_FIELD: FieldConfig = {
  key: "shortage",
  label: "เงินขาด",
  placeholder: "เช่น 0 (ถ้าไม่มี ใส่ 0)",
  type: "currency",
  unit: "฿",
  group: "shortage",
  required: false,
  hint: "ถ้ามี ต้องระบุชื่อพนักงานหรือหมายเหตุ",
  column: "shortage",
};

const NOTES_FIELD: FieldConfig = {
  key: "notes",
  label: "หมายเหตุ",
  placeholder: "เช่น เครื่องปั๊ม #2 มีปัญหาช่วงบ่าย",
  type: "text",
  group: "notes",
  required: false,
  column: "notes",
};

// =============================================================
// ⛽ ปั๊มน้ำมัน (2 กะ: เช้า/เย็น)
// =============================================================
const fuelStation: BusinessTypeConfig = {
  type: "fuel_station",
  label: "ปั๊มน้ำมัน",
  emoji: "⛽",
  hasShifts: true,
  shifts: ["morning", "evening"],
  hasReconcile: true,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "totalSales == cash + transfer + card + credit + shortage",
  fields: [
    {
      key: "totalSales",
      label: "ยอดจ่ายรวม",
      placeholder: "เช่น 145000",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      hint: "ยอดรวมจากมิเตอร์ปั๊มทุกหัว",
      column: "totalSales",
    },
    {
      key: "qty1",
      label: "จำนวนลิตร",
      placeholder: "เช่น 5200",
      type: "number",
      unit: "ลิตร",
      group: "sales",
      required: true,
      hint: "ลิตรรวมจากมิเตอร์ทุกหัว",
      column: "qty1",
      qtyUnit: "liter",
    },
    ...RECEIVED_FIELDS,
    SHORTAGE_FIELD,
    NOTES_FIELD,
  ],
};

// =============================================================
// 🔵 ปั๊มแก๊ส (LPG filling station — รถยนต์เข้าเติม)
// =============================================================
const lpgStation: BusinessTypeConfig = {
  type: "lpg_station",
  label: "ปั๊มแก๊ส",
  emoji: "🔵",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: true,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "totalSales == cash + transfer + credit + shortage",
  fields: [
    {
      key: "qty1",
      label: "จำนวนถัง",
      placeholder: "เช่น 24",
      type: "number",
      unit: "ถัง",
      group: "sales",
      required: true,
      column: "qty1",
      qtyUnit: "tank",
    },
    {
      key: "totalSales",
      label: "ยอดขายรวม",
      placeholder: "เช่น 12000",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      column: "totalSales",
    },
    RECEIVED_FIELDS[0]!, // cash
    RECEIVED_FIELDS[1]!, // transfer
    RECEIVED_FIELDS[3]!, // credit (ร้านก๊าซไม่ค่อยรับบัตร)
    SHORTAGE_FIELD,
    NOTES_FIELD,
  ],
};

// =============================================================
// 🏭 โรงบรรจุก๊าซ
// =============================================================
const bottlingPlant: BusinessTypeConfig = {
  type: "bottling_plant",
  label: "โรงบรรจุก๊าซ",
  emoji: "🏭",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: true,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "totalSales == cash + transfer + credit + shortage",
  fields: [
    {
      key: "qty1",
      label: "ถังที่บรรจุวันนี้",
      placeholder: "เช่น 320",
      type: "number",
      unit: "ถัง",
      group: "sales",
      required: true,
      column: "qty1",
      qtyUnit: "tank",
    },
    {
      key: "qty2",
      label: "น้ำหนักก๊าซ (กก.)",
      placeholder: "เช่น 4800",
      type: "number",
      unit: "กก.",
      group: "sales",
      required: false,
      column: "qty2",
      qtyUnit: "kg",
    },
    {
      key: "totalSales",
      label: "ยอดขายรวม",
      placeholder: "เช่น 285000",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      column: "totalSales",
    },
    RECEIVED_FIELDS[0]!, // cash
    RECEIVED_FIELDS[1]!, // transfer
    RECEIVED_FIELDS[3]!, // credit
    SHORTAGE_FIELD,
    NOTES_FIELD,
  ],
};

// =============================================================
// 🏨 โรงแรม
// =============================================================
const hotel: BusinessTypeConfig = {
  type: "hotel",
  label: "โรงแรม",
  emoji: "🏨",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: true,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "totalSales == cash + transfer + card + credit + shortage",
  fields: [
    {
      key: "qty1",
      label: "ห้องที่ขายได้",
      placeholder: "เช่น 12",
      type: "number",
      unit: "ห้อง",
      group: "sales",
      required: true,
      column: "qty1",
      qtyUnit: "room",
    },
    {
      // total_sales = qty2 (food) + room_revenue — แต่ยังไม่ขยาย schema
      // ใช้ totalSales รวมทุกอย่าง user กรอก roomRevenue+foodRevenue เอง (ใน MVP)
      key: "totalSales",
      label: "ยอดขายรวม (ห้อง+อาหาร/บาร์)",
      placeholder: "เช่น 38500",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      hint: "รวมทั้งห้องพักและร้านอาหาร/บาร์",
      column: "totalSales",
    },
    {
      key: "qty2",
      label: "ยอดอาหาร/บาร์ (เฉพาะ)",
      placeholder: "เช่น 8500",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: false,
      hint: "แยกเพื่อให้เห็น breakdown",
      column: "qty2",
      qtyUnit: "baht",
    },
    ...RECEIVED_FIELDS,
    SHORTAGE_FIELD,
    NOTES_FIELD,
  ],
};

// =============================================================
// 🏪 7-Eleven (3 กะ — ไม่มี Reconcile)
// =============================================================
const conv: BusinessTypeConfig = {
  type: "convenience_store",
  label: "7-Eleven",
  emoji: "🏪",
  hasShifts: true,
  shifts: ["morning", "midday", "evening"],
  hasReconcile: false,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "",
  fields: [
    {
      key: "totalSales",
      label: "ยอดขายกะนี้",
      placeholder: "เช่น 12400",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      hint: "POS จัดการ Reconcile แล้ว — กรอกแค่ยอดรวมต่อกะ",
      column: "totalSales",
    },
    NOTES_FIELD,
  ],
};

// =============================================================
// ⚡ EV Station
// =============================================================
const ev: BusinessTypeConfig = {
  type: "ev_station",
  label: "EV Station",
  emoji: "⚡",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: true,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "totalSales == cash + transfer + card + shortage",
  fields: [
    {
      key: "qty1",
      label: "จำนวน Session",
      placeholder: "เช่น 18",
      type: "number",
      unit: "ครั้ง",
      group: "sales",
      required: true,
      column: "qty1",
      qtyUnit: "session",
    },
    {
      key: "qty2",
      label: "พลังงานรวม (kWh)",
      placeholder: "เช่น 245",
      type: "number",
      unit: "kWh",
      group: "sales",
      required: false,
      column: "qty2",
      qtyUnit: "kwh",
    },
    {
      key: "totalSales",
      label: "ยอดรายรับรวม",
      placeholder: "เช่น 4200",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      column: "totalSales",
    },
    RECEIVED_FIELDS[0]!, // cash
    RECEIVED_FIELDS[1]!, // transfer/QR
    RECEIVED_FIELDS[2]!, // card
    SHORTAGE_FIELD,
    NOTES_FIELD,
  ],
};

// =============================================================
// ☕ Café Amazon
// =============================================================
const cafe: BusinessTypeConfig = {
  type: "cafe",
  label: "Café Amazon",
  emoji: "☕",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: true,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "totalSales == cash + transfer + credit + shortage",
  fields: [
    {
      key: "qty1",
      label: "จำนวนแก้ว",
      placeholder: "เช่น 145",
      type: "number",
      unit: "แก้ว",
      group: "sales",
      required: true,
      column: "qty1",
      qtyUnit: "cup",
    },
    {
      key: "qty2",
      label: "จำนวนขนม (ชิ้น)",
      placeholder: "เช่น 38",
      type: "number",
      unit: "ชิ้น",
      group: "sales",
      required: false,
      column: "qty2",
      qtyUnit: "piece",
    },
    {
      key: "totalSales",
      label: "ยอดขายรวม",
      placeholder: "เช่น 9800",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      column: "totalSales",
    },
    RECEIVED_FIELDS[0]!, // cash
    RECEIVED_FIELDS[1]!, // transfer/QR
    RECEIVED_FIELDS[3]!, // credit
    SHORTAGE_FIELD,
    NOTES_FIELD,
  ],
};

// =============================================================
// 🛒 ร้านค้าแก๊ส (LPG retail — ขายถังแก๊สให้ครัวเรือน/ร้านอาหาร)
// =============================================================
const lpgRetail: BusinessTypeConfig = {
  type: "lpg_retail",
  label: "ร้านค้าแก๊ส",
  emoji: "🛒",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: true,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "totalSales == cash + transfer + credit + shortage",
  fields: [
    {
      key: "qty1",
      label: "ถังที่ขาย (ขนาดมาตรฐาน)",
      placeholder: "เช่น 18",
      type: "number",
      unit: "ถัง",
      group: "sales",
      required: true,
      hint: "นับรวมทุกขนาด — ใช้สำหรับ KPI ปริมาณขาย",
      column: "qty1",
      qtyUnit: "tank",
    },
    {
      key: "totalSales",
      label: "ยอดขายรวม",
      placeholder: "เช่น 7800",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      column: "totalSales",
    },
    RECEIVED_FIELDS[0]!, // cash
    RECEIVED_FIELDS[1]!, // transfer
    RECEIVED_FIELDS[3]!, // credit (ลูกค้าประจำ)
    SHORTAGE_FIELD,
    NOTES_FIELD,
  ],
};

// =============================================================
// ☕ ร้านกาแฟพันธุ์ไทย (เหมือน Café Amazon — แค่ brand ต่าง)
// =============================================================
const cafePunthai: BusinessTypeConfig = {
  type: "cafe_punthai",
  label: "พันธุ์ไทย",
  emoji: "☕",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: true,
  reportingCadence: "daily",
  hasCashReport: true,
  reconcileFormula: "totalSales == cash + transfer + credit + shortage",
  fields: cafe.fields, // identical KPI structure
};

// =============================================================
// 💆 เก้าอี้นวด (kiosk — เก็บเงินเป็นรอบ ไม่ใช่รายวัน)
// 1 Manager มักดูแลหลายตู้ — กรอกเฉพาะตอนไปเก็บเงิน
// =============================================================
const massageChair: BusinessTypeConfig = {
  type: "massage_chair",
  label: "เก้าอี้นวด",
  emoji: "💆",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: false,
  reportingCadence: "weekly",
  hasCashReport: true,
  reconcileFormula: "",
  fields: [
    {
      key: "qty1",
      label: "จำนวน Session ในรอบนี้",
      placeholder: "เช่น 142",
      type: "number",
      unit: "ครั้ง",
      group: "sales",
      required: true,
      hint: "อ่านจากตัวเลขนับใต้เครื่อง",
      column: "qty1",
      qtyUnit: "session",
    },
    {
      key: "cash",
      label: "เงินสดที่เก็บได้",
      placeholder: "เช่น 4260",
      type: "currency",
      unit: "฿",
      group: "received",
      required: true,
      hint: "นับเงินจริงในกล่องเครื่อง",
      column: "cash",
    },
    {
      key: "totalSales",
      label: "ยอดรวมรอบนี้",
      placeholder: "auto-fill = เงินสดเก็บได้",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      hint: "ปกติเท่ากับเงินสดที่เก็บได้",
      column: "totalSales",
    },
    NOTES_FIELD,
  ],
};

// =============================================================
// 🎮 ตู้คีบ (kiosk — รูปแบบเดียวกับเก้าอี้นวด)
// =============================================================
const clawMachine: BusinessTypeConfig = {
  type: "claw_machine",
  label: "ตู้คีบ",
  emoji: "🎮",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: false,
  reportingCadence: "weekly",
  hasCashReport: true,
  reconcileFormula: "",
  fields: [
    {
      key: "qty1",
      label: "จำนวนรอบเล่น",
      placeholder: "เช่น 320",
      type: "number",
      unit: "รอบ",
      group: "sales",
      required: true,
      column: "qty1",
      qtyUnit: "play",
    },
    {
      key: "qty2",
      label: "ตุ๊กตา/ของรางวัลที่หายไป",
      placeholder: "เช่น 18",
      type: "number",
      unit: "ชิ้น",
      group: "sales",
      required: false,
      hint: "นับเพื่อ track ต้นทุนรางวัล",
      column: "qty2",
      qtyUnit: "piece",
    },
    {
      key: "cash",
      label: "เงินสดที่เก็บได้",
      placeholder: "เช่น 3200",
      type: "currency",
      unit: "฿",
      group: "received",
      required: true,
      column: "cash",
    },
    {
      key: "totalSales",
      label: "ยอดรวมรอบนี้",
      placeholder: "auto-fill = เงินสดเก็บได้",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      column: "totalSales",
    },
    NOTES_FIELD,
  ],
};

// =============================================================
// 🎓 ศูนย์ฝึกอบรม (monthly summary — รายได้ + จำนวนครั้งจัด)
// ไม่ใช่รายงานรายวัน แต่ track เป็น event-based
// =============================================================
const trainingCenter: BusinessTypeConfig = {
  type: "training_center",
  label: "ศูนย์ฝึกอบรม",
  emoji: "🎓",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: false,
  reportingCadence: "monthly",
  hasCashReport: true,
  reconcileFormula: "",
  fields: [
    {
      key: "qty1",
      label: "จำนวนครั้งที่จัดอบรม",
      placeholder: "เช่น 4",
      type: "number",
      unit: "ครั้ง",
      group: "training",
      required: true,
      hint: "นับเฉพาะครั้งที่จัดเสร็จในเดือนนี้",
      column: "trainingSessions",
      qtyUnit: "session",
    },
    {
      key: "qty2",
      label: "จำนวนผู้เข้าอบรมรวม",
      placeholder: "เช่น 85",
      type: "number",
      unit: "คน",
      group: "training",
      required: false,
      column: "qty2",
      qtyUnit: "person",
    },
    {
      key: "totalSales",
      label: "รายได้จากการอบรม",
      placeholder: "เช่น 145000",
      type: "currency",
      unit: "฿",
      group: "sales",
      required: true,
      column: "totalSales",
    },
    RECEIVED_FIELDS[0]!, // cash
    RECEIVED_FIELDS[1]!, // transfer
    NOTES_FIELD,
  ],
};

// =============================================================
// Registry
// =============================================================
export const BUSINESS_TYPES: Record<string, BusinessTypeConfig> = {
  fuel_station: fuelStation,
  lpg_station: lpgStation,
  lpg_retail: lpgRetail,
  bottling_plant: bottlingPlant,
  hotel: hotel,
  convenience_store: conv,
  ev_station: ev,
  cafe: cafe,
  cafe_punthai: cafePunthai,
  massage_chair: massageChair,
  claw_machine: clawMachine,
  training_center: trainingCenter,
};

export const BUSINESS_TYPE_LIST: BusinessTypeConfig[] =
  Object.values(BUSINESS_TYPES);

export function getBusinessType(type: string): BusinessTypeConfig | undefined {
  return BUSINESS_TYPES[type];
}

// Shift labels for UI
export const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 กะเช้า",
  midday: "☀️ กะกลางวัน",
  evening: "🌙 กะเย็น",
  all: "ทั้งวัน",
};
