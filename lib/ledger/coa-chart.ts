// ผังบัญชีมาตรฐาน LedgerLine (JP Sync) — source of truth เดียวสำหรับหน้าตั้งค่าหมวดค่าใช้จ่าย.
// ข้อมูลทั้งหมด "นักบัญชี JP Sync รับรองแล้ว" (docs/LEDGERLINE_TRCLOUD_REFERENCE.md).
// ใช้ป้อน: dropdown เลือกรหัสบัญชี · lookup รหัส→ชื่อ · seed 20 หมวดมาตรฐาน · preview Dr/Cr.
// ⚠️ ห้ามแก้รหัส GL โดยไม่ปรึกษาสำนักงานบัญชี.

import { COA_NAMES } from "@/lib/ledger/coa-names.generated";

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

/** รหัสบัญชี → ชื่อบัญชี (คืน null ถ้าไม่รู้จักเลย).
 *  ลำดับ: ชื่อหมวดของเรา (business-friendly) ก่อน → ผังบัญชีเต็มจาก TRCloud (456 บัญชี) เป็น fallback.
 *  → journal จริง (Dr/Cr) ทุกรหัสจึงมีชื่อกำกับ ไม่ใช่แค่ 21 หมวดที่เราตั้งเอง. */
export function accountName(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim();
  return NAME_BY_CODE.get(c) ?? COA_NAMES[c] ?? null;
}

// ── สูตร "LL" (LedgerLine) — 1 สูตรลงบัญชีต่อหมวดด้วย "ช่อง c" ────────────────────
// ใบ AP ส่ง type:"LL" + ค่าเข้าช่อง cN → TRCloud ลง Dr [บัญชีของช่องนั้น] อัตโนมัติ.
// ⚠️ ตารางนี้ต้องตรงกับสูตร "LL" ที่สร้างใน TRCloud เป๊ะ (แถว [glCode → cN]).
//   c1..c21 = 21 หมวดค่าใช้จ่าย (ตามลำดับ STANDARD_CATEGORIES ด้านบน · index 0 = c1)
//   c22 = ภาษีซื้อขอคืนได้ (1432000) · c23 = ภาษีซื้อขอคืนไม่ได้ (5911100)
//   แถวที่เหลือใช้ตัวแปรมาตรฐาน: grand_total→เจ้าหนี้ 2101000 · wht→2325300 · discount→5101500
export const LL_SLOT_VAT_CLAIMABLE = "c22";
export const LL_SLOT_VAT_NONCLAIM = "c23";

/** glCode ของหมวด → ช่อง cN. คืน null ถ้าไม่ใช่หมวดมาตรฐาน (→ fallback สูตรเดิม). */
export const LL_CSLOT_BY_GL: Record<string, string> = Object.fromEntries(
  STANDARD_CATEGORIES.map((c, i) => [c.glCode, `c${i + 1}`]),
);
export function llCSlotForGl(glCode: string | null | undefined): string | null {
  if (!glCode) return null;
  return LL_CSLOT_BY_GL[glCode.trim()] ?? null;
}

/** สเปคแถวสูตร "LL" สำหรับให้นักบัญชีสร้างใน TRCloud (debug/print). */
export const LL_FORMULA_ROWS: { acc: string; variable: string; side: "Dr" | "Cr"; name: string }[] = [
  ...STANDARD_CATEGORIES.map((c, i) => ({ acc: c.glCode, variable: `c${i + 1}`, side: "Dr" as const, name: c.name })),
  { acc: SYSTEM_ACCOUNTS.inputVat.code, variable: LL_SLOT_VAT_CLAIMABLE, side: "Dr", name: "ภาษีซื้อ (ขอคืนได้)" },
  { acc: SYSTEM_ACCOUNTS.inputVatNonClaimable.code, variable: LL_SLOT_VAT_NONCLAIM, side: "Dr", name: "ภาษีซื้อ (ขอคืนไม่ได้)" },
  { acc: SYSTEM_ACCOUNTS.payable.code, variable: "grand_total", side: "Cr", name: "เจ้าหนี้การค้า" },
  { acc: "2325300", variable: "wht", side: "Cr", name: "ภาษีหัก ณ ที่จ่าย ภงด.53" },
  { acc: "5101500", variable: "discount", side: "Cr", name: "ส่วนลดรับ" },
];
