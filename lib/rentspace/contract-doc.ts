// RentSpace — fill a contract template/custom-terms HTML with the real contract
// data. Placeholders: {{tenantName}} {{unitCode}} {{rentAmount}} {{startDate}}
// {{endDate}} {{depositAmount}} {{projectName}} {{today}}
//   + {{depositMonths}} {{rentDueDay}} {{landlordName}} {{bankInfo}}
// PURE + client-importable (only uses lib/rentspace/format helpers).
import { formatBaht, thaiDateLong, toNum, tenantDisplayName, bahtText } from "@/lib/rentspace/format";

/** Optional bank/landlord info on the project — all fields optional so existing
 *  callers (which don't pass these) keep working unchanged. */
type ProjectLike = {
  name: string;
  billCompanyName?: string | null;
  billTaxId?: string | null;
  billAddress?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountHolder?: string | null;
  address?: string | null;
  electricRate?: unknown;
  waterRate?: unknown;
  vatOnRent?: boolean | null;
  vatOnElectric?: boolean | null;
  vatOnWater?: boolean | null;
};

/** ค่ารายเดือน (per-contract) — ใช้สร้างตารางเงินในสัญญา (kind: land_tax|common_fee|waste|other) */
export type RecurringChargeLike = {
  kind: string;
  label: string;
  amountThb: unknown;
  vatable: boolean;
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
  contractDate?: Date | string | null;
  contractNo?: string | null;
  vatPercent?: unknown;
  vatOnRent?: boolean | null;
  vatOnElectric?: boolean | null;
  vatOnWater?: boolean | null;
  electricRate?: unknown;
  waterRate?: unknown;
  lateFeeType?: string | null;
  lateFeeValue?: unknown;
  lateFeeGraceDays?: number | null;
  promoDiscountThb?: unknown;
  promoMonths?: number | null;
  note?: string | null;
  // ── ช่องกรอกแม่แบบสัญญามาตรฐาน ──
  businessType?: string | null;
  tradeName?: string | null;
  renewalNoticeDays?: number | null;
  terminationNoticeDays?: number | null;
  fitOutFreeDays?: number | null;
  buildingModifications?: string | null;
  witness2Name?: string | null;
  /** ค่ารายเดือนของสัญญานี้ (per-contract) — ใช้สร้าง {{monthlyChargesTable}} */
  recurringCharges?: RecurringChargeLike[];
  unit: { code: string; name?: string | null; areaSqm?: unknown; zone?: string | null };
  tenant: Parameters<typeof tenantDisplayName>[0] & {
    idCardNo?: string | null;
    taxId?: string | null;
    address?: string | null;
    phones?: string[] | null;
    authorizedSignerName?: string | null;
    authorizedSignerPhone?: string | null;
  };
  project: ProjectLike;
  template?: { bodyHtml: string } | null;
  customTermsHtml?: string | null;
};

/** ป้ายค่าปรับล่าช้าแบบสั้น (ใช้ในตัวแปร {{lateFee}}) */
function lateFeeText(type?: string | null, value?: unknown): string {
  const v = toNum(value);
  if (!type || type === "none") return "ไม่คิดค่าปรับ";
  if (type === "fixed") return `${formatBaht(v)} บาท/ครั้ง`;
  if (type === "percent_total") return `${v}% ของยอดค้าง`;
  if (type === "per_day") return `${formatBaht(v)} บาท/วัน`;
  return "—";
}

