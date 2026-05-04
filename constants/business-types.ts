// Pool Group ERP — Business Type form configs
// Universal Form engine reads this to render the correct fields per branch
// Spec source: ดีเทลv1/CASHHUB.md §3 + §13

export type FieldType = "currency" | "number" | "text";
export type FieldGroup = "sales" | "received" | "shortage" | "notes";

export interface FieldConfig {
  key: string;
  label: string;
  placeholder: string;
  type: FieldType;
  unit?: string;
  group: FieldGroup;
  required: boolean;
  hint?: string;
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
    | "notes";
  qtyUnit?: string;
}

export interface BusinessTypeConfig {
  type:
    | "fuel_station"
    | "lpg_station"
    | "bottling_plant"
    | "hotel"
    | "convenience_store"
    | "ev_station"
    | "cafe";
  label: string;
  emoji: string;
  hasShifts: boolean;
  shifts: ("morning" | "midday" | "evening" | "all")[];
  hasReconcile: boolean;
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
// 🔵 ร้านก๊าซ
// =============================================================
const lpgStation: BusinessTypeConfig = {
  type: "lpg_station",
  label: "ร้านก๊าซ",
  emoji: "🔵",
  hasShifts: false,
  shifts: ["all"],
  hasReconcile: true,
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
// Registry
// =============================================================
export const BUSINESS_TYPES: Record<string, BusinessTypeConfig> = {
  fuel_station: fuelStation,
  lpg_station: lpgStation,
  bottling_plant: bottlingPlant,
  hotel: hotel,
  convenience_store: conv,
  ev_station: ev,
  cafe: cafe,
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
