// LedgerLine — Bank Statement Reconcile: core logic layer.
//
// Responsibilities:
//   1. lineHash generation (dedup key for bank_txn rows)
//   2. Auto-match suggestion engine (bank_txn ↔ book entries)
//   3. DB queries for reconcile pages
//   4. Period lock + fingerprint
//
// NOT responsible for: file parsing (bank-adapters/), UI, mutations (Server Actions).
// NEVER modifies ledger_expense directly — only reads it + writes ledger_bank_match.

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MatchConfidence = "high" | "medium" | "low";
export type MatchType =
  | "auto_amount_date"
  | "auto_amount"
  | "auto_ref"
  | "mdr_split"
  | "manual"
  | "exclusion";

export interface MatchSuggestion {
  bankTxnId: string;
  bookType: "expense" | "payment" | "payment_request";
  bookId: string;
  matchType: MatchType;
  confidence: MatchConfidence;
  bankAmountSatang: number;
  bookAmountSatang: number;
  deltaSatang: number;
  reason: string; // human-readable Thai reason shown in UI
}

export interface BankTxnRow {
  id: string;
  txnDate: Date;
  amountSatang: number;
  balanceSatang: number;
  ref1: string | null;
  ref2: string | null;
  description: string | null;
  matchState: string;
}

// ── lineHash ──────────────────────────────────────────────────────────────────

/**
 * Compute the dedup hash for a bank transaction row.
 * batchId + rowIndex salt prevents false-positive dedup on KBank/SCB standing orders
 * (same amount + date in one statement are legitimate distinct transactions).
 */
