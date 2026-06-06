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
