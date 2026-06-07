// LedgerLine — Thai accounting voucher/document generator (Bainy parity).
//
// Produces a print-ready A4 *document* from a CONFIRMED ledger_expense (+items):
//   - PV  : ใบสำคัญจ่าย (Payment Voucher)
//   - JV  : สมุดรายวันทั่วไป (Journal Voucher)
//   - PCV : ใบสำคัญจ่ายเงินสดย่อย (Petty Cash Voucher)
//   - SUB : ใบรับรองแทนใบเสร็จรับเงิน (substitute receipt — RD form)
//
// WHY HTML-and-print (not pdf-lib binary):
//   The repo's only PDF lib is `pdf-lib`, whose built-in StandardFonts (Helvetica
//   / Times) CANNOT encode Thai characters, and `@pdf-lib/fontkit` (needed to
//   embed a Thai TTF) is NOT installed — and we may not add npm packages without
//   the CEO's sign-off. So we render a fully self-contained, print-styled HTML
//   document (A4 · IBM Plex Sans Thai — the same webfont the app already uses ·
//   `@media print` · auto window.print()). The browser turns it into a pixel-
//   perfect Thai PDF via "Save as PDF" / "พิมพ์ → บันทึกเป็น PDF". This is the
//   standard zero-dependency way to emit Thai accounting documents and keeps the
//   document a single shareable file. (If the CEO later approves adding
//   @pdf-lib/fontkit + a Thai TTF, swap renderVoucherHtml() for a pdf-lib binary
//   build behind the same buildVoucher() signature — callers don't change.)
//
// GOLDEN RULE alignment: this module is READ-ONLY. It NEVER writes to the DB and
// NEVER recomputes tax — amounts (subtotal/vat/wht/total) come verbatim from the
// stored, human-confirmed expense.

import type { Expense } from "./types";

export type VoucherType = "PV" | "JV" | "PCV" | "SUB";

export const VOUCHER_TYPES: VoucherType[] = ["PV", "JV", "PCV", "SUB"];

export function isVoucherType(v: string): v is VoucherType {
  return (VOUCHER_TYPES as string[]).includes(v);
}

/** Thai label per document type (used in menus + the document title). */
export const VOUCHER_LABEL: Record<VoucherType, string> = {
  PV: "ใบสำคัญจ่าย",
  JV: "สมุดรายวันทั่วไป",
  PCV: "ใบสำคัญจ่ายเงินสดย่อย",
  SUB: "ใบรับรองแทนใบเสร็จรับเงิน",
};

/** Company header info — pulled from the Company row (never recomputed). */
export interface VoucherCompany {
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  /** Optional raster/vector logo URL (Company.logoUrl). Falls back to brand SVG. */
  logoUrl?: string | null;
}

export interface BuildVoucherInput {
  type: VoucherType;
  expense: Expense;
  company: VoucherCompany;
  categoryName?: string | null;
  branchLabel?: string | null;
  /** Display name of the accountant/authoriser who triggered the document. */
  issuedBy?: string | null;
  /**
   * Substitute-receipt-only: the reason this expense has no real tax invoice
   * (RD requires a stated justification). Required when type === "SUB".
   */
  substituteReason?: string | null;
}

export interface BuiltVoucher {
  html: string;
  /** Suggested download filename (no extension). */
  filename: string;
  /** MIME of the returned body. */
  contentType: "text/html; charset=utf-8";
}

// ────────────────────────────────────────────────────────────────────────────
// Number → Thai baht text (อ่านจำนวนเงินเป็นตัวอักษรไทย). Self-contained — the
// repo has no existing helper. Handles 0..999,999,999,999.99 with satang.
// ────────────────────────────────────────────────────────────────────────────

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const THAI_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];

function readThaiIntegerGroup(numStr: string): string {
  // numStr is up to 7 digits (one "ล้าน" group worth read left→right).
  let out = "";
  const len = numStr.length;
  for (let i = 0; i < len; i++) {
    const digit = Number(numStr[i]);
    const place = len - i - 1;
    if (digit === 0) continue;
    if (place === 0 && digit === 1 && len > 1) {
      out += "เอ็ด"; // หน่วย = 1 → "เอ็ด" (e.g. 21 = ยี่สิบเอ็ด)
    } else if (place === 1 && digit === 2) {
      out += "ยี่" + THAI_PLACES[place]; // 2สิบ → ยี่สิบ
    } else if (place === 1 && digit === 1) {
      out += THAI_PLACES[place]; // 1สิบ → สิบ (not หนึ่งสิบ)
    } else {
      out += THAI_DIGITS[digit] + THAI_PLACES[place];
    }
  }
  return out;
}