export function computeLineHash(params: {
  accountNo: string;
  txnDate: string; // 'YYYY-MM-DD'
  amountSatang: number;
  balanceSatang: number;
  ref1: string | null;
  batchId: string;
  rowIndex: number;
}): string {
  const parts = [
    params.accountNo,
    params.txnDate,
    String(params.amountSatang),
    String(params.balanceSatang),
    params.ref1 ?? "",
    params.batchId,
    String(params.rowIndex),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

// ── Period fingerprint ────────────────────────────────────────────────────────

/**
 * Compute SHA-256 fingerprint of all line_hashes in a batch (in insertion order).
 * Used for period lock audit evidence — changes if any txn is altered.
 */
export function computeBatchFingerprint(lineHashes: string[]): string {
  return createHash("sha256")
    .update(lineHashes.sort().join("|"))
    .digest("hex");
}

// ── Auto-match engine ─────────────────────────────────────────────────────────

const HIGH_EXACT_DELTA_SATANG = 100;  // ≤ ฿1.00 = high confidence
const MEDIUM_DELTA_SATANG     = 50000; // ≤ ฿500.00 = medium; else low

function scoreConfidence(deltaSatang: number): MatchConfidence {
  const abs = Math.abs(deltaSatang);
  if (abs <= HIGH_EXACT_DELTA_SATANG) return "high";
  if (abs <= MEDIUM_DELTA_SATANG)      return "medium";
  return "low";
}

/**
 * Generate auto-match suggestions for unmatched bank transactions.
 * Returns suggestions only — never writes to DB.
 * Human confirmation is REQUIRED before any match is recorded (D2: COSO).
 *
 * Algorithm for CREDITS (money in — revenue side):
 *   1. Exact source_ref match vs ledger_revenue_entry → auto_ref, high
 *   2. Amount + date (±2 days) vs revenue entries → auto_amount_date, high/medium
 *   3. Exact transRef match vs ledger_payment → auto_ref, high
 *   4. Amount + date (±2 days) vs payment entries → auto_amount_date
 *   5. Amount-only fallback (±฿500, ±3 days) → auto_amount, low
 *
 * Algorithm for DEBITS (money out — expense side):
 *   1. transRef match vs ledger_payment → auto_ref, high
 *   2. Amount + date (±2 days) vs payments → auto_amount_date
 *   3. Amount + date (±2 days) vs ledger_expense → auto_amount_date
 */
export async function suggestMatches(params: {
  orgId: string;
  companyId: string;
  bankTxnIds: string[];
}): Promise<MatchSuggestion[]> {
  const { orgId, companyId, bankTxnIds } = params;
  if (!bankTxnIds.length) return [];

  // Load unmatched bank transactions (both credits AND debits)
  const bankTxns = await prisma.$queryRaw<BankTxnRow[]>`
    SELECT id, txn_date as "txnDate", amount_satang as "amountSatang",
           balance_satang as "balanceSatang", ref1, ref2, description, match_state as "matchState"
    FROM ledger_bank_txn
    WHERE id = ANY(${bankTxnIds}::uuid[])
      AND org_id = ${orgId}::uuid
      AND company_id = ${companyId}::uuid
      AND match_state = 'unmatched'
  `;

  if (!bankTxns.length) return [];

  const dates = bankTxns.map((t) => t.txnDate);
  const minDate = new Date(Math.min(...dates.map((d) => new Date(d).getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => new Date(d).getTime())));
  minDate.setDate(minDate.getDate() - 3);
  maxDate.setDate(maxDate.getDate() + 3);
  const minDateStr = minDate.toISOString().slice(0, 10);
  const maxDateStr = maxDate.toISOString().slice(0, 10);

  // Revenue entries (for CREDIT matching — money coming IN)
  const revenueEntries = await prisma.$queryRaw<{
    id: string;
    amountSatang: number;
    entryDate: string;
    sourceRef: string | null;
    sourceType: string;
    description: string | null;
  }[]>`
    SELECT id, amount_satang as "amountSatang", entry_date::text as "entryDate",
           source_ref as "sourceRef", source_type as "sourceType", description
    FROM ledger_revenue_entry
    WHERE org_id = ${orgId}::uuid
      AND company_id = ${companyId}::uuid
      AND entry_date BETWEEN ${minDateStr}::date AND ${maxDateStr}::date
      AND match_state = 'unmatched'
    LIMIT 500
  `;

  // Payment entries (for DEBIT matching — transfers, expense payments)
  const payments = await prisma.$queryRaw<{
    id: string;
    amountSatang: number;
    paidAt: Date;
    transRef: string | null;
  }[]>`
    SELECT id, ROUND(amount * 100)::bigint as "amountSatang",
           paid_at as "paidAt", trans_ref as "transRef"
    FROM ledger_payment
    WHERE org_id = ${orgId}::uuid
      AND company_id = ${companyId}::uuid
      AND paid_at::date BETWEEN ${minDateStr}::date AND ${maxDateStr}::date
      AND payment_status != 'cancelled'
    LIMIT 500
  `;

  const suggestions: MatchSuggestion[] = [];

  for (const txn of bankTxns) {
    const txnDate = new Date(txn.txnDate);
    const isCredit = txn.amountSatang > 0;

    if (isCredit) {
      // ── CREDIT path: match against revenue entries ──────────────────────────

      // 1. Exact source_ref match (e.g. TRCloud IV doc_no in bank ref field)
      if (txn.ref1 || txn.ref2) {
        const refSearch = [txn.ref1, txn.ref2].filter(Boolean).join("|");
        const refMatch = revenueEntries.find(
          (r) => r.sourceRef && (refSearch.includes(r.sourceRef) || r.sourceRef.includes(refSearch)),
        );
        if (refMatch) {
          const delta = txn.amountSatang - refMatch.amountSatang;
          suggestions.push({
            bankTxnId: txn.id,
            bookType: "payment",    // reuse bookType enum; "payment" maps to revenue in match context
            bookId: refMatch.id,
            matchType: "auto_ref",
            confidence: scoreConfidence(delta),
            bankAmountSatang: txn.amountSatang,
            bookAmountSatang: refMatch.amountSatang,
            deltaSatang: delta,
            reason: `รายได้ ${refMatch.sourceType} ref "${refMatch.sourceRef}"`,
          });
          continue;
        }
      }

      // 2. Amount + date window (±2 days) vs revenue entries
      const revAmountMatches = revenueEntries.filter((r) => {
        const rDate = new Date(r.entryDate);
        const dayDiff = Math.abs((rDate.getTime() - txnDate.getTime()) / 86400000);
        return dayDiff <= 2 && Math.abs(txn.amountSatang - r.amountSatang) <= HIGH_EXACT_DELTA_SATANG;
      });
      if (revAmountMatches.length === 1) {
        const r = revAmountMatches[0];
        const delta = txn.amountSatang - r.amountSatang;
        suggestions.push({
          bankTxnId: txn.id,
          bookType: "payment",
          bookId: r.id,
          matchType: "auto_amount_date",
          confidence: scoreConfidence(delta),
          bankAmountSatang: txn.amountSatang,
          bookAmountSatang: r.amountSatang,
          deltaSatang: delta,
          reason: `รายได้ ${r.sourceType} ยอดตรง ±฿${(Math.abs(delta) / 100).toFixed(2)} ใน 2 วัน`,
        });
        continue;
      }

      // 3. Fallback: transRef in ledger_payment (payment_request slip match)
      if (txn.ref1 || txn.ref2) {
        const refSearch = [txn.ref1, txn.ref2].filter(Boolean).join("|");
        const refMatch = payments.find(
          (p) => p.transRef && (refSearch.includes(p.transRef) || p.transRef.includes(refSearch)),
        );
        if (refMatch) {
          const delta = txn.amountSatang - refMatch.amountSatang;
          suggestions.push({
            bankTxnId: txn.id,
            bookType: "payment",
            bookId: refMatch.id,
            matchType: "auto_ref",
            confidence: scoreConfidence(delta),
            bankAmountSatang: txn.amountSatang,
            bookAmountSatang: refMatch.amountSatang,
            deltaSatang: delta,
            reason: `ตรงกับ transRef "${refMatch.transRef}"`,
          });
          continue;
        }
      }

      // 4. Loose revenue fallback (±฿500, ±3 days)
      const looseRev = revenueEntries.find((r) => {
        const rDate = new Date(r.entryDate);
        const dayDiff = Math.abs((rDate.getTime() - txnDate.getTime()) / 86400000);
        return Math.abs(txn.amountSatang - r.amountSatang) <= MEDIUM_DELTA_SATANG && dayDiff <= 3;
      });
      if (looseRev) {
        const delta = txn.amountSatang - looseRev.amountSatang;
        suggestions.push({
          bankTxnId: txn.id,
          bookType: "payment",
          bookId: looseRev.id,
          matchType: "auto_amount",
          confidence: "low",
          bankAmountSatang: txn.amountSatang,
          bookAmountSatang: looseRev.amountSatang,
          deltaSatang: delta,
          reason: `รายได้ ${looseRev.sourceType} ยอดใกล้เคียง ±฿${(Math.abs(delta) / 100).toFixed(2)}`,
        });
      }

    } else {
      // ── DEBIT path: match against payment/expense records ──────────────────
      const absTxn = Math.abs(txn.amountSatang);

      // 1. Exact transRef match
      if (txn.ref1 || txn.ref2) {
        const refSearch = [txn.ref1, txn.ref2].filter(Boolean).join("|");
        const refMatch = payments.find(
          (p) => p.transRef && (refSearch.includes(p.transRef) || p.transRef.includes(refSearch)),
        );
        if (refMatch) {
          const delta = absTxn - refMatch.amountSatang;
          suggestions.push({
            bankTxnId: txn.id,
            bookType: "payment",
            bookId: refMatch.id,
            matchType: "auto_ref",
            confidence: scoreConfidence(delta),
            bankAmountSatang: txn.amountSatang,
            bookAmountSatang: -refMatch.amountSatang,
            deltaSatang: delta,
            reason: `ตรงกับ transRef "${refMatch.transRef}"`,
          });
          continue;
        }
      }

      // 2. Amount + date match
      const debitMatches = payments.filter((p) => {
        const pDate = new Date(p.paidAt);
        const dayDiff = Math.abs((pDate.getTime() - txnDate.getTime()) / 86400000);
        return dayDiff <= 2 && Math.abs(absTxn - p.amountSatang) <= HIGH_EXACT_DELTA_SATANG;
      });
      if (debitMatches.length === 1) {
        const m = debitMatches[0];
        const delta = absTxn - m.amountSatang;
        suggestions.push({
          bankTxnId: txn.id,
          bookType: "payment",
          bookId: m.id,
          matchType: "auto_amount_date",
          confidence: scoreConfidence(delta),
          bankAmountSatang: txn.amountSatang,
          bookAmountSatang: -m.amountSatang,
          deltaSatang: delta,
          reason: `ยอดจ่ายตรง ±฿${(Math.abs(delta) / 100).toFixed(2)} ใน 2 วัน`,
        });
        continue;
      }

      // 3. Loose debit fallback
      const looseDebit = payments.find((p) => {
        const pDate = new Date(p.paidAt);
        const dayDiff = Math.abs((pDate.getTime() - txnDate.getTime()) / 86400000);
        return Math.abs(absTxn - p.amountSatang) <= MEDIUM_DELTA_SATANG && dayDiff <= 3;
      });
      if (looseDebit) {
        const delta = absTxn - looseDebit.amountSatang;
        suggestions.push({
          bankTxnId: txn.id,
          bookType: "payment",
          bookId: looseDebit.id,
          matchType: "auto_amount",
          confidence: "low",
          bankAmountSatang: txn.amountSatang,
          bookAmountSatang: -looseDebit.amountSatang,
          deltaSatang: delta,
          reason: `ยอดจ่ายใกล้เคียง ±฿${(Math.abs(delta) / 100).toFixed(2)}`,
        });
      }
    }
  }

  return suggestions;
}

// ── Hub queries ───────────────────────────────────────────────────────────────

export interface BankAccountStatus {
  accountId: string;
  bankCode: string;
  accountNo: string; // masked: last 4 only
  accountName: string;
  period: string; // 'YYYY-MM'
  totalTxns: number;
  unmatchedCount: number;
  matchedCount: number;
  lockedAt: string | null;
  status: "not_started" | "in_progress" | "completed" | "locked";
}

export async function listBankAccountsWithStatus(params: {
  orgId: string;
  companyId: string;
  period: string; // 'YYYY-MM'
}): Promise<BankAccountStatus[]> {
  const { orgId, companyId, period } = params;
  const [year, month] = period.split("-").map(Number);
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10); // last day of month

  const rows = await prisma.$queryRaw<{
    accountId: string;
    bankCode: string;
    accountNo: string;
    accountName: string;
    totalTxns: number;
    unmatchedCount: number;
    confirmedCount: number;
    lockedAt: Date | null;
  }[]>`
    SELECT
      a.id as "accountId",
      a.bank_code as "bankCode",
      a.account_no as "accountNo",
      a.account_name as "accountName",
      COALESCE(SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END), 0)::int as "totalTxns",
      COALESCE(SUM(CASE WHEN t.match_state = 'unmatched' THEN 1 ELSE 0 END), 0)::int as "unmatchedCount",
      COALESCE(SUM(CASE WHEN t.match_state = 'confirmed' THEN 1 ELSE 0 END), 0)::int as "confirmedCount",
      MAX(b.locked_at) as "lockedAt"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    LEFT JOIN ledger_bank_import_batch b
      ON b.bank_account_id = a.id
      AND b.period_start >= ${periodStart}::date
      AND b.period_end   <= ${periodEnd}::date
    LEFT JOIN ledger_bank_txn t
      ON t.batch_id = b.id
    WHERE a.org_id = ${orgId}::uuid
      AND ac.company_id = ${companyId}::uuid
      AND ac.can_view = true
      AND a.is_active = true
    GROUP BY a.id, a.bank_code, a.account_no, a.account_name
    ORDER BY a.bank_code, a.account_no
  `;

  return rows.map((r) => {
    const maskedNo = r.accountNo.length >= 4
      ? `****${r.accountNo.slice(-4)}`
      : r.accountNo;

    let status: BankAccountStatus["status"] = "not_started";
    if (r.lockedAt) status = "locked";
    else if (r.totalTxns > 0 && r.unmatchedCount === 0) status = "completed";
    else if (r.totalTxns > 0) status = "in_progress";

    return {
      accountId: r.accountId,
      bankCode: r.bankCode,
      accountNo: maskedNo,
      accountName: r.accountName,
      period,
      totalTxns: r.totalTxns,
      unmatchedCount: r.unmatchedCount,
      matchedCount: r.confirmedCount,
      lockedAt: r.lockedAt ? r.lockedAt.toISOString() : null,
      status,
    };
  });
}

// ── Match page queries ────────────────────────────────────────────────────────

export async function listBankTxnsForBatch(params: {
  batchId: string;
  orgId: string;
  companyId: string;
  tab: "unmatched" | "suggested" | "confirmed";
}) {
  const { batchId, orgId, companyId, tab } = params;
  const stateFilter =
    tab === "unmatched"  ? ["unmatched"] :
    tab === "suggested"  ? ["suggested"] :
    ["confirmed"];

  return prisma.$queryRaw<{
    id: string;
    txnDate: string;
    amountSatang: number;
    balanceSatang: number;
    description: string | null;
    channel: string | null;
    ref1: string | null;
    matchState: string;
    matchId: string | null;
    matchConfidence: string | null;
    matchType: string | null;
    deltaSatang: number | null;
  }[]>`
    SELECT
      t.id,
      t.txn_date::text as "txnDate",
      t.amount_satang as "amountSatang",
      t.balance_satang as "balanceSatang",
      t.description,
      t.channel,
      t.ref1,
      t.match_state as "matchState",
      m.id as "matchId",
      m.confidence as "matchConfidence",
      m.match_type as "matchType",
      m.delta_satang as "deltaSatang"
    FROM ledger_bank_txn t
    LEFT JOIN ledger_bank_match m ON m.bank_txn_id = t.id AND m.status != 'reversed'
    WHERE t.batch_id = ${batchId}::uuid
      AND t.org_id = ${orgId}::uuid
      AND t.company_id = ${companyId}::uuid
      AND t.match_state = ANY(${stateFilter}::text[])
    ORDER BY ABS(COALESCE(m.delta_satang, t.amount_satang)) DESC, t.txn_date DESC
    LIMIT 200
  `;
}
