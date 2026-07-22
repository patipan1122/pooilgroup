// ผังบัญชีมาตรฐาน LedgerLine (JP Sync) — source of truth เดียวสำหรับหน้าตั้งค่าหมวดค่าใช้จ่าย.
// ข้อมูลทั้งหมด "นักบัญชี JP Sync รับรองแล้ว" (docs/LEDGERLINE_TRCLOUD_REFERENCE.md).
// ใช้ป้อน: dropdown เลือกรหัสบัญชี · lookup รหัส→ชื่อ · seed 20 หมวดมาตรฐาน · preview Dr/Cr.
// ⚠️ ห้ามแก้รหัส GL โดยไม่ปรึกษาสำนักงานบัญชี.

export type SkuCode = "JPS-100" | "JPS-101" | "JPS-103";

/** ชื่อ SKU (ของประเภทไหน — มีแค่ 3 ตัว) */
export const SKU_LABELS: Record<SkuCode, string> = {
  "JPS-100": "ซื้อสินค้าทั่วไป (สินค้า/วัสดุ)",
  "JPS-101": "ซื้อบริการ (ค่าไฟ/น้ำ/เช่า/จ้าง)",
  "JPS-103": "วัสดุก่อสร้าง/ต่อเติม",
};

/** บัญชีระบบที่ทุกใบใช้ร่วม (ขาภาษี/เจ้าหนี้) — TRCloud ลงให้อัตโนมัติตอน post */
export const SYSTEM_ACCOUNTS = {
  inputVat: { code: "1432000", name: "ภาษีซื้อ (ขอคืนได้)" },
  inputVatNonClaimable: { code: "5911100", name: "ภาษีซื้อไม่ขอคืน" },
  payable: { code: "2101000", name: "เจ้าหนี้การค้า" },
  fallback: { code: "5919999", name: "รายจ่ายยังไม่ได้แยกประเภท" },
} as const;

/** หมวดค่าใช้จ่ายมาตรฐาน — โครง Dr ค่าใช้จ่าย + Dr ภาษีซื้อ / Cr เจ้าหนี้.
 *  glCode = รหัสบัญชีค่าใช้จ่าย (ขา Dr หลัก) · vatClaimable = ขอคืนภาษีซื้อได้ไหม.
 *  wht = อัตราหัก ณ ที่จ่าย (%) ถ้ามี (แสดงเตือน · ยังไม่เก็บใน DB). */
export type StandardCategory = {
  name: string;
  glCode: string;
  sku: SkuCode;
  vatClaimable: boolean;
  wht?: number;
  note?: string;
};

export const STANDARD_CATEGORIES: StandardCategory[] = [
  { name: "ค่าโทรศัพท์", glCode: "5220010", sku: "JPS-101", vatClaimable: true },
  { name: "ค่าอินเทอร์เน็ต", glCode: "5220021", sku: "JPS-101", vatClaimable: true },
  { name: "ค่าไฟฟ้า", glCode: "5220020", sku: "JPS-101", vatClaimable: true },
  { name: "ค่าน้ำประปา", glCode: "5220030", sku: "JPS-101", vatClaimable: true },
  { name: "ค่าน้ำมันยานพาหนะ", glCode: "5210470", sku: "JPS-101", vatClaimable: false, note: "ขอคืน VAT ได้ ยกเว้นรถยนต์นั่ง ≤10 ที่นั่ง — บัญชีพิจารณารายใบ" },
  { name: "ค่าเดินทาง", glCode: "5210070", sku: "JPS-101", vatClaimable: true },
  { name: "ค่าโฆษณา/การตลาด", glCode: "5200500", sku: "JPS-101", vatClaimable: true, wht: 2 },
  { name: "ค่าเช่าสำนักงาน", glCode: "5210360", sku: "JPS-101", vatClaimable: false, wht: 5, note: "ค่าเช่ามักไม่มี VAT" },
  { name: "ค่าเช่ายานพาหนะ", glCode: "5210365", sku: "JPS-101", vatClaimable: true, wht: 5 },
  { name: "ค่าซ่อมบำรุง", glCode: "5210330", sku: "JPS-101", vatClaimable: true, wht: 3 },
  { name: "วัสดุสิ้นเปลือง", glCode: "5210310", sku: "JPS-100", vatClaimable: true },
  { name: "เครื่องเขียน/อุปกรณ์สำนักงาน", glCode: "5210320", sku: "JPS-100", vatClaimable: true },
  { name: "วัสดุก่อสร้าง", glCode: "5210350", sku: "JPS-103", vatClaimable: true },
  { name: "ค่าจ้าง/บริการทั่วไป", glCode: "5210430", sku: "JPS-101", vatClaimable: true, wht: 3 },
  { name: "ค่าทำบัญชี", glCode: "5210180", sku: "JPS-101", vatClaimable: true, wht: 3 },
  { name: "ค่าสอบบัญชี", glCode: "5210190", sku: "JPS-101", vatClaimable: true, wht: 3 },
  { name: "ค่าที่ปรึกษา", glCode: "5210290", sku: "JPS-101", vatClaimable: true, wht: 3 },
  { name: "ค่าธรรมเนียมธนาคาร", glCode: "5210220", sku: "JPS-101", vatClaimable: false, note: "ไม่มี VAT" },
  { name: "ภาษีป้าย", glCode: "5210270", sku: "JPS-101", vatClaimable: false, note: "ไม่มี VAT" },
  { name: "ค่ารับรอง", glCode: "5901200", sku: "JPS-101", vatClaimable: false, note: "ห้ามขอคืน VAT เด็ดขาด (ม.65 ทวิ)" },
  { name: "ค่าใช้จ่ายเบ็ดเตล็ด", glCode: "5210450", sku: "JPS-101", vatClaimable: false, note: "พิจารณาแต่ละรายการ" },
];

/** รายการบัญชีค่าใช้จ่ายทั้งหมด (สำหรับ dropdown เลือกรหัส) — รหัส + ชื่อ. */
export const EXPENSE_ACCOUNTS: { code: string; name: string }[] = [
  ...STANDARD_CATEGORIES.map((c) => ({ code: c.glCode, name: c.name })),
  { code: SYSTEM_ACCOUNTS.fallback.code, name: SYSTEM_ACCOUNTS.fallback.name },
  { code: SYSTEM_ACCOUNTS.inputVatNonClaimable.code, name: SYSTEM_ACCOUNTS.inputVatNonClaimable.name },
];

const NAME_BY_CODE = new Map(EXPENSE_ACCOUNTS.map((a) => [a.code, a.name]));

/** รหัสบัญชี → ชื่อบัญชี (คืน null ถ้าไม่รู้จัก). */
export function accountName(code: string | null | undefined): string | null {
  if (!code) return null;
  return NAME_BY_CODE.get(code.trim()) ?? null;
}
