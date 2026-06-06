// LedgerLine — Recheck (บวกยอดเช็ก) + format validators.
//
// Lesson from ILikeTax: NEVER trust the AI's totals blindly. Before a draft is
// shown for human confirmation we re-add the numbers ourselves and flag any
// mismatch. The accountant still confirms (we never auto-post), but warnings
// steer their eye to the rows the AI likely mis-read.
//
// All checks are tolerant: small rounding (<1 บาท) is fine; we only warn on
// real discrepancies. Returns { ok, warnings[] } — ok=false → set needs_review.

import type {
  ParsedReceipt,
  RecheckResult,
  ExpenseItem,
  ExpenseDocType,
  BuyerMatchStatus,
  CompletenessStatus,
  InputVatBlockReason,
} from "./types";
import { isOurBuyer, isGroupEntity, stripTaxId } from "./group-identity";

const MONEY_TOL = 1; // บาท — VAT rounding / sub-satang noise
const VAT_RATE = 0.07; // ภาษีมูลค่าเพิ่มไทย
const VAT_SANITY_TOL = 0.015; // ±1.5pp around 7% before we get suspicious

/** Thai tax id = exactly 13 digits. Returns true if value is absent (nothing to check). */
export function isValidTaxId(taxId: string | null | undefined): boolean {
  if (!taxId) return true; // absent → not an error here; UI may still nudge
  const digits = taxId.replace(/\D/g, "");
  return digits.length === 13;
}

