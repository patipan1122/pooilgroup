// RentSpace — fill a contract template/custom-terms HTML with the real contract
// data. Placeholders: {{tenantName}} {{unitCode}} {{rentAmount}} {{startDate}}
// {{endDate}} {{depositAmount}} {{projectName}} {{today}}
//   + {{depositMonths}} {{rentDueDay}} {{landlordName}} {{bankInfo}}
// PURE + client-importable (only uses lib/rentspace/format helpers).
import { formatBaht, thaiDateLong, toNum, tenantDisplayName } from "@/lib/rentspace/format";

/** Optional bank/landlord info on the project — all fields optional so existing
 *  callers (which don't pass these) keep working unchanged. */
type ProjectLike = {
  name: string;
  billCompanyName?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountHolder?: string | null;
};

type ContractLike = {
  rentAmountThb: unknown;
  depositAmountThb: unknown;
  depositMonths?: unknown;
  rentDueDay?: number | null;
  startDate: Date | string;
  endDate?: Date | string | null;
  /** "ทำ ณ วันที่" — ถ้ามีจะใช้แทนวันนี้ในตัวแปร {{today}} (รองรับสัญญาย้อนหลัง) */
  madeOn?: Date | string | null;
  unit: { code: string; name?: string | null };
  tenant: Parameters<typeof tenantDisplayName>[0];
  project: ProjectLike;
  template?: { bodyHtml: string } | null;
  customTermsHtml?: string | null;
};

/** ข้อสัญญามาตรฐาน: ภาษีที่ดิน/สิ่งปลูกสร้าง + ค่าส่วนกลาง — ใช้ในแม่แบบ/พรีวิว */
export const LAND_TAX_CLAUSE =
  "ผู้เช่าตกลงรับผิดชอบภาษีที่ดินและสิ่งปลูกสร้าง รวมถึงค่าใช้จ่ายส่วนกลางตามที่ผู้ให้เช่ากำหนด " +
  "ตลอดอายุสัญญา หากมีการเปลี่ยนแปลงอัตราภาษีหรือค่าส่วนกลางตามประกาศของทางราชการหรือผู้ให้เช่า " +
  "ผู้เช่าตกลงชำระตามอัตราที่ปรับใหม่ภายในกำหนดเวลาที่ผู้ให้เช่าแจ้ง";

/** ประกอบบรรทัดข้อมูลบัญชีรับชำระจาก field โครงการ (ถ้ามี) */
export function bankInfoLine(p: ProjectLike): string {
  const parts: string[] = [];
  if (p.bankName) parts.push(`ธนาคาร${p.bankName}`);
  if (p.bankAccountNo) parts.push(`เลขบัญชี ${p.bankAccountNo}`);
  if (p.bankAccountHolder) parts.push(`ชื่อบัญชี ${p.bankAccountHolder}`);
  return parts.join(" ");
}

export function contractPlaceholders(c: ContractLike): Record<string, string> {
  const depMonths = toNum(c.depositMonths);
  return {
    tenantName: tenantDisplayName(c.tenant),
    unitCode: c.unit.name ? `${c.unit.code} (${c.unit.name})` : c.unit.code,
    rentAmount: formatBaht(toNum(c.rentAmountThb)),
    startDate: thaiDateLong(c.startDate),
    endDate: c.endDate ? thaiDateLong(c.endDate) : "ไม่มีกำหนด",
    depositAmount: formatBaht(toNum(c.depositAmountThb)),
    depositMonths: depMonths > 0 ? `${depMonths}` : "—",
    rentDueDay: c.rentDueDay != null ? `${c.rentDueDay}` : "—",
    projectName: c.project.name,
    landlordName: c.project.billCompanyName?.trim() || c.project.name,
    bankInfo: bankInfoLine(c.project),
    today: thaiDateLong(c.madeOn ?? new Date()),
  };
}

/** Replace every {{key}} in the html with its value (global). */
export function fillPlaceholders(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m,
  );
}

/** Resolve the document body for a contract: custom terms > template > fallback. */
export function resolveContractBody(c: ContractLike): string {
  const raw = c.customTermsHtml?.trim() || c.template?.bodyHtml?.trim() || "";
  if (!raw) return "";
  return fillPlaceholders(raw, contractPlaceholders(c));
}