/** รายการตัวแปรที่ใช้ในแม่แบบสัญญาได้ (แหล่งความจริงเดียว — ใช้ทั้งหน้าแม่แบบและ wizard) */
export const TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: "tenantName", label: "ชื่อผู้เช่า" },
  { key: "tenantIdCard", label: "เลขบัตร/ภาษีผู้เช่า" },
  { key: "tenantAddress", label: "ที่อยู่ผู้เช่า" },
  { key: "tenantPhone", label: "เบอร์ผู้เช่า" },
  { key: "unitCode", label: "ห้อง/ยูนิต" },
  { key: "rentAmount", label: "ค่าเช่า/เดือน" },
  { key: "depositAmount", label: "เงินประกัน" },
  { key: "depositMonths", label: "จำนวนเดือนประกัน" },
  { key: "rentDueDay", label: "วันครบกำหนดชำระ" },
  { key: "electricRate", label: "ค่าไฟ/หน่วย" },
  { key: "waterRate", label: "ค่าน้ำ/หน่วย" },
  { key: "vatPercent", label: "VAT %" },
  { key: "lateFee", label: "ค่าปรับล่าช้า" },
  { key: "promoDiscount", label: "ส่วนลด/เดือน" },
  { key: "startDate", label: "วันเริ่มสัญญา" },
  { key: "endDate", label: "วันสิ้นสุด" },
  { key: "contractNo", label: "เลขที่สัญญา" },
  { key: "projectName", label: "ชื่อโครงการ" },
  { key: "landlordName", label: "ชื่อผู้ให้เช่า" },
  { key: "lessorAddress", label: "ที่อยู่ผู้ให้เช่า" },
  { key: "bankInfo", label: "บัญชีรับชำระ" },
  { key: "today", label: "วันที่ทำสัญญา" },
  // ── ตัวแปรแม่แบบมาตรฐาน (เพิ่ม 2026-07-21) ──
  { key: "contractDate", label: "วันที่ร่างสัญญา" },
  { key: "tenantTaxId", label: "เลขภาษีผู้เช่า (เต็ม)" },
  { key: "tenantSignerName", label: "ผู้ลงนามผู้เช่า" },
  { key: "tenantSignerPhone", label: "เบอร์ผู้ลงนาม" },
  { key: "businessType", label: "ประเภทกิจการ" },
  { key: "tradeName", label: "ชื่อทางการค้า" },
  { key: "unitAreaSqm", label: "ขนาดพื้นที่ (ตร.ม.)" },
  { key: "unitLocation", label: "ที่ตั้งพื้นที่เช่า" },
  { key: "termYears", label: "ระยะเวลาเช่า (ปี)" },
  { key: "renewalNoticeDays", label: "แจ้งต่อสัญญา (วัน)" },
  { key: "terminationNoticeDays", label: "แจ้งเลิก (วัน)" },
  { key: "fitOutFreeDays", label: "ปลอดค่าเช่าตกแต่ง (วัน)" },
  { key: "depositAmountText", label: "เงินประกัน (ตัวอักษร)" },
  { key: "rentAmountText", label: "ค่าเช่า (ตัวอักษร)" },
  { key: "lateFeePerDay", label: "ค่าปรับล่าช้า/วัน" },
  { key: "discountNote", label: "หมายเหตุส่วนลด" },
  { key: "buildingModifications", label: "รายการปรับแต่งอาคาร" },
  { key: "monthlyChargesTable", label: "ตารางค่าใช้จ่ายรายเดือน" },
  { key: "landlordTaxId", label: "เลขภาษีผู้ให้เช่า" },
  { key: "landlordAddress", label: "ที่อยู่ผู้ให้เช่า" },
  { key: "witness2Name", label: "พยาน (ผู้เช่า)" },
];

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

/** escape ค่าจากผู้ใช้/DB ก่อนฝังใน HTML (กัน XSS ในเอกสารสัญญา — body เป็น trusted, values ไม่ใช่) */
function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** จำนวนปีของสัญญา (ประมาณจากวันเริ่ม–สิ้นสุด) — ปัดเป็นจำนวนเต็มถ้าใกล้ปีพอดี */
function termYearsText(start: Date | string, end?: Date | string | null): string {
  if (!end) return "ไม่มีกำหนด";
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return "—";
  const years = (e - s) / (365.25 * 86400000);
  const rounded = Math.round(years);
  return Math.abs(years - rounded) < 0.06 ? `${rounded}` : years.toFixed(1);
}

/** config VAT รายรายการของสัญญา (override รายห้อง → ค่าเริ่มต้นโครงการ) — ให้ตรง billing.vatableConfig */
function vatCfg(c: ContractLike): { rent: boolean; electric: boolean; water: boolean } {
  return {
    rent: c.vatOnRent ?? c.project.vatOnRent ?? false,
    electric: c.vatOnElectric ?? c.project.vatOnElectric ?? false,
    water: c.vatOnWater ?? c.project.vatOnWater ?? false,
  };
}

/**
 * ตารางค่าใช้จ่ายรายเดือน (HTML) — สร้างตอนเติมค่า เพราะเครื่องเติม {{}} วนลูปไม่ได้.
 * แต่ละบรรทัดมีสถานะภาษีของตัวเอง → ตรงกับที่ buildBill คิดจริง
 * (ค่าเช่ายกเว้น VAT · น้ำ/ไฟ/ส่วนกลางคิด VAT ตาม vatable · land_tax ส่งต่อ).
 */
