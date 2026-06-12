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

//   LEDGER_STOCKIN_V1 — resale-goods inventory: sync SKUs from TRCloud per business,
//                       map receipt line → SKU (alias), push stock-IN AP (รับเข้าคลัง).
//                       POS does stock-OUT. Separate from the expense-AP push.
export function ledgerStockinV1(): boolean {
  return flagOn("LEDGER_STOCKIN_V1");
}

//   LEDGER_BANK_RECON_V1 — bank statement reconciliation: upload CSV/Excel from
//                          KBank/SCB/TTB/BBL, auto-suggest matches against book
//                          entries (expense / payment / payment-request), manual
//                          confirm, provisional GL 4999-PROV, period lock.
//                          Route: /ledger/bank-recon
export function ledgerBankReconV1(): boolean {
  return flagOn("LEDGER_BANK_RECON_V1");
}

//   LEDGER_REVENUE_GL_V1 — revenue import + channel→GL: tag revenue by channel
//                          (cash/transfer/card/qr), link each channel to a GL
//                          account (snapshot), per-business config + management
//                          pivot (business × channel × GL vs bank statement).
//                          OFF = byte-equivalent (additive migration, NULL cols).
//                          Routes: /ledger/settings/revenue-channels,
//                          /ledger/bank-recon/revenue/overview
export function ledgerRevenueGlV1(): boolean {
  return flagOn("LEDGER_REVENUE_GL_V1");
}