function readThaiInteger(intStr: string): string {
  const clean = intStr.replace(/^0+(?=\d)/, "");
  if (clean === "0") return THAI_DIGITS[0];
  // Split into million-groups (Thai reads "ล้าน" recursively for >7 digits).
  // Support up to 12 digits: [high ≤5][low 6].
  if (clean.length > 6) {
    const lowLen = 6;
    const high = clean.slice(0, clean.length - lowLen);
    const low = clean.slice(clean.length - lowLen);
    const highText = readThaiInteger(high) + "ล้าน";
    const lowText = low.replace(/^0+(?=\d)/, "") === "0" ? "" : readThaiIntegerGroup(low.replace(/^0+/, "") || "0");
    return highText + (lowText && lowText !== THAI_DIGITS[0] ? lowText : "");
  }
  return readThaiIntegerGroup(clean);
}

/** "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์" / "...ถ้วน". */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const negative = amount < 0;
  const fixed = Math.abs(amount).toFixed(2);
  const [intPart, satPart] = fixed.split(".");
  const baht = readThaiInteger(intPart);
  const satNum = Number(satPart);
  let text: string;
  if (satNum === 0) {
    text = `${baht}บาทถ้วน`;
  } else {
    text = `${baht}บาท${readThaiInteger(satPart)}สตางค์`;
  }
  return (negative ? "ลบ" : "") + text;
}

// ────────────────────────────────────────────────────────────────────────────
// HTML rendering helpers
// ────────────────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtThaiDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return esc(iso);
  const months = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function signatureLine(label: string): string {
  return `
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-label">( ........................................ )</div>
      <div class="sig-role">${esc(label)}</div>
      <div class="sig-date">วันที่ ......./......./.........</div>
    </div>`;
}

/** Company header block — logo (Company.logoUrl else brand SVG) + name + tax id. */
function headerBlock(company: VoucherCompany): string {
  const logo = company.logoUrl
    ? `<img class="logo-img" src="${esc(company.logoUrl)}" alt="logo" />`
    : `<img class="logo-img" src="/ledger/brand/logo.svg" alt="logo" />`;
  return `
    <div class="doc-header">
      <div class="brand">
        ${logo}
        <div class="brand-text">
          <div class="company-name">${esc(company.name)}</div>
          ${company.address ? `<div class="company-line">${esc(company.address)}</div>` : ""}
          <div class="company-line">
            ${company.taxId ? `เลขประจำตัวผู้เสียภาษี ${esc(company.taxId)}` : ""}
            ${company.phone ? ` · โทร. ${esc(company.phone)}` : ""}
          </div>
        </div>
      </div>
    </div>`;
}

/** Meta row: doc title + doc no + date. */
function titleBlock(type: VoucherType, e: Expense): string {
  return `
    <div class="doc-title-row">
      <h1 class="doc-title">${esc(VOUCHER_LABEL[type])}</h1>
      <div class="doc-meta">
        <div><span class="meta-k">เลขที่</span> <span class="meta-v">${esc(e.docCode)}</span></div>
        <div><span class="meta-k">วันที่</span> <span class="meta-v">${fmtThaiDate(e.docDate)}</span></div>
      </div>
    </div>`;
}

/** Vendor / payee block. */
function payeeBlock(e: Expense): string {
  return `
    <div class="payee">
      <div><span class="meta-k">จ่ายให้ / ผู้ขาย</span> <span class="payee-name">${esc(e.vendor) || "—"}</span></div>
      <div>
        ${e.vendorTaxId ? `<span class="meta-k">เลขภาษี</span> <span class="meta-v">${esc(e.vendorTaxId)}</span>` : ""}
        ${e.paymentMethod ? ` · <span class="meta-k">วิธีชำระ</span> <span class="meta-v">${esc(e.paymentMethod)}</span>` : ""}
      </div>
    </div>`;
}