export function buildMonthlyChargesTable(c: ContractLike): string {
  const vat = toNum(c.vatPercent);
  const cfg = vatCfg(c);
  const rent = toNum(c.rentAmountThb);
  const elec = toNum(c.electricRate) || toNum(c.project.electricRate);
  const water = toNum(c.waterRate) || toNum(c.project.waterRate);
  const vatTag = (vatable: boolean) => (vatable && vat > 0 ? `+ VAT ${vat}%` : "ยกเว้น VAT");
  const rows: string[] = [];
  const row = (label: string, amount: string, unit: string, tax: string, cls = "") =>
    `<tr${cls ? ` class="${cls}"` : ""}><td>${label}</td><td class="amt">${amount}</td>` +
    `<td class="unit">${esc(unit)}</td><td class="tax">${esc(tax)}</td></tr>`;

  rows.push(
    row(
      `ค่าเช่าพื้นที่ <span class="words">(${esc(bahtText(rent))})</span>`,
      esc(formatBaht(rent)),
      "บาท/เดือน",
      `${cfg.rent && vat > 0 ? `+ VAT ${vat}%` : "ยกเว้น VAT (ม.81(1)(ต))"} · หัก ณ ที่จ่าย 5%`,
    ),
  );
  if (elec > 0)
    rows.push(row("ค่าไฟฟ้า", esc(formatBaht(elec)), "บาท/หน่วย", cfg.electric ? vatTag(true) : "—"));
  if (water > 0)
    rows.push(row("ค่าน้ำประปา", esc(formatBaht(water)), "บาท/หน่วย", cfg.water ? vatTag(true) : "—"));

  for (const ch of c.recurringCharges ?? []) {
    const amt = toNum(ch.amountThb);
    if (amt === 0) continue;
    const wht = ch.kind === "land_tax" ? "" : " · หัก ณ ที่จ่าย 3%";
    const tax = ch.vatable ? `${vatTag(true)}${wht}` : "ยกเว้น VAT (ส่งต่อ)";
    rows.push(row(esc(ch.label), esc(formatBaht(amt)), "บาท/เดือน", tax));
  }

  const promo = toNum(c.promoDiscountThb);
  if (promo > 0) rows.push(row("ส่วนลด", `-${esc(formatBaht(promo))}`, "บาท/เดือน", "—", "disc"));

  return (
    `<table class="rslease-charges"><thead><tr>` +
    `<th>รายการ</th><th class="amt">อัตรา</th><th>หน่วย</th><th>สถานะภาษี</th>` +
    `</tr></thead><tbody>${rows.join("")}</tbody></table>`
  );
}

export function contractPlaceholders(c: ContractLike): Record<string, string> {
  const depMonths = toNum(c.depositMonths);
  const elec = toNum(c.electricRate) || toNum(c.project.electricRate);
  const water = toNum(c.waterRate) || toNum(c.project.waterRate);
  const vat = toNum(c.vatPercent);
  const promo = toNum(c.promoDiscountThb);
  const rent = toNum(c.rentAmountThb);
  const deposit = toNum(c.depositAmountThb);
  const madeOn = c.contractDate ?? c.madeOn ?? new Date();
  const lateDay = c.lateFeeType === "per_day" ? toNum(c.lateFeeValue) : 0;
  return {
    // ── ผู้เช่า ──
    tenantName: esc(tenantDisplayName(c.tenant)),
    tenantIdCard: esc(maskIdCard(c.tenant.idCardNo ?? c.tenant.taxId) ?? "—"),
    tenantTaxId: esc(c.tenant.taxId ?? c.tenant.idCardNo ?? "—"),
    tenantAddress: esc(c.tenant.address ?? "—"),
    tenantPhone: esc(c.tenant.phones?.[0] ?? "—"),
    tenantSignerName: esc(c.tenant.authorizedSignerName ?? "—"),
    tenantSignerPhone: esc(c.tenant.authorizedSignerPhone ?? c.tenant.phones?.[0] ?? "—"),
    // ── พื้นที่/ยูนิต ──
    unitCode: esc(c.unit.name ? `${c.unit.code} (${c.unit.name})` : c.unit.code),
    unitAreaSqm: esc(toNum(c.unit.areaSqm) > 0 ? `${toNum(c.unit.areaSqm)}` : "____"),
    unitLocation: esc(c.project.address ?? c.project.billAddress ?? "____"),
    // ── ข้อ 2: วัตถุประสงค์/ระยะเวลา ──
    businessType: esc(c.businessType ?? "____"),
    tradeName: esc(c.tradeName ?? "____"),
    termYears: esc(termYearsText(c.startDate, c.endDate)),
    startDate: esc(thaiDateLong(c.startDate)),
    endDate: esc(c.endDate ? thaiDateLong(c.endDate) : "ไม่มีกำหนด"),
    renewalNoticeDays: esc(c.renewalNoticeDays != null ? `${c.renewalNoticeDays}` : "30"),
    terminationNoticeDays: esc(c.terminationNoticeDays != null ? `${c.terminationNoticeDays}` : "60"),
    fitOutFreeDays: esc(c.fitOutFreeDays != null ? `${c.fitOutFreeDays}` : "30"),
    // ── เงิน ──
    depositAmount: esc(formatBaht(deposit)),
    depositAmountText: esc(bahtText(deposit)),
    depositMonths: depMonths > 0 ? `${depMonths}` : "—",
    rentAmount: esc(formatBaht(rent)),
    rentAmountText: esc(bahtText(rent)),
    rentDueDay: c.rentDueDay != null ? `${c.rentDueDay}` : "—",
    electricRate: elec > 0 ? esc(formatBaht(elec)) : "—",
    waterRate: water > 0 ? esc(formatBaht(water)) : "—",
    vatPercent: vat > 0 ? `${vat}` : "0",
    lateFee: esc(lateFeeText(c.lateFeeType, c.lateFeeValue)),
    lateFeePerDay: esc(lateDay > 0 ? formatBaht(lateDay) : "____"),
    promoDiscount: promo > 0 ? esc(formatBaht(promo)) : "—",
    discountNote: esc(c.note?.trim() ? c.note : "—"),
    // ── ข้อ 6: การส่งมอบ ──
    buildingModifications: esc(c.buildingModifications?.trim() ? c.buildingModifications : "—"),
    witness2Name: esc(c.witness2Name ?? ""),
    // ── ตารางเงิน (HTML ที่เชื่อถือได้ — ไม่ต้อง esc) ──
    monthlyChargesTable: buildMonthlyChargesTable(c),
    // ── หัวเอกสาร / โครงการ / ผู้ให้เช่า ──
    contractNo: esc(c.contractNo ?? "—"),
    contractDate: esc(thaiDateLong(madeOn)),
    projectName: esc(c.project.name),
    landlordName: esc(c.project.billCompanyName?.trim() || c.project.name),
    landlordTaxId: esc(c.project.billTaxId ?? "—"),
    landlordAddress: esc(c.project.billAddress ?? c.project.address ?? "—"),
    landlordPhone: "—",
    landlordSignerName: "",
    landlordSignerBirthdate: "—",
    witness1Name: "",
    lessorAddress: esc(c.project.address ?? "—"),
    bankInfo: esc(bankInfoLine(c.project)),
    today: esc(thaiDateLong(madeOn)),
  };
}

