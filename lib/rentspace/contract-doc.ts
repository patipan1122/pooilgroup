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
    today: thaiDateLong(new Date()),
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