/** Line-item table (falls back to a single category row if no items). */
function itemsTable(e: Expense, categoryName?: string | null): string {
  const rows =
    e.items && e.items.length > 0
      ? e.items
          .map(
            (it, i) => `
        <tr>
          <td class="c-no">${i + 1}</td>
          <td class="c-desc">${esc(it.description) || "—"}</td>
          <td class="c-qty">${it.qty.toLocaleString("th-TH")}</td>
          <td class="c-amt">${money(it.unitPrice)}</td>
          <td class="c-amt">${money(it.amount)}</td>
        </tr>`,
          )
          .join("")
      : `
        <tr>
          <td class="c-no">1</td>
          <td class="c-desc">${esc(categoryName) || "ค่าใช้จ่าย"}${e.note ? ` — ${esc(e.note)}` : ""}</td>
          <td class="c-qty">1</td>
          <td class="c-amt">${money(e.subtotal)}</td>
          <td class="c-amt">${money(e.subtotal)}</td>
        </tr>`;

  return `
    <table class="items">
      <thead>
        <tr>
          <th class="c-no">#</th>
          <th class="c-desc">รายการ</th>
          <th class="c-qty">จำนวน</th>
          <th class="c-amt">ราคา/หน่วย</th>
          <th class="c-amt">จำนวนเงิน</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Totals: subtotal / vat / wht / total + amount-in-Thai-words. */
function totalsBlock(e: Expense): string {
  return `
    <div class="totals">
      <table class="totals-tbl">
        <tr><td class="t-k">ยอดก่อนภาษี</td><td class="t-v">${money(e.subtotal)}</td></tr>
        <tr><td class="t-k">ภาษีมูลค่าเพิ่ม (VAT)</td><td class="t-v">${money(e.vat)}</td></tr>
        ${e.wht > 0 ? `<tr><td class="t-k">หัก ณ ที่จ่าย</td><td class="t-v">−${money(e.wht)}</td></tr>` : ""}
        <tr class="grand"><td class="t-k">ยอดสุทธิ</td><td class="t-v">${money(e.total)} บาท</td></tr>
      </table>
      <div class="baht-text">(${esc(bahtText(e.total))})</div>
    </div>`;
}

/** Double-entry preview for the JV (สมุดรายวันทั่วไป). Display-only — no posting. */
function journalBlock(e: Expense, categoryName?: string | null): string {
  const discount = e.discount ?? 0;
  // net expense debit = subtotal − discount (PAE 102: debit ≡ credit when discount present)
  const netExpense = e.subtotal - discount;
  const expenseDr = netExpense + e.vat;
  return `
    <table class="items journal">
      <thead>
        <tr>
          <th class="c-desc">บัญชี</th>
          <th class="c-amt">เดบิต</th>
          <th class="c-amt">เครดิต</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="c-desc">${esc(categoryName) || "ค่าใช้จ่าย"}${discount > 0 ? " (หลังหักส่วนลด)" : ""}</td>
          <td class="c-amt">${money(netExpense)}</td>
          <td class="c-amt"></td>
        </tr>
        ${e.vat > 0 ? `<tr><td class="c-desc">ภาษีซื้อ (VAT)</td><td class="c-amt">${money(e.vat)}</td><td class="c-amt"></td></tr>` : ""}
        ${e.wht > 0 ? `<tr><td class="c-desc">ภาษีหัก ณ ที่จ่ายค้างจ่าย</td><td class="c-amt"></td><td class="c-amt">${money(e.wht)}</td></tr>` : ""}
        <tr><td class="c-desc">เงินสด / เจ้าหนี้</td><td class="c-amt"></td><td class="c-amt">${money(e.total)}</td></tr>
        <tr class="grand">
          <td class="c-desc">รวม</td>
          <td class="c-amt">${money(expenseDr)}</td>
          <td class="c-amt">${money(e.wht + e.total)}</td>
        </tr>
      </tbody>
    </table>
    <p class="journal-note">* แสดงประมาณการคู่บัญชีเพื่ออ้างอิงเท่านั้น — ระบบไม่ลงบัญชีอัตโนมัติ (post ใน TRCloud)</p>`;
}

/** Substitute-receipt-only block: reason + original image + authoriser certify. */
function substituteBlock(e: Expense, reason: string | null | undefined): string {
  const img = e.originalUrl
    ? `<div class="orig-receipt">
         <div class="orig-label">ภาพหลักฐานการจ่ายเงิน</div>
         <img class="orig-img" src="${esc(e.originalUrl)}" alt="หลักฐานการจ่าย" />
       </div>`
    : `<div class="orig-receipt orig-missing">ไม่มีภาพใบเสร็จแนบ</div>`;
  return `
    <div class="substitute">
      <p class="sub-statement">
        ข้าพเจ้าขอรับรองว่า รายจ่ายข้างต้นเกิดขึ้นจริงในกิจการ และไม่สามารถเรียกใบเสร็จรับเงิน/ใบกำกับภาษีจากผู้รับเงินได้
        ด้วยเหตุผลดังต่อไปนี้
      </p>
      <div class="sub-reason">
        <span class="meta-k">เหตุผล:</span> ${esc(reason) || "________________________________________________"}
      </div>
      ${img}
    </div>`;
}

const BASE_CSS = `
  @page { size: A4; margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "IBM Plex Sans Thai", "IBM Plex Sans", system-ui, -apple-system, sans-serif;
    color: #18181b; font-size: 13px; line-height: 1.5;
    background: #f4f4f5; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet {
    width: 182mm; min-height: 269mm; margin: 16px auto; background: #fff;
    padding: 18mm 16mm; box-shadow: 0 1px 8px rgba(0,0,0,.08);
  }
  .doc-header { border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo-img { height: 34px; width: auto; }
  .company-name { font-size: 16px; font-weight: 700; }
  .company-line { font-size: 11px; color: #52525b; }
  .doc-title-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .doc-title { font-size: 19px; font-weight: 700; margin: 0; color: #1e3a8a; }
  .doc-meta { text-align: right; font-size: 12px; }
  .meta-k { color: #71717a; font-size: 11px; }
  .meta-v { font-weight: 600; }
  .payee { background: #f8fafc; border: 1px solid #e4e4e7; border-radius: 8px; padding: 8px 12px; margin-bottom: 14px; font-size: 12px; }
  .payee-name { font-weight: 700; font-size: 13px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.items th { background: #eff6ff; border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; color: #1e3a8a; text-align: left; }
  table.items td { border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 12px; vertical-align: top; }
  .c-no { width: 32px; text-align: center; }
  .c-qty { width: 64px; text-align: center; }
  .c-amt { width: 96px; text-align: right; }
  .totals { display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 18px; }
  table.totals-tbl { border-collapse: collapse; min-width: 260px; }
  table.totals-tbl td { padding: 4px 8px; font-size: 12px; }
  .totals-tbl .t-k { color: #52525b; text-align: right; }
  .totals-tbl .t-v { text-align: right; font-weight: 600; min-width: 110px; }
  .totals-tbl tr.grand td { border-top: 2px solid #2563eb; font-size: 14px; font-weight: 700; color: #1e3a8a; padding-top: 6px; }
  .baht-text { margin-top: 6px; font-size: 12px; font-style: italic; color: #3f3f46; }
  .journal-note { font-size: 10px; color: #a1a1aa; margin: 4px 0 14px; }
  .substitute { border: 1px dashed #f59e0b; background: #fffbeb; border-radius: 10px; padding: 12px 14px; margin-bottom: 18px; }
  .sub-statement { margin: 0 0 8px; font-size: 12px; }
  .sub-reason { font-size: 12px; margin-bottom: 10px; }
  .orig-receipt { margin-top: 8px; }
  .orig-label { font-size: 11px; color: #92400e; margin-bottom: 4px; }
  .orig-img { max-width: 200px; max-height: 240px; border: 1px solid #e4e4e7; border-radius: 6px; }
  .orig-missing { color: #b91c1c; font-size: 12px; }
  .signatures { display: flex; justify-content: space-between; gap: 24px; margin-top: 36px; }
  .sig { flex: 1; text-align: center; }
  .sig-line { border-top: 1px dotted #71717a; margin: 0 8px 6px; height: 28px; }
  .sig-label { font-size: 12px; }
  .sig-role { font-size: 11px; color: #71717a; margin-top: 2px; }
  .sig-date { font-size: 10px; color: #a1a1aa; margin-top: 4px; }
  .doc-footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e4e4e7; font-size: 10px; color: #a1a1aa; display: flex; justify-content: space-between; }
  .print-bar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #1e293b; }
  .print-bar button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 16px; border: 0; border-radius: 8px; cursor: pointer; }
  .print-bar .btn-print { background: #2563eb; color: #fff; }
  .print-bar .btn-close { background: #475569; color: #fff; }
  @media print { .print-bar { display: none; } body { background: #fff; } .sheet { box-shadow: none; margin: 0; width: auto; padding: 0; } }
`;

function signaturesFor(type: VoucherType, issuedBy?: string | null): string {
  if (type === "SUB") {
    return `
      <div class="signatures">
        ${signatureLine("ผู้จ่ายเงิน")}
        ${signatureLine(issuedBy ? `ผู้มีอำนาจรับรอง (${issuedBy})` : "ผู้มีอำนาจรับรอง")}
      </div>`;
  }
  if (type === "JV") {
    return `
      <div class="signatures">
        ${signatureLine("ผู้บันทึก")}
        ${signatureLine("ผู้ตรวจสอบ")}
        ${signatureLine(issuedBy ? `ผู้อนุมัติ (${issuedBy})` : "ผู้อนุมัติ")}
      </div>`;
  }
  // PV / PCV
  return `
    <div class="signatures">
      ${signatureLine("ผู้รับเงิน")}
      ${signatureLine("ผู้จ่ายเงิน")}
      ${signatureLine(issuedBy ? `ผู้อนุมัติ (${issuedBy})` : "ผู้อนุมัติ")}
    </div>`;
}

function bodyFor(input: BuildVoucherInput): string {
  const { type, expense: e, categoryName } = input;
  if (type === "JV") {
    return journalBlock(e, categoryName) + totalsBlock(e);
  }
  if (type === "SUB") {
    return (
      itemsTable(e, categoryName) +
      totalsBlock(e) +
      substituteBlock(e, input.substituteReason)
    );
  }
  // PV / PCV share the same item+totals body.
  return itemsTable(e, categoryName) + totalsBlock(e);
}

/** Render the full standalone HTML document for one voucher. */
export function renderVoucherHtml(input: BuildVoucherInput): string {
  const { type, expense: e, company } = input;
  const body = bodyFor(input);
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(VOUCHER_LABEL[type])} ${esc(e.docCode)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${BASE_CSS}</style>
</head>
<body>
  <div class="print-bar">
    <button class="btn-print" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button>
    <button class="btn-close" onclick="window.close()">ปิด</button>
  </div>
  <div class="sheet">
    ${headerBlock(company)}
    ${titleBlock(type, e)}
    ${payeeBlock(e)}
    ${branchMetaBlock(input)}
    ${body}
    ${signaturesFor(type, input.issuedBy)}
    <div class="doc-footer">
      <span>ออกโดยระบบ LedgerLine · JP Sync Group</span>
      <span>${esc(VOUCHER_LABEL[type])} · ${esc(e.docCode)}</span>
    </div>
  </div>
  <script>
    // Auto-open the print dialog (the document IS the deliverable). Guard so it
    // only fires for a real navigation, not when embedded.
    if (window.self === window.top) { window.addEventListener('load', function(){ setTimeout(function(){ try { window.print(); } catch(e){} }, 350); }); }
  </script>
</body>
</html>`;
}

function branchMetaBlock(input: BuildVoucherInput): string {
  const bits: string[] = [];
  if (input.branchLabel) bits.push(`<span class="meta-k">สาขา</span> <span class="meta-v">${esc(input.branchLabel)}</span>`);
  if (input.categoryName) bits.push(`<span class="meta-k">หมวด</span> <span class="meta-v">${esc(input.categoryName)}</span>`);
  if (bits.length === 0) return "";
  return `<div class="payee" style="background:#fff;border-style:dashed">${bits.join(" · ")}</div>`;
}

/**
 * Build a voucher document. Returns the HTML body + a suggested filename +
 * content type. NEVER recomputes tax — amounts come straight from `expense`.
 */
export function buildVoucher(input: BuildVoucherInput): BuiltVoucher {
  const html = renderVoucherHtml(input);
  const safeCode = input.expense.docCode.replace(/[^A-Za-z0-9_-]/g, "_");
  return {
    html,
    filename: `${input.type}-${safeCode}`,
    contentType: "text/html; charset=utf-8",
  };
}