/** Replace every {{key}} in the html with its value (global). */
export function fillPlaceholders(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m,
  );
}

/**
 * แม่แบบสัญญาเช่าพื้นที่มาตรฐาน (ข้อ 1-9) — ตรวจกฎหมาย/ภาษีแล้ว (CEO อนุมัติ 2026-07-21):
 * VAT ค่าเช่ายกเว้น · ไม่ล็อกห้อง/ตัดน้ำไฟเอง · เงินประกันหักเท่าเสียหายจริง · +เหตุสุดวิสัย/กม.บังคับ.
 * ใช้เป็น body เริ่มต้น (custom terms > template DB > อันนี้). header/parties/ลายเซ็น มาจาก RentalContractDocument.
 * <style> ฝังในตัว (scoped .rslease) → หน้าตาเดียวกันทุกที่ (A4/พรีวิว/เซ็น) โดยไม่ต้องแก้ CSS หลายจุด.
 */
export const STANDARD_LEASE_BODY = `<style>
.rslease{line-height:1.75;color:#111}
.rslease .clause{margin:0 0 13px}
.rslease .clause h3{font-size:14.5px;font-weight:800;margin:0 0 5px;color:#111}
.rslease .clause p{margin:0 0 7px;text-align:justify}
.rslease .l2-head{font-weight:700;margin-top:3px}
.rslease ol.sub{margin:5px 0 4px;padding-left:20px}
.rslease ol.sub>li{margin-bottom:4px;text-align:justify}
.rslease .f{font-weight:600}
.rslease table.rslease-charges{width:100%;border-collapse:collapse;margin:8px 0 10px;font-size:13px;border:1px solid #ccc}
.rslease .rslease-charges th{background:#f1f3f9;text-align:left;padding:6px 9px;font-size:12px;font-weight:700;border:1px solid #ddd}
.rslease .rslease-charges th.amt,.rslease .rslease-charges td.amt{text-align:right}
.rslease .rslease-charges td{padding:6px 9px;border:1px solid #e3e3e3;vertical-align:top}
.rslease .rslease-charges td.amt{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.rslease .rslease-charges td.unit{color:#555;white-space:nowrap}
.rslease .rslease-charges td.tax{color:#555;font-size:12px}
.rslease .rslease-charges tr.disc td{color:#0a7d46}
.rslease .rslease-charges .words{color:#666;font-size:11.5px;font-weight:400}
.rslease .sign-note{margin:16px 0 0;font-size:12.5px;color:#555;border-top:1px dashed #ccc;padding-top:10px}
.rslease .sign-note .note-head{font-weight:700;color:#333;margin:0 0 5px}
.rslease .sign-note ul{margin:0;padding-left:18px}
.rslease .sign-note li{margin-bottom:3px}
@media print{.rslease .clause,.rslease table.rslease-charges,.rslease .sign-note{break-inside:avoid}.rslease .clause h3{break-after:avoid}}
</style>
<div class="rslease">
<section class="clause">
  <h3>ข้อ 1. สถานที่เช่า</h3>
  <p>ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่าพื้นที่ รหัสล็อก <span class="f">{{unitCode}}</span> ขนาดพื้นที่ <span class="f">{{unitAreaSqm}}</span> ตารางเมตร ตั้งอยู่ที่ {{unitLocation}} (ต่อไปเรียกว่า "พื้นที่เช่า") ผู้เช่าตกลงใช้ประโยชน์เฉพาะภายในพื้นที่เช่าเท่านั้น</p>
</section>
<section class="clause">
  <h3>ข้อ 2. วัตถุประสงค์ กฎระเบียบ และระยะเวลาการเช่า</h3>
  <p>2.1 ผู้เช่าตกลงใช้พื้นที่เช่าเพื่อประกอบกิจการประเภท <span class="f">{{businessType}}</span> ภายใต้ชื่อทางการค้า <span class="f">{{tradeName}}</span> การเปลี่ยนแปลงวัตถุประสงค์หรือชื่อทางการค้าต้องได้รับความยินยอมเป็นหนังสือจากผู้ให้เช่าก่อน</p>
  <p>2.2 ผู้เช่าต้องใช้พื้นที่เช่าให้ชอบด้วยกฎหมาย ผังเมือง และใบอนุญาตที่เกี่ยวข้อง และรับรองว่าประเภทกิจการข้างต้นได้รับอนุญาตให้ประกอบการในทำเลนี้ ผู้เช่าเป็นผู้รับผิดชอบขอและคงไว้ซึ่งใบอนุญาตที่จำเป็นทั้งหมด</p>
  <p>2.3 ระยะเวลาเช่ามีกำหนด <span class="f">{{termYears}}</span> ปี เริ่มตั้งแต่ <span class="f">{{startDate}}</span> ถึง <span class="f">{{endDate}}</span> (ต่อไปเรียกว่า "อายุสัญญา") หากประสงค์จะต่ออายุสัญญา ผู้เช่าต้องแจ้งเป็นหนังสือก่อนสิ้นอายุสัญญาอย่างน้อย <span class="f">{{renewalNoticeDays}}</span> วัน ทั้งนี้ การต่อสัญญาที่ทำให้ระยะเวลารวมเกิน 3 ปี ต้องนำสัญญาไปจดทะเบียนการเช่า ณ สำนักงานที่ดิน ตามประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 538</p>
  <p class="l2-head">2.4 ระเบียบปฏิบัติที่ผู้เช่าต้องถือปฏิบัติ</p>
  <ol class="sub">
    <li>ห้ามหยุดประกอบกิจการเกิน 10 วันต่อเดือน เว้นแต่ได้รับอนุญาตเป็นหนังสือ</li>
    <li>ตกแต่งพื้นที่เช่าตามแบบที่ยื่นและได้รับอนุมัติจากผู้ให้เช่า</li>
    <li>ดูแลรักษาความสะอาดภายในและบริเวณโดยรอบพื้นที่เช่า</li>
    <li>ทิ้งขยะ ณ จุดที่ผู้ให้เช่ากำหนด</li>
    <li>แจ้งป้ายทะเบียนรถและจอดรถ ณ จุดที่กำหนดสำหรับผู้ประกอบการ</li>
    <li>ปฏิบัติตามมาตรการความปลอดภัยและการประกันภัยของโครงการ</li>
    <li>พนักงานของผู้เช่าต้องแต่งกายสุภาพเหมาะสม</li>
  </ol>
</section>
<section class="clause">
  <h3>ข้อ 3. เงินประกันตามสัญญา</h3>
  <p>3.1 ในวันทำสัญญา ผู้เช่าตกลงวางเงินประกันแก่ผู้ให้เช่า เป็นเงินค่าประกันสัญญาจำนวน <span class="f">{{depositAmount}}</span> บาท (<span class="f">{{depositAmountText}}</span>) ผู้เช่าจะนำเงินประกันไปหักชำระค่าเช่าเดือนสุดท้ายหรือหนี้อื่นเองไม่ได้ เมื่อสัญญาสิ้นสุดและผู้เช่าส่งมอบพื้นที่คืนในสภาพเรียบร้อยแล้ว ผู้ให้เช่าจะคืนเงินประกันภายใน 60 วัน โดยหักได้เฉพาะค่าเสียหายหรือหนี้ค้างชำระที่เกิดขึ้นจริง ส่วนที่เหลือคืนแก่ผู้เช่าทั้งหมด</p>
  <p>3.2 ในการขอรับเงินประกันคืน ผู้เช่าควรนำใบเสร็จรับเงินและคู่ฉบับมาแสดง กรณีเอกสารสูญหาย ผู้เช่าสามารถยืนยันตัวตนหรือทำหนังสือรับรองแทนได้ โดยไม่ตัดสิทธิในการขอคืนเงินประกัน</p>
</section>
<section class="clause">
  <h3>ข้อ 4. ค่าตอบแทนการเช่า ค่าบริการ และการชำระเงิน</h3>
  <p>4.1 อัตราค่าเช่าและค่าบริการรายเดือน เป็นไปตามตารางดังต่อไปนี้</p>
  {{monthlyChargesTable}}
  <p>4.2 <strong>ภาษีมูลค่าเพิ่ม:</strong> ค่าเช่าอสังหาริมทรัพย์ได้รับยกเว้นภาษีมูลค่าเพิ่มตามมาตรา 81(1)(ต) แห่งประมวลรัษฎากร ผู้ให้เช่าจึงไม่เรียกเก็บภาษีมูลค่าเพิ่มในส่วนค่าเช่า สำหรับค่าไฟฟ้า ค่าน้ำ ค่าส่วนกลาง และค่าบริการอื่นที่อยู่ในบังคับภาษีมูลค่าเพิ่ม ผู้เช่าตกลงชำระภาษีมูลค่าเพิ่มอัตราร้อยละ <span class="f">{{vatPercent}}</span> เพิ่มจากราคาฐาน โดยผู้ให้เช่าจะออกใบกำกับภาษีให้ทุกงวด (เมื่อผู้ให้เช่าเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม)</p>
  <p>4.3 <strong>ภาษีหัก ณ ที่จ่าย:</strong> กรณีผู้เช่าเป็นนิติบุคคล ผู้เช่ามีหน้าที่หักภาษี ณ ที่จ่ายตามกฎหมาย — ค่าเช่าในอัตราร้อยละ 5 และค่าบริการส่วนกลางในอัตราร้อยละ 3 ส่วนค่าไฟฟ้าและค่าน้ำที่เรียกเก็บตามการใช้จริงไม่อยู่ในบังคับหักภาษี ณ ที่จ่าย โดยให้ถือว่าภาษีที่หักไว้เป็นส่วนหนึ่งของการชำระเงินตามสัญญา มิใช่การผิดนัดชำระ</p>
  <p>4.4 หมายเหตุ (ส่วนลด/เงื่อนไขอื่น): <span class="f">{{discountNote}}</span></p>
  <p>4.5 ผู้เช่าต้องชำระค่าเช่าและค่าบริการล่วงหน้าภายในวันที่ <span class="f">{{rentDueDay}}</span> ของแต่ละเดือน หากผิดนัดชำระ ผู้เช่ายอมให้คิดเบี้ยปรับวันละ <span class="f">{{lateFeePerDay}}</span> บาท นับแต่วันผิดนัดจนกว่าจะชำระครบถ้วน</p>
</section>
<section class="clause">
  <h3>ข้อ 5. ค่าใช้จ่าย ภาษี และอากรแสตมป์</h3>
  <p>5.1 ก่อนเข้าตกแต่ง ผู้เช่าต้องส่งแบบการออกแบบร้านให้ผู้ให้เช่าอนุมัติ ผู้ให้เช่าให้สิทธิปลอดค่าเช่าในช่วงตกแต่งไม่เกิน <span class="f">{{fitOutFreeDays}}</span> วัน</p>
  <p>5.2 ผู้เช่าเป็นผู้รับผิดชอบภาษีและค่าธรรมเนียมที่เกี่ยวข้องกับการประกอบกิจการของตน ได้แก่ ภาษีมูลค่าเพิ่ม ภาษีป้าย ภาษีที่ดินและสิ่งปลูกสร้าง (ตาม พ.ร.บ. ปี 2562) เท่าที่ตกลงให้ผลักภาระ และค่าอากรแสตมป์ตามข้อ 5.3</p>
  <p>5.3 <strong>อากรแสตมป์:</strong> สัญญาเช่าฉบับนี้ต้องปิดอากรแสตมป์ในอัตราร้อยละ 0.1 ของค่าเช่ารวมตลอดอายุสัญญา คู่สัญญาตกลงให้ผู้เช่าเป็นผู้รับผิดชอบค่าอากรแสตมป์ และปิดอากรพร้อมขีดฆ่าให้ครบถ้วนภายใน 15 วันนับแต่วันทำสัญญา</p>
</section>
<section class="clause">
  <h3>ข้อ 6. การส่งมอบและการรับคืนสถานที่เช่า</h3>
  <ol class="sub">
    <li>ผู้เช่าต้องเข้าใช้และพร้อมประกอบกิจการภายใน 30 วันนับแต่วันรับมอบพื้นที่</li>
    <li>ห้ามให้เช่าช่วง โอนสิทธิการเช่า หรือให้ผู้อื่นใช้ประโยชน์ในพื้นที่เช่า เว้นแต่ได้รับความยินยอมเป็นหนังสือ</li>
    <li>ผู้เช่ายินยอมให้ผู้ให้เช่าหรือตัวแทนเข้าตรวจสอบสถานที่เช่าในเวลาอันสมควร</li>
    <li>ผู้เช่ารับมอบพื้นที่ในสภาพดี และต้องดูแลบำรุงรักษาให้อยู่ในสภาพเดิมด้วยค่าใช้จ่ายของผู้เช่าเอง</li>
    <li>ห้ามใช้พื้นที่เช่าเพื่อการอยู่อาศัย</li>
    <li>ห้ามใช้พื้นที่เช่าประกอบการที่ผิดกฎหมายหรือขัดต่อความสงบเรียบร้อยและศีลธรรมอันดี</li>
    <li>ห้ามทุบ เจาะ ดัดแปลงโครงสร้าง หรือเก็บวัตถุไวไฟ/วัตถุอันตรายในพื้นที่เช่า</li>
    <li>การต่อเติมหรือดัดแปลงโครงสร้างต้องแจ้งและได้รับอนุมัติเป็นหนังสือล่วงหน้าอย่างน้อย 60 วัน</li>
    <li>ทรัพย์สินที่ติดตรึงตราถาวรกับพื้นที่เช่าเมื่อสัญญาสิ้นสุดให้ตกเป็นกรรมสิทธิ์ของผู้ให้เช่า รายการปรับแต่งอาคาร: <span class="f">{{buildingModifications}}</span></li>
    <li>ห้ามย้าย เพิ่ม หรือลดขนาดพื้นที่เช่าโดยพลการ</li>
    <li>การติดตั้งป้ายชื่อร้านต้องเป็นไปตามรูปแบบและตำแหน่งที่ผู้ให้เช่ากำหนด</li>
    <li>ผู้เช่าต้องปฏิบัติตามกฎระเบียบของโครงการและของทางราชการ</li>
    <li>ผู้เช่าต้องทำประกันอัคคีภัยและส่งสำเนากรมธรรม์ให้ผู้ให้เช่าภายใน 7 วัน และทุกปีตลอดอายุสัญญา</li>
  </ol>
</section>
<section class="clause">
  <h3>ข้อ 7. บทเบ็ดเตล็ดทั่วไป</h3>
  <p>7.1 ความรับผิดของผู้ให้เช่าและบริวารต่อผู้เช่าให้เป็นไปตามที่กฎหมายกำหนด คู่สัญญาตกลงจำกัดความรับผิดเฉพาะเท่าที่กฎหมายอนุญาตและเป็นธรรม ทั้งนี้ ข้อสัญญานี้ไม่ตัดสิทธิของผู้เช่าในการเรียกร้องหรือฟ้องร้องตามสิทธิที่กฎหมายรับรอง</p>
  <p>7.2 การติดต่อและการบอกกล่าวระหว่างคู่สัญญาให้ทำตามที่อยู่ในสัญญานี้ โดยทางไปรษณีย์ลงทะเบียน โทรสาร หรืออีเมล และให้ถือว่าได้รับโดยชอบเมื่อส่งไปยังที่อยู่ดังกล่าว</p>
  <p>7.3 <strong>เหตุสุดวิสัย:</strong> หากมีเหตุสุดวิสัยที่อยู่นอกเหนือการควบคุมของฝ่ายใดฝ่ายหนึ่งจนไม่อาจปฏิบัติตามสัญญาได้ ให้คู่สัญญาแจ้งอีกฝ่ายโดยไม่ชักช้าและร่วมกันหาแนวทางบรรเทาผลกระทบตามสมควร</p>
  <p>7.4 <strong>กฎหมายที่ใช้บังคับ:</strong> สัญญานี้อยู่ภายใต้บังคับกฎหมายไทย และให้ศาลไทยที่มีเขตอำนาจเป็นผู้พิจารณาข้อพิพาท</p>
</section>
<section class="clause">
  <h3>ข้อ 8. การผิดนัดและการผิดสัญญา</h3>
  <p class="l2-head">8.1 เมื่อผู้เช่าผิดนัดหรือผิดสัญญา ผู้ให้เช่ามีสิทธิดังนี้</p>
  <ol class="sub">
    <li>บอกเลิกสัญญาเป็นหนังสือ</li>
    <li>ทวงถามหนี้ค้างชำระ และคิดดอกเบี้ยผิดนัดในอัตราร้อยละ 15 ต่อปีบนยอดค้างชำระ โดยไม่เรียกเบี้ยปรับซ้อนกับเบี้ยปรับรายวันตามข้อ 4.5</li>
    <li>ใช้สิทธิยึดหน่วงตามที่กฎหมายให้อำนาจ</li>
    <li>ใช้สิทธิบอกเลิกสัญญาและเรียกคืนพื้นที่เช่าตามกระบวนการทางกฎหมายหรือคำสั่งศาล ทั้งนี้ ผู้ให้เช่าจะไม่ใช้กำลังปิดล็อกพื้นที่หรืองดจ่ายสาธารณูปโภคเองโดยไม่ผ่านกระบวนการที่ชอบด้วยกฎหมาย</li>
  </ol>
  <p>8.2 เมื่อผู้เช่าผิดสัญญาหรือเลิกสัญญาก่อนกำหนด ผู้ให้เช่ามีสิทธิหักจากเงินประกันได้เท่าค่าเสียหายหรือค่าเช่าค้างชำระที่เกิดขึ้นจริง ส่วนที่เหลือคืนแก่ผู้เช่าตามข้อ 3.1</p>
</section>
<section class="clause">
  <h3>ข้อ 9. การเลิกสัญญาเช่า</h3>
  <ol class="sub">
    <li>ผู้เช่าประสงค์จะเลิกสัญญาก่อนครบกำหนด ต้องแจ้งเป็นลายลักษณ์อักษรล่วงหน้าไม่น้อยกว่า <span class="f">{{terminationNoticeDays}}</span> วัน</li>
    <li>ผู้เช่าผิดนัดชำระและผู้ให้เช่าได้เตือนแล้วแต่ผู้เช่ามิได้แก้ไข ผู้ให้เช่ามีสิทธิบอกเลิกสัญญา</li>
    <li>ผู้เช่าถูกพิทักษ์ทรัพย์หรือตกเป็นบุคคลล้มละลาย</li>
    <li>ผู้เช่าหรือบริวารข่มขู่หรือทำร้ายผู้ให้เช่า พนักงาน หรือผู้เช่ารายอื่น</li>
    <li>ผู้เช่าไม่ดำเนินการตกแต่งให้แล้วเสร็จตามกำหนด</li>
    <li>ผู้เช่าไม่แก้ไขการผิดสัญญาตามที่ได้รับการบอกกล่าว</li>
    <li>เมื่อสัญญาเลิกด้วยเหตุที่ผู้เช่าเป็นฝ่ายผิด ผู้ให้เช่ามีสิทธิริบหรือหักเงินประกันได้เฉพาะเท่าค่าเสียหายหรือหนี้ค้างชำระที่เกิดขึ้นจริง ส่วนที่เหลือคืนแก่ผู้เช่าตามข้อ 3.1</li>
  </ol>
</section>
<section class="sign-note">
  <p class="note-head">เอกสารประกอบการทำสัญญา</p>
  <ul>
    <li><strong>นิติบุคคล:</strong> หนังสือรับรองบริษัท + บัตรประชาชน + ทะเบียนบ้านของผู้มีอำนาจลงนาม อย่างละ 2 ชุด</li>
    <li><strong>บุคคลธรรมดา:</strong> บัตรประชาชน + ทะเบียนบ้าน อย่างละ 2 ชุด</li>
  </ul>
</section>
</div>`;

