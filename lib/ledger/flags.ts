// LedgerLine — feature flags for the payments + quotations build (PR3–PR5).
//
// Every new code path is gated here so that with the flags OFF the runtime is
// byte-equivalent to today (the DB migration is additive, so it ships un-flagged).
// Turn a flag ON in Vercel only after smoke-testing one channel.
//
//   LEDGER_QUOTATION_V1 — quotation docType tab + "รอใบกำกับ" + supersede (D1).
//   LEDGER_SLIP_V1      — slip-intake LINE group + QR dedup + AI-OCR amount +
//                         auto-match to an unpaid bill + floating fallback (D4).
//
// Read at call time (not module load) so a Vercel env flip takes effect on the
// next request without a rebuild.

function flagOn(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true" || v === "on";
}

export function ledgerQuotationV1(): boolean {
  return flagOn("LEDGER_QUOTATION_V1");
}

export function ledgerSlipV1(): boolean {
  return flagOn("LEDGER_SLIP_V1");
}

//   LEDGER_PAYREQ_V1 — "ขอโอนเงิน" request flow: select bills → request card to the
//                      executive group → match slip↔request (net-of-WHT) → close all
//                      bills → /ledger/reconcile. Separate from SLIP_V1 (don't disturb
//                      the smoke-tested slip-intake path).
export function ledgerPayreqV1(): boolean {
  return flagOn("LEDGER_PAYREQ_V1");
}

//   LEDGER_ANALYTICS_V1 — "สมุดค่าใช้จ่าย" spend-analytics: faceted pivot
//                         (rows=สาขา/หมวด/ผู้ขาย/ผู้บันทึก × cols=เดือน/ปี) + tick
//                         filters + keyword "ราคาล่าสุด" search. OFF = the existing
//                         category-card index (byte-equivalent). Read-only, no
//                         migration. (Distinct from the AI insights.ts narrative.)
export function ledgerAnalyticsV1(): boolean {
  return flagOn("LEDGER_ANALYTICS_V1");
}
