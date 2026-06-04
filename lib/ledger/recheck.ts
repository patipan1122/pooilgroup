// LedgerLine — Recheck (บวกยอดเช็ก) + format validators.
//
// Lesson from ILikeTax: NEVER trust the AI's totals blindly. Before a draft is
// shown for human confirmation we re-add the numbers ourselves and flag any
// mismatch. The accountant still confirms (we never auto-post), but warnings
// steer their eye to the rows the AI likely mis-read.
//
// All checks are tolerant: small rounding (<1 บาท) is fine; we only warn on
// real discrepancies. Returns { ok, warnings[] } — ok=false → set needs_review.

import type { ParsedReceipt, RecheckResult, ExpenseItem } from "./types";

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