/** Resolve the document body for a contract: custom terms > template DB > แม่แบบมาตรฐาน. */
export function resolveContractBody(c: ContractLike): string {
  const raw = c.customTermsHtml?.trim() || c.template?.bodyHtml?.trim() || STANDARD_LEASE_BODY;
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
  lessorTaxId?: string | null;
  lessorAddress?: string | null;
  /** ชื่อผู้เช่าที่แสดงจริง — "" = ยังไม่เลือก (component โชว์ placeholder) */
  tenantName: string;
  tenantIdMasked?: string | null;
  tenantTaxId?: string | null;
  tenantAddress?: string | null;
  /** ผู้มีอำนาจลงนามแทนผู้เช่า (นิติบุคคล) — ใช้ในช่องลงชื่อผู้เช่า */
  tenantSignerName?: string | null;
  /** พยานฝั่งผู้เช่า (กรอกได้) */
  witness2Name?: string | null;
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
    address?: string | null;
    authorizedSignerName?: string | null;
    authorizedSignerPhone?: string | null;
  };
  project: ProjectLike & {
    address?: string | null;
    billTaxId?: string | null;
    billAddress?: string | null;
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
    lessorTaxId: c.project.billTaxId ?? null,
    lessorAddress: c.project.billAddress ?? c.project.address ?? null,
    tenantName: tenantDisplayName(c.tenant),
    tenantIdMasked: maskIdCard(c.tenant.idCardNo ?? c.tenant.taxId),
    tenantTaxId: c.tenant.taxId ?? c.tenant.idCardNo ?? null,
    tenantAddress: c.tenant.address ?? null,
    tenantSignerName: c.tenant.authorizedSignerName ?? null,
    witness2Name: c.witness2Name ?? null,
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
    // "ล็อกฉบับเซ็น": สัญญาที่เซ็นแล้วและไม่มีข้อความกำหนดเอง/แม่แบบ → ใช้ข้อสัญญาเดิม
    // (fallback ในคอมโพเนนต์ = สิ่งที่ผู้เช่าเห็นตอนเซ็น) ไม่สลับเป็นแม่แบบมาตรฐานใหม่ย้อนหลัง.
    // สัญญาใหม่ที่เซ็นหลังจากนี้จะถูก snapshot ข้อความลง customTermsHtml ตอนเซ็น (actSignContract) → ไม่เข้าเงื่อนไขนี้.
    customBodyHtml:
      c.tenantSigned && !c.customTermsHtml?.trim() && !c.template?.bodyHtml?.trim()
        ? null
        : resolveContractBody({ ...c, madeOn }) || null,
    attachments: opts?.attachments ?? [],
    signature: {
      signed: !!c.tenantSigned,
      dataUrl: c.signatureDataUrl ?? null,
      signerName: c.signerName ?? null,
      signedAt: c.signedAt ?? null,
    },
  };
}
