// LedgerLine — deterministic duplicate-payment checks (pure DB, no AI, ~0 token).
//
// Mirrors the PR1 unique indexes on ledger_payment. The trans_ref check is per-ORG
// (matching the unique constraint org_id + sending_bank + trans_ref): one real bank
// transfer can settle only one bill within an org, so the ref is unique org-wide —
// checking per-org is the correct dedup scope (it is an existence check on rows the
// admin already owns within their org, not a cross-tenant read).
import { prisma } from "@/lib/prisma";
import { findRecentAmountDuplicate } from "./dedup";

export type SlipDupKind = "trans_ref" | "slip_image" | "none";

export interface SlipDupResult {
  kind: SlipDupKind;
  /** trans_ref → BLOCK mark-paid until the user explicitly overrides (real 2nd transfer
   *  is rare + intentional). slip_image → silent block (the same photo resent). */
  blocking: boolean;
  existingPaymentId?: string;
  existingExpenseId?: string | null;
}

/** Hard dedup: same bank-transfer ref, or the exact same slip image. */
export async function checkSlipDuplicate(opts: {
  orgId: string;
  sendingBank: string | null;
  transRef: string | null;
  slipSha256: string | null;
}): Promise<SlipDupResult> {
  const { orgId, sendingBank, transRef, slipSha256 } = opts;

  // 1) same transfer (bank + ref) → BLOCK. Exact key, no time window, no false
  //    positives (monthly same-amount bills carry DIFFERENT refs).
  if (transRef && sendingBank) {
    const dup = await prisma.ledgerPayment.findFirst({
      where: { orgId, sendingBank, transRef },
      select: { id: true, matchedExpenseId: true },
    });
    if (dup) {
      return {
        kind: "trans_ref",
        blocking: true,
        existingPaymentId: dup.id,
        existingExpenseId: dup.matchedExpenseId,
      };
    }
  }

  // 2) same image resent → silent block.
  if (slipSha256) {
    const dup = await prisma.ledgerPayment.findFirst({
      where: { orgId, slipSha256 },
      select: { id: true, matchedExpenseId: true },
    });
    if (dup) {
      return {
        kind: "slip_image",
        blocking: true,
        existingPaymentId: dup.id,
        existingExpenseId: dup.matchedExpenseId,
      };
    }
  }

  return { kind: "none", blocking: false };
}

/**
 * Soft heads-up only — NEVER blocks. A recent non-void expense with the SAME amount
 * in the same company (reuses lib/ledger/dedup.ts). Because real duplicate transfers
 * are caught precisely by the trans_ref key above, this is just a nudge for the human
 * to eyeball; recurring same-amount bills (rent/utilities) legitimately repeat.
 */
export async function checkFuzzyPaymentWarning(opts: {
  orgId: string;
  companyId: string;
  amount: number | null;
}): Promise<{ warn: boolean; existingId?: string; existingDocCode?: string }> {
  const dup = await findRecentAmountDuplicate(opts.orgId, opts.companyId, opts.amount);
  if (!dup) return { warn: false };
  return { warn: true, existingId: dup.id, existingDocCode: dup.docCode };
}
