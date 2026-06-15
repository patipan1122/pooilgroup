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
  bookType: "expense" | "payment" | "payment_request" | "revenue";
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
 *
 * CONTENT-ONLY hash (NO batchId, NO rowIndex) so the SAME transaction dedups
 * across DIFFERENT files — e.g. a "03-01→05-31" export and a "01-01→06-14" export
 * both contain the May-1 deposit; the running BALANCE after that txn is identical in
 * both files, so the hash matches → UNIQUE(bank_account_id, line_hash) skips the dup.
 *
 * Why balance (not rowIndex) is the disambiguator: rowIndex shifts when a file starts
 * at a different date → same txn gets a different rowIndex per file → the OLD hash
 * (which salted on rowIndex) let cross-file duplicates through. The running balance is
 * intrinsic to the txn and stable across files, AND two legit same-day/same-amount
 * deposits have DIFFERENT balances → they still stay distinct. (Manual-add rows carry
 * a unique ref1 = "MANUAL-<n>", so they remain distinct even with balance=0.)
 *
 * ⚠️ Changing this formula means rows imported BEFORE this fix carry the old (rowIndex)
 * hash → re-importing the SAME old data can still dup against them once; the
 * "ล้างรายการซ้ำ" tool cleans that transition. New imports are stable from here on.
 */
export function computeLineHash(params: {
  accountNo: string;
  txnDate: string; // 'YYYY-MM-DD'
  amountSatang: number;
  balanceSatang: number;
  ref1: string | null;
  rowIndex?: number; // kept for callers' row_index column; NOT part of the hash
}): string {
  const parts = [
    params.accountNo,
    params.txnDate,
    String(params.amountSatang),
    String(params.balanceSatang),
    params.ref1 ?? "",
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
    SELECT p.id, ROUND(p.amount * 100)::bigint as "amountSatang",
           p.paid_at as "paidAt", p.trans_ref as "transRef"
    FROM ledger_payment p
    WHERE p.org_id = ${orgId}::uuid
      AND p.company_id = ${companyId}::uuid
      AND p.paid_at::date BETWEEN ${minDateStr}::date AND ${maxDateStr}::date
      -- don't re-suggest a payment already claimed by an active match
      AND NOT EXISTS (
        SELECT 1 FROM ledger_bank_match m
        WHERE m.matched_payment_id = p.id AND m.status IN ('suggested','confirmed')
      )
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
            bookType: "revenue",
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
          bookType: "revenue",
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
          bookType: "revenue",
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
  lastImportedDate: string | null; // newest STATEMENT date (latest txn) — "ข้อมูลถึงวันนี้", NOT the upload day
  lastUploadedAt: string | null;   // when the latest batch was actually imported (the upload day)
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
  // last day of month — use Date.UTC so the +07 timezone doesn't shift it back a day
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const rows = await prisma.$queryRaw<{
    accountId: string;
    bankCode: string;
    accountNo: string;
    accountName: string;
    totalTxns: number;
    unmatchedCount: number;
    suggestedCount: number;
    confirmedCount: number;
    settledCount: number;
    lockedAt: Date | null;
    lastImported: string | null;
    lastUploaded: string | null;
  }[]>`
    SELECT
      a.id as "accountId",
      a.bank_code as "bankCode",
      a.account_no as "accountNo",
      a.account_name as "accountName",
      -- "ข้อมูลถึงวันนี้" = วันสุดท้ายของรายการในไฟล์ (ไม่ใช่วันที่กดอัพ)
      (SELECT MAX(t2.txn_date)::text FROM ledger_bank_txn t2 WHERE t2.bank_account_id = a.id) as "lastImported",
      -- วันที่กดนำเข้าจริง (batch ล่าสุด) — โชว์แยกกันกันสับสน
      (SELECT MAX(b2.created_at)::text FROM ledger_bank_import_batch b2 WHERE b2.bank_account_id = a.id) as "lastUploaded",
      COALESCE(SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END), 0)::int as "totalTxns",
      COALESCE(SUM(CASE WHEN t.match_state = 'unmatched' THEN 1 ELSE 0 END), 0)::int as "unmatchedCount",
      COALESCE(SUM(CASE WHEN t.match_state = 'suggested' THEN 1 ELSE 0 END), 0)::int as "suggestedCount",
      COALESCE(SUM(CASE WHEN t.match_state = 'confirmed' THEN 1 ELSE 0 END), 0)::int as "confirmedCount",
      -- "settled" = a human dealt with it: confirmed OR explicitly excluded
      COALESCE(SUM(CASE WHEN t.match_state IN ('confirmed','excluded') THEN 1 ELSE 0 END), 0)::int as "settledCount",
      MAX(b.locked_at) as "lockedAt"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    LEFT JOIN ledger_bank_import_batch b
      ON b.bank_account_id = a.id
      -- period OVERLAP (not nesting) so a statement spanning a month boundary still shows
      AND b.period_start <= ${periodEnd}::date
      AND b.period_end   >= ${periodStart}::date
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

    // "completed" (เขียว) means a HUMAN settled every row (confirmed/excluded) —
    // NEVER on auto-suggestions alone. Rows still in 'suggested' = รอยืนยัน (in_progress).
    let status: BankAccountStatus["status"] = "not_started";
    if (r.lockedAt) status = "locked";
    else if (r.totalTxns > 0 && r.settledCount === r.totalTxns) status = "completed";
    else if (r.totalTxns > 0) status = "in_progress";

    // "ค้างกระทบยอด" = anything a human hasn't settled yet (unmatched + suggested).
    const pendingCount = r.unmatchedCount + r.suggestedCount;

    return {
      accountId: r.accountId,
      bankCode: r.bankCode,
      accountNo: maskedNo,
      accountName: r.accountName,
      period,
      totalTxns: r.totalTxns,
      unmatchedCount: pendingCount,
      matchedCount: r.confirmedCount,
      lockedAt: r.lockedAt ? r.lockedAt.toISOString() : null,
      lastImportedDate: r.lastImported ?? null,
      lastUploadedAt: r.lastUploaded ?? null,
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
    ["confirmed", "excluded"]; // "กระทบยอดแล้ว" tab = human-settled (confirmed OR excluded)

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
