// LedgerLine — SlipOK QR slip verification (Phase 2).
//
// Bank transfer slips carry a QR that SlipOK (or EasySlip) can verify against
// the real transaction — ~100% accurate, no AI needed. This is deferred until
// the CEO provides a SlipOK/EasySlip API key. The interface below is the shape
// the rest of the module will call so wiring it later touches nothing else.
//
// TODO[ledger-secret]: set SLIPOK_API_KEY (+ branch id) then implement verify().

export interface SlipVerifyResult {
  /** true = SlipOK confirmed the transfer against the bank. */
  verified: boolean;
  /** SlipOK transaction reference, stored on ledger_expense.slip_ref. */
  ref: string | null;
  amount: number | null;
  bank: string | null;
  datetime: string | null;
  /** Populated when verification could not run (missing key / not a slip). */
  reason?: string;
}

/**
 * Verify a transfer slip by its QR payload or image.
 *
 * Stub (Phase 2): returns verified=false with a reason until the API key is set.
 * NEVER throws — callers treat an unverified slip as "needs human confirm".
 */
export async function verifySlip(_input: {
  qrPayload?: string;
  imageUrl?: string;
}): Promise<SlipVerifyResult> {
  // TODO[ledger-secret]: call SlipOK API once SLIPOK_API_KEY is configured.
  if (!process.env.SLIPOK_API_KEY) {
    return {
      verified: false,
      ref: null,
      amount: null,
      bank: null,
      datetime: null,
      reason: "SlipOK ยังไม่ได้ตั้งค่า (Phase 2)",
    };
  }
  // Reachable only once a key exists — real implementation lands in M3.
  return {
    verified: false,
    ref: null,
    amount: null,
    bank: null,
    datetime: null,
    reason: "ยังไม่ implement",
  };
}