function near(a: number, b: number, tol = MONEY_TOL): boolean {
  return Math.abs(a - b) <= tol;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Validate a parsed receipt's math + formats.
 *
 * Checks:
 *  1. tax id is 13 digits (if present)
 *  2. subtotal + vat - wht = total   (tolerance < 1 บาท)
 *  3. vat ≈ 7% of subtotal           (sanity — warn only, vendors vary)
 *  4. sum(items.amount) = subtotal    (if items were read)
 */
export function recheckReceipt(p: {
  vendorTaxId?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  vat?: number | null;
  wht?: number | null;
  total?: number | null;
  items?: ExpenseItem[];
}): RecheckResult {
  const warnings: string[] = [];

  // 1. Tax id format
  if (p.vendorTaxId && !isValidTaxId(p.vendorTaxId)) {
    warnings.push(
      `เลขผู้เสียภาษี "${p.vendorTaxId}" ไม่ครบ 13 หลัก — ตรวจสอบอีกครั้ง`,
    );
  }

  const subtotal = num(p.subtotal);
  const discount = num(p.discount);
  const vat = num(p.vat);
  const wht = num(p.wht);
  const total = num(p.total);

  // 2. subtotal − discount + vat − wht = total
  //    (subtotal = gross pre-discount; discount reduces the taxable base, Bainy-style)
  if (total > 0 || subtotal > 0) {
    const expectedTotal = subtotal - discount + vat - wht;
    if (!near(expectedTotal, total)) {
      const discPart = discount > 0 ? ` − ส่วนลด ${discount.toFixed(2)}` : "";
      warnings.push(
        `ยอดรวมไม่ตรง: ยอดย่อย ${subtotal.toFixed(2)}${discPart} + VAT ${vat.toFixed(2)} − หัก ณ ที่จ่าย ${wht.toFixed(2)} = ${expectedTotal.toFixed(2)} แต่ยอดรวมที่อ่านได้ = ${total.toFixed(2)}`,
      );
    }
  }

  // 3. VAT ≈ 7% sanity (warn only — exempt vendors / VAT-inclusive prices vary).
  //    Base is the post-discount taxable amount.
  const taxBase = subtotal - discount;
  if (taxBase > 0 && vat > 0) {
    const impliedRate = vat / taxBase;
    if (Math.abs(impliedRate - VAT_RATE) > VAT_SANITY_TOL) {
      warnings.push(
        `อัตรา VAT ผิดปกติ: ${(impliedRate * 100).toFixed(1)}% (ปกติ 7%) — ตรวจว่าเป็นราคารวม VAT หรือผู้ขายไม่จด VAT`,
      );
    }
  }

  // 4. sum(items) = subtotal
  const items = p.items ?? [];
  if (items.length > 0 && subtotal > 0) {
    const itemsSum = items.reduce((s, it) => s + num(it.amount), 0);
    if (!near(itemsSum, subtotal)) {
      warnings.push(
        `ผลรวมรายการย่อย ${itemsSum.toFixed(2)} ไม่ตรงกับยอดย่อย ${subtotal.toFixed(2)}`,
      );
    }
  }

  return { ok: warnings.length === 0, warnings };
}

/** Convenience: run recheck directly on a ParsedReceipt from ai-parse. */
export function recheckParsed(parsed: ParsedReceipt): RecheckResult {
  return recheckReceipt({
    vendorTaxId: parsed.vendorTaxId,
    subtotal: parsed.subtotal,
    discount: parsed.discount ?? 0,
    vat: parsed.vat,
    wht: parsed.wht,
    total: parsed.total,
    items: parsed.items,
  });
}

// =============================================================================
// Completeness Engine — input-VAT claimability (ภาษีซื้อ). PLAN §3.
//
// DETERMINISTIC, ไม่ใช้ AI. Grades a receipt 🟢/🟡/🔴 by the ม.86/4 elements +
// buyer verification. The whole anti-false-accept guarantee rests on deciding
// the buyer by the 13-digit tax id EXACTLY (group-identity.ts) — never the name,
// never OCR confidence. A human still confirms (GOLDEN RULE — never auto-post);
// this only steers the eye and gates the suggested claimable flag.
// =============================================================================

/** Inputs the grader reads. Mirrors the fields a draft/parsed receipt carries. */
export interface CompletenessInput {
  docType: ExpenseDocType | null | undefined;
  vendor: string | null | undefined;
  vendorTaxId: string | null | undefined;
  vendorAddress: string | null | undefined;
  vendorBranchCode: string | null | undefined;
  subtotal: number | null | undefined;
  vat: number | null | undefined;
  total: number | null | undefined;
  /** เลขภาษีผู้ซื้อที่ OCR อ่านได้บนใบ (หรือ null). ตัดสินด้วยตัวนี้ — ไม่ใช่ชื่อ. */
  buyerTaxIdOnDoc: string | null | undefined;
  /** OCR raw text (optional) — ใช้ตรวจคำว่า "อย่างย่อ" (ใบกำกับภาษีอย่างย่อ ม.86/6). */
  rawText?: string | null;
}

/** Deterministic grade result. */
export interface CompletenessResult {
  status: CompletenessStatus; // green_full | yellow_partial | red_invalid (never "undecided")
  buyerMatch: BuyerMatchStatus; // matched | mismatch | not_found_on_doc (never "undecided")
  missing: string[]; // ["vendor_taxid","vat_line","buyer_taxid",...]
  blockReason: InputVatBlockReason | null;
  suggestedClaimable: boolean; // true เฉพาะ green_full
}

/**
 * Buyer match on the 13-digit tax id EXACTLY (PLAN §3):
 *   len≠13              → not_found_on_doc
 *   === เจพีซิ้งค์      → matched
 *   ใน GROUP_TAX_IDS แต่คนละตัว → mismatch (wrong entity — caller maps reason)
 *   อื่น/ผิด 1 หลัก     → mismatch
 */
function gradeBuyerMatch(buyerTaxIdOnDoc: string | null | undefined): BuyerMatchStatus {
  const digits = stripTaxId(buyerTaxIdOnDoc);
  if (digits.length !== 13) return "not_found_on_doc";
  if (isOurBuyer(digits)) return "matched";
  return "mismatch";
}

/** ใบกำกับอย่างย่อ (ม.86/6) heuristic — keyword "อย่างย่อ" บน OCR text,
 *  หรือ docType≠tax_invoice แต่ยังมี VAT แยก (>0). PLAN §3. */
function looksAbbreviated(p: CompletenessInput): boolean {
  const raw = p.rawText ?? "";
  if (raw.includes("อย่างย่อ")) return true;
  const vat = num(p.vat);
  if (p.docType && p.docType !== "tax_invoice" && vat > 0) return true;
  return false;
}

/**
 * Grade a receipt's input-VAT completeness (ม.86/4 + buyer verify), deterministic.
 *
 * Rule table (top→bottom, first match wins — PLAN §3):
 *   R1 เลขภาษีผู้ขายไม่ครบ 13         🔴 incomplete_invoice
 *   R2 ผู้ซื้อ = บริษัทอื่นในเครือ      🔴 wrong_entity
 *   R3 ผู้ซื้อ = นอกเครือ/ผิด 1 หลัก   🔴 buyer_mismatch
 *   R4 ไม่มีบรรทัด VAT แยก (vat≤0)     🔴 incomplete_invoice  (ใบย่อ keyword pre-empts)
 *   R5 ใบกำกับอย่างย่อ (ม.86/6)        🟡 abbreviated_86_6
 *   R6 ไม่เจอเลขผู้ซื้อบนใบ            🟡 incomplete_invoice
 *   R7 ขาดของรอง (ที่อยู่/สาขา)        🟡 incomplete_invoice
 *   R8 เต็มรูป + ผู้ซื้อตรง + VAT แยก   🟢 null
 */
export function gradeCompleteness(p: CompletenessInput): CompletenessResult {
  const missing: string[] = [];
  const vat = num(p.vat);
  const buyerMatch = gradeBuyerMatch(p.buyerTaxIdOnDoc);
  const vendorDigits = stripTaxId(p.vendorTaxId);
  const abbreviated = looksAbbreviated(p);

  const red = (
    blockReason: InputVatBlockReason,
  ): CompletenessResult => ({
    status: "red_invalid",
    buyerMatch,
    missing,
    blockReason,
    suggestedClaimable: false,
  });
  const yellow = (
    blockReason: InputVatBlockReason,
  ): CompletenessResult => ({
    status: "yellow_partial",
    buyerMatch,
    missing,
    blockReason,
    suggestedClaimable: false,
  });

  // R0 (D1) — ใบเสนอราคา/บิลที่ยังไม่ใช่ใบกำกับ: นับเป็นค่าใช้จ่ายจริงทันที (accrual)
  //   แต่ "ภาษีซื้อ" ขอคืนไม่ได้จนกว่าใบกำกับจริงจะมา supersede → เกรดเหลืองเสมอ
  //   (ขอคืนไม่ได้). การแยก "รอใบกำกับ" (มี VAT, ต้องตามใบจริง) vs "ไม่มี VAT" (ยอด
  //   สุดท้าย, จบ) เป็นเรื่องการแสดงผล (DocTag derive จาก vat) ไม่ใช่เรื่องเกรด.
  if (p.docType === "quotation") {
    return yellow("incomplete_invoice");
  }

  // R1 — ผู้ขายต้องมีเลขภาษี 13 หลัก (ม.86/4(1)). ไม่ครบ = แดง.
  if (vendorDigits.length !== 13) {
    missing.push("vendor_taxid");
    return red("incomplete_invoice");
  }

  // R2 — ผู้ซื้อเป็นบริษัทอื่นในเครือ (เลขอยู่ใน whitelist แต่ไม่ใช่เจพีซิ้งค์) →
  //      จ่ายโดยเจพีซิ้งค์ แต่ใบออกผิดบริษัท = ขอคืนไม่ได้ (false-accept แพงสุด).
  if (
    buyerMatch === "mismatch" &&
    isGroupEntity(p.buyerTaxIdOnDoc) &&
    !isOurBuyer(p.buyerTaxIdOnDoc)
  ) {
    missing.push("buyer_taxid");
    return red("wrong_entity");
  }

  // R3 — ผู้ซื้อ = นอกเครือ / เลขผิด 1 หลัก = แดง.
  if (buyerMatch === "mismatch") {
    missing.push("buyer_taxid");
    return red("buyer_mismatch");
  }

  // R5 (keyword pre-empt) — ใบกำกับอย่างย่อ ม.86/6: ลงค่าใช้จ่ายได้ ขอคืน VAT ไม่ได้ = เหลือง.
  //     ตรวจก่อน R4 เพราะใบย่อมักไม่มีบรรทัด VAT แยก (จะถูก R4 จับเป็นแดงโดยไม่ถูกต้อง).
  if (abbreviated) {
    return yellow("abbreviated_86_6");
  }

  // R4 — ต้องมีบรรทัด VAT แยก (ม.86/4(7)). ไม่มี (vat≤0) และไม่ใช่ใบย่อ = แดง.
  if (vat <= 0) {
    missing.push("vat_line");
    return red("incomplete_invoice");
  }

  // R6 — ไม่เจอเลขผู้ซื้อบนใบ (อย่างอื่นครบ) = เหลือง (ขอใบใหม่ที่มีชื่อ/เลขเรา).
  if (buyerMatch === "not_found_on_doc") {
    missing.push("buyer_taxid");
    return yellow("incomplete_invoice");
  }

  // R7 — ขาดที่อยู่ผู้ขาย = เหลือง (องค์ประกอบบังคับ ม.86/4(2)).
  //   รหัสสาขาผู้ขายขาด = ไม่ลดเกรด (CEO 2026-06-06: ลด noise) — สรรพากรรับ
  //   "สำนักงานใหญ่" เป็น default และใบจริงจำนวนมากไม่พิมพ์รหัสสาขา. เก็บเป็น
  //   หมายเหตุใน missing[] เฉย ๆ แต่ยังให้เกรดเขียวได้.
  const vendorAddr = (p.vendorAddress ?? "").trim();
  const vendorBranch = (p.vendorBranchCode ?? "").trim();
  if (!vendorBranch) missing.push("vendor_branch"); // informational note only — ไม่ลดเกรด
  if (!vendorAddr) {
    missing.push("vendor_address");
    return yellow("incomplete_invoice");
  }

  // R8 — เต็มรูป + ผู้ซื้อตรง + VAT แยก = เขียว → ขอคืนได้.
  return {
    status: "green_full",
    buyerMatch, // === "matched"
    missing,
    blockReason: null,
    suggestedClaimable: true,
  };
}
