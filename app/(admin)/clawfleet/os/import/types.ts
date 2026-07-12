// ClawFleet · นำเข้าข้อมูลเก็บเงิน/เติมตุ๊กตา จาก Excel — shared types + column spec.
//
// แยกออกจาก actions.ts เพราะไฟล์ "use server" export ได้เฉพาะ async function.
// ค่าคงที่ (หัวคอลัมน์) + type/interface อยู่ที่นี่ ทั้ง action และ client shell import ได้.
//
// 1 แถว = 1 ตู้ 1 วัน. อ้างตู้ด้วย "รหัสตู้" (CfMachine.code · unique ต่อ org),
// อ้างสาขาด้วยชื่อไทยหรือรหัสสาขา. ไม่ต้องระบุ SKU (CEO 2026-07-12) — กรอกแค่ตัวเลข.

// ── Column spec (ลำดับล็อก · หัวตารางแท็บ "กรอกข้อมูล") ──────────────────────
// key = ชื่อในโค้ด · label = หัวตารางไทยที่ผู้ใช้เห็น (parser จับด้วย label).
// required = ต้องมีค่าเสมอ · มิเตอร์เงิน "อย่างน้อย 1 ด้าน" ตรวจแยก (เหมือน BaselineForm).
export const IMPORT_COLUMNS = [
  { key: "branch", label: "สาขา", required: true },
  { key: "machine", label: "รหัสตู้", required: true },
  { key: "date", label: "วันที่", required: true },
  { key: "coinMeterTop", label: "มิเตอร์เงินบน", required: false },
  { key: "coinMeterBottom", label: "มิเตอร์เงินล่าง", required: false },
  { key: "cash", label: "เงินที่เก็บ(บาท)", required: true },
  { key: "stockBefore", label: "ตุ๊กตาก่อนเติม", required: false },
  { key: "refillQty", label: "จำนวนที่เติม", required: false },
  { key: "stockAfter", label: "ตุ๊กตาหลังเติม", required: false },
  { key: "dollMeterTop", label: "มิเตอร์ตุ๊กตาบน", required: false },
  { key: "dollMeterBottom", label: "มิเตอร์ตุ๊กตาล่าง", required: false },
] as const;

export type ColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

/** หัวตารางเป็น array ของ label (แถวแรกของแท็บ "กรอกข้อมูล"). */
export const IMPORT_HEADER_LABELS = IMPORT_COLUMNS.map((c) => c.label);
export const HEADER_LINE = IMPORT_HEADER_LABELS.join(",");

// รูปแบบวันที่ที่ยอมรับ (แสดงในคู่มือ). รับทั้ง YYYY-MM-DD และ YYYY-MM-DD HH:mm.
export const DATE_FORMAT_HINT = "YYYY-MM-DD (เช่น 2026-07-01)";

export type RowKind =
  | "ready" // พร้อมบันทึก
  | "dedup" // ตู้+วันนี้มีข้อมูลอยู่แล้ว → ข้าม
  | "invalid"; // parse/validate ไม่ผ่าน

/** ตู้นี้ในไฟล์แถวนี้จะเข้าเป็น "ตั้งค่าครั้งแรก" หรือ "เก็บปกติ". */
export type EntryType = "INITIAL" | "COLLECTION";

export interface PreviewRow {
  rowIndex: number; // 1-based หลัง header (ตรงเลขแถวใน Excel)
  // ค่าดิบที่ผู้ใช้พิมพ์ (echo กลับให้เห็น)
  branchInput: string;
  machineInput: string;
  dateInput: string;
  // ค่าที่ resolve ได้
  branchId: string | null;
  branchName: string | null;
  machineId: string | null;
  machineCode: string | null;
  machineNickname: string | null;
  /** วันที่ normalize แล้ว "YYYY-MM-DD" (เวลาไทย) · null = อ่านไม่ได้. */
  date: string | null;
  // ตัวเลขที่กรอก (บาท/ตัว · ยังไม่แปลงเป็น cents — แปลงตอน commit)
  coinMeterTop: number | null;
  coinMeterBottom: number | null;
  dollMeterTop: number | null;
  dollMeterBottom: number | null;
  cashBaht: number | null;
  stockBefore: number | null;
  refillQty: number | null;
  stockAfter: number | null;
  /** มิเตอร์เงินที่ระบบจะใช้จริง (บน ?? ล่าง) — ตรงกับ server baseline logic. */
  coinMeterUsed: number | null;
  dollMeterUsed: number | null;
  entryType: EntryType;
  errors: string[];
  /** เตือน (ไม่บล็อก · เช่น มิเตอร์ถอยหลังจากรอบก่อน). */
  warnings: string[];
  kind: RowKind;
  /** ตั้งเมื่อ kind === "dedup" — id ของ event ที่ชนกัน. */
  dedupEventId?: string;
}

export interface PreviewResult {
  ok: true;
  rows: PreviewRow[];
  counts: {
    ready: number;
    dedup: number;
    invalid: number;
    total: number;
    initial: number; // กี่แถวเป็น "ตั้งค่าครั้งแรก"
    collection: number; // กี่แถวเป็น "เก็บปกติ"
    machines: number; // จำนวนตู้ที่เกี่ยวข้อง
    days: number; // จำนวนวันที่เกี่ยวข้อง
  };
  /** JSON ของแถว ready (ส่งกลับไป commit ในเฟส 2). */
  payload: string;
  /** HMAC(orgId|userId|payload) — commit จะปฏิเสธถ้าลายเซ็นไม่ตรง (กันแก้ตัวเลข). */
  payloadSig: string;
}

export type PreviewResponse = PreviewResult | { ok: false; error: string };

export interface CommitResult {
  ok: true;
  committed: number;
  dedup: number;
  skippedAtCommit: number;
  importBatchId: string;
}

export type CommitResponse = CommitResult | { ok: false; error: string };