// =============================================================
// ContractDocData — รูปทรงกลางของ "เอกสารสัญญาฉบับเต็ม" ที่ใช้ร่วมกันทุกที่
// (พรีวิวใน wizard · เอกสาร A4 หน้ารายละเอียด · หน้าเซ็นออนไลน์) → RULE I "ไปทางเดียวกัน"
// ค่าเป็น raw (ตัวเลข/วันที่) — component เป็นคนจัดรูปแบบ (กันสูตรเพี้ยนคนละที่)
// =============================================================
export type ContractDocData = {
  contractNo?: string | null;
  /** "ทำ ณ วันที่" — null = ให้ component ใช้วันนี้ */
  madeOn?: Date | string | null;
  projectName: string;
  lessorName: string;
  lessorAddress?: string | null;
  /** ชื่อผู้เช่าที่แสดงจริง — "" = ยังไม่เลือก (component โชว์ placeholder) */
  tenantName: string;
  tenantIdMasked?: string | null;
  tenantPhone?: string | null;
  unitCode: string;
  unitName?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  rentDueDay?: number | null;
  rentAmountThb: number;
  vatPercent?: number;
  depositAmountThb: number;
  depositMonths?: number;
  electricRate?: number | null;
  waterRate?: number | null;
  lateFee?: { type: string; value: number; graceDays: number } | null;
  /** ส่วนลดโปรโมชั่น: ลด perMonth บาท/เดือน เป็นเวลา months เดือน เริ่ม startPeriod (YYYY-MM) */
  promo?: { perMonth: number; months: number; startPeriod?: string | null } | null;
  rentSchedule?: { fromPeriod: string; amount: number }[];
  bankLine?: string | null;
  promptpayId?: string | null;
  paymentNote?: string | null;
  /** เนื้อสัญญาที่ผู้ดูแลกำหนดเอง (เติมตัวแปรแล้ว) — ถ้ามีจะแทนข้อสัญญามาตรฐาน */
  customBodyHtml?: string | null;
  /** ป้ายชื่อเอกสารแนบ (นอกเหนือจากสำเนาบัตร) */
  attachments?: string[];
  signature?: {
    signed: boolean;
    dataUrl?: string | null;
    signerName?: string | null;
    signedAt?: Date | string | null;
  } | null;
};

/** mask an id-card / tax id → show only last 4 digits (shared helper) */
export function maskIdCard(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return raw;
  return `${"x".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

type ContractRecordLike = ContractLike & {
  contractNo?: string | null;
  contractDate?: Date | string | null;
  createdAt?: Date | string | null;
  rentDueDay?: number | null;
  vatPercent?: unknown;
  electricRate?: unknown;
  waterRate?: unknown;
  lateFeeType?: string | null;
  lateFeeValue?: unknown;
  lateFeeGraceDays?: number | null;
  promoDiscountThb?: unknown;
  promoMonths?: number | null;
  promoStartPeriod?: string | null;
  rentSchedule?: unknown;
  tenantSigned?: boolean;
  signatureDataUrl?: string | null;
  signerName?: string | null;
  signedAt?: Date | string | null;
  tenant: {
    bizName?: string | null;
    prefix?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    nickname?: string | null;
    phones?: string[] | null;
    idCardNo?: string | null;
    taxId?: string | null;
  };
  project: ProjectLike & {
    address?: string | null;
    promptpayId?: string | null;
    paymentNote?: string | null;
    electricRate?: unknown;
    waterRate?: unknown;
  };
};

/** สร้าง ContractDocData จาก record ในฐานข้อมูล (หน้า detail / sign) */
export function docDataFromContract(
  c: ContractRecordLike,
  opts?: { attachments?: string[] },
): ContractDocData {
  const madeOn = c.contractDate ?? c.createdAt ?? null;
  const elec = c.electricRate != null ? toNum(c.electricRate) : toNum(c.project.electricRate);
  const water = c.waterRate != null ? toNum(c.waterRate) : toNum(c.project.waterRate);
  const promoMonths = c.promoMonths ?? 0;
  const promoPer = toNum(c.promoDiscountThb);
  return {
    contractNo: c.contractNo ?? null,
    madeOn,
    projectName: c.project.name,
    lessorName: c.project.billCompanyName?.trim() || c.project.name,
    lessorAddress: c.project.address ?? null,
    tenantName: tenantDisplayName(c.tenant),
    tenantIdMasked: maskIdCard(c.tenant.idCardNo ?? c.tenant.taxId),
    tenantPhone: c.tenant.phones?.[0] ?? null,
    unitCode: c.unit.code,
    unitName: c.unit.name ?? null,
    startDate: c.startDate,
    endDate: c.endDate ?? null,
    rentDueDay: c.rentDueDay ?? null,
    rentAmountThb: toNum(c.rentAmountThb),
    vatPercent: toNum(c.vatPercent),
    depositAmountThb: toNum(c.depositAmountThb),
    depositMonths: toNum(c.depositMonths),
    electricRate: elec || null,
    waterRate: water || null,
    lateFee:
      c.lateFeeType && c.lateFeeType !== "none"
        ? { type: c.lateFeeType, value: toNum(c.lateFeeValue), graceDays: c.lateFeeGraceDays ?? 0 }
        : null,
    promo:
      promoMonths > 0 && promoPer > 0
        ? { perMonth: promoPer, months: promoMonths, startPeriod: c.promoStartPeriod ?? null }
        : null,
    rentSchedule: Array.isArray(c.rentSchedule)
      ? (c.rentSchedule as { fromPeriod: string; amount: number }[])
      : [],
    bankLine: bankInfoLine(c.project) || null,
    promptpayId: c.project.promptpayId ?? null,
    paymentNote: c.project.paymentNote ?? null,
    customBodyHtml: resolveContractBody({ ...c, madeOn }) || null,
    attachments: opts?.attachments ?? [],
    signature: {
      signed: !!c.tenantSigned,
      dataUrl: c.signatureDataUrl ?? null,
      signerName: c.signerName ?? null,
      signedAt: c.signedAt ?? null,
    },
  };
}
