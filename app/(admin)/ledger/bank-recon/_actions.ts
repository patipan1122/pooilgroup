"use server";

// LedgerLine — Bank Reconciliation Server Actions
// All mutations: import batch, confirm match, reject suggestion, lock period.
// Node.js runtime required for SheetJS Buffer API (D8).

export const runtime = "nodejs";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { detectAndParse } from "@/lib/ledger/bank-adapters";
import {
  computeLineHash,
  computeBatchFingerprint,
  suggestMatches,
} from "@/lib/ledger/bank-statement-reconcile";
import {
  syncTrcloudRevenue,
  listRevenueEntriesForPeriod,
} from "@/lib/ledger/trcloud-revenue";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ImportDryRunResult = {
  ok: true;
  bankCode: string;
  formatVersion: string;
  accountNo: string;
  rowCount: number;
  periodStart: string;
  periodEnd: string;
  creditCount: number;
  debitCount: number;
  totalCreditSatang: number;
  totalDebitSatang: number;
  errors: string[];
  warnings: string[];
} | { ok: false; error: string };

export type ImportCommitResult = {
  ok: true;
  batchId: string;
  insertedCount: number;
  skippedCount: number;
} | { ok: false; error: string };

// ── 1. Dry-run preview (parse file, don't write to DB) ───────────────────────

export async function dryRunImportAction(formData: FormData): Promise<ImportDryRunResult> {
  await requireRole("super_admin", "org_admin", "admin");

  const file = formData.get("file") as File | null;
  if (!file) return { ok: false, error: "ไม่พบไฟล์" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "ไฟล์ใหญ่เกิน 10MB" };

  const content = await file.text();
  const result = detectAndParse(content);

  if (!result) {
    return {
      ok: false,
      error: "ไม่รู้จักรูปแบบไฟล์นี้ — รองรับ KBank KBIZ, SCB, TTB, BBL เท่านั้น",
    };
  }

  const warnings = [...result.errors];
  const creditRows = result.rows.filter((r) => r.amountSatang > 0);
  const debitRows  = result.rows.filter((r) => r.amountSatang < 0);

  // Balance continuity check (warn if first balance doesn't tie to previous)
  if (result.rows.length > 1) {
    for (let i = 1; i < result.rows.length; i++) {
      const prev = result.rows[i - 1];
      const curr = result.rows[i];
      const expectedBalance = prev.balanceSatang + curr.amountSatang;
      if (Math.abs(expectedBalance - curr.balanceSatang) > 500) {
        warnings.push(
          `แถวที่ ${i + 1}: ยอดคงเหลือไม่ต่อเนื่อง (คาดว่า ฿${(expectedBalance / 100).toFixed(2)} แต่ได้ ฿${(curr.balanceSatang / 100).toFixed(2)})`,
        );
        break; // report only first discrepancy to avoid noise
      }
    }
  }

  return {
    ok: true,
    bankCode: result.bankCode,
    formatVersion: result.formatVersion,
    accountNo: result.accountNo,
    rowCount: result.rows.length,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    creditCount: creditRows.length,
    debitCount: debitRows.length,
    totalCreditSatang: creditRows.reduce((s, r) => s + r.amountSatang, 0),
    totalDebitSatang: debitRows.reduce((s, r) => s + Math.abs(r.amountSatang), 0),
    errors: result.errors,
    warnings,
  };
}

// ── 2. Commit import (write to DB atomically via RPC) ────────────────────────

export async function commitImportAction(
  bankAccountId: string,
  formData: FormData,
): Promise<ImportCommitResult> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { org_id: orgId } = session.user;

  // Re-parse (don't trust client-side preview data)
  const file = formData.get("file") as File | null;
  if (!file) return { ok: false, error: "ไม่พบไฟล์" };

  const content = await file.text();
  const result = detectAndParse(content);
  if (!result) return { ok: false, error: "ไม่รู้จักรูปแบบไฟล์" };

  // Verify bank account belongs to org
  const acct = await prisma.$queryRaw<{ id: string; accountNo: string }[]>`
    SELECT a.id, a.account_no as "accountNo"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.id = ${bankAccountId}::uuid
      AND a.org_id = ${orgId}::uuid
      AND ac.can_import = true
    LIMIT 1
  `;
  if (!acct.length) return { ok: false, error: "ไม่พบบัญชีธนาคาร หรือไม่มีสิทธิ์ import" };

  const companyRow = await prisma.$queryRaw<{ companyId: string }[]>`
    SELECT company_id as "companyId"
    FROM ledger_bank_account_company
    WHERE bank_account_id = ${bankAccountId}::uuid
      AND org_id = ${orgId}::uuid
      AND can_import = true
    LIMIT 1
  `;
  const companyId = companyRow[0]?.companyId;
  if (!companyId) return { ok: false, error: "ไม่พบ company สำหรับบัญชีนี้" };

  const batchId = randomUUID();
  const accountNo = acct[0].accountNo;

  // Build txn rows with lineHash
  const txnRows = result.rows.map((row) => {
    const lineHash = computeLineHash({
      accountNo,
      txnDate: row.txnDate,
      amountSatang: row.amountSatang,
      balanceSatang: row.balanceSatang,
      ref1: row.ref1,
      batchId,
      rowIndex: row.rowIndex,
    });
    return {
      org_id: orgId,
      company_id: companyId,
      bank_account_id: bankAccountId,
      line_hash: lineHash,
      txn_date: row.txnDate,
      value_date: row.valueDate,
      amount_satang: row.amountSatang,
      balance_satang: row.balanceSatang,
      ref1: row.ref1,
      ref2: row.ref2,
      description: row.description,
      channel: row.channel,
      source_type: "CSV",
      row_index: row.rowIndex,
      raw_row_json: row.rawRow,
    };
  });

  const batchPayload = {
    id: batchId,
    org_id: orgId,
    company_id: companyId,
    bank_account_id: bankAccountId,
    period_start: result.periodStart,
    period_end: result.periodEnd,
    batch_format_version: result.formatVersion,
    source_filename: file.name,
    row_count: result.rows.length,
    uploaded_by: session.user.id,
  };

  // Call atomic RPC (D9)
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ledger_bank_insert_batch", {
    p_batch: batchPayload,
    p_txns: txnRows,
  });

  if (error) {
    console.error("[bank-recon] import RPC error:", error);
    return { ok: false, error: `นำเข้าไม่สำเร็จ: ${error.message}` };
  }

  // Run auto-match in background (non-blocking suggestions, no confirm)
  const insertedIds = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_bank_txn
    WHERE batch_id = ${batchId}::uuid
      AND match_state = 'unmatched'
      AND amount_satang > 0
    LIMIT 100
  `;

  if (insertedIds.length > 0) {
    const txnIds = insertedIds.map((r) => r.id);
    // Fire-and-forget — suggestions are written via a separate action
    suggestMatchesAction(batchId, txnIds, orgId, companyId).catch(console.error);
  }

  return {
    ok: true,
    batchId,
    insertedCount: data?.inserted ?? 0,
    skippedCount: data?.skipped ?? 0,
  };
}

// ── 3. Write auto-match suggestions to DB ─────────────────────────────────────

async function suggestMatchesAction(
  batchId: string,
  txnIds: string[],
  orgId: string,
  companyId: string,
): Promise<void> {
  const suggestions = await suggestMatches({ orgId, companyId, bankTxnIds: txnIds });

  for (const s of suggestions) {
    // Insert into ledger_bank_match with appropriate book column (no dynamic column names)
    if (s.bookType === "payment") {
      await prisma.$executeRaw`
        INSERT INTO ledger_bank_match
          (org_id, company_id, bank_txn_id, matched_payment_id,
           match_type, confidence, amount_satang, delta_satang, status)
        VALUES
          (${orgId}::uuid, ${companyId}::uuid, ${s.bankTxnId}::uuid, ${s.bookId}::uuid,
           ${s.matchType}, ${s.confidence},
           ${s.bankAmountSatang}, ${s.deltaSatang}, 'suggested')
        ON CONFLICT DO NOTHING
      `;
    } else if (s.bookType === "expense") {
      await prisma.$executeRaw`
        INSERT INTO ledger_bank_match
          (org_id, company_id, bank_txn_id, matched_expense_id,
           match_type, confidence, amount_satang, delta_satang, status)
        VALUES
          (${orgId}::uuid, ${companyId}::uuid, ${s.bankTxnId}::uuid, ${s.bookId}::uuid,
           ${s.matchType}, ${s.confidence},
           ${s.bankAmountSatang}, ${s.deltaSatang}, 'suggested')
        ON CONFLICT DO NOTHING
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO ledger_bank_match
          (org_id, company_id, bank_txn_id, matched_payment_request_id,
           match_type, confidence, amount_satang, delta_satang, status)
        VALUES
          (${orgId}::uuid, ${companyId}::uuid, ${s.bankTxnId}::uuid, ${s.bookId}::uuid,
           ${s.matchType}, ${s.confidence},
           ${s.bankAmountSatang}, ${s.deltaSatang}, 'suggested')
        ON CONFLICT DO NOTHING
      `;
    }

    // Update txn match_state to 'suggested'
    await prisma.$executeRaw`
      UPDATE ledger_bank_txn
      SET match_state = 'suggested'
      WHERE id = ${s.bankTxnId}::uuid
        AND match_state = 'unmatched'
    `;
  }
}

// ── 4. Confirm a match (human approval) ──────────────────────────────────────

export async function confirmMatchAction(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");

  const updated = await prisma.$executeRaw`
    UPDATE ledger_bank_match
    SET status = 'confirmed',
        confirmed_by = ${session.user.id}::uuid,
        confirmed_at = now(),
        updated_at = now()
    WHERE id = ${matchId}::uuid
      AND status = 'suggested'
  `;

  if (!updated) return { ok: false, error: "ไม่พบ match หรือยืนยันไปแล้ว" };

  // Update txn state
  await prisma.$executeRaw`
    UPDATE ledger_bank_txn t
    SET match_state = 'confirmed'
    FROM ledger_bank_match m
    WHERE m.id = ${matchId}::uuid
      AND t.id = m.bank_txn_id
  `;

  return { ok: true };
}

// ── 5. Create manual match ─────────────────────────────────────────────────────

export async function createManualMatchAction(params: {
  bankTxnId: string;
  bookType: "expense" | "payment" | "payment_request";
  bookId: string;
  note?: string;
}): Promise<{ ok: boolean; matchId?: string; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { bankTxnId, bookType, bookId, note } = params;

  // Get bank txn amount
  const txn = await prisma.$queryRaw<{ amountSatang: number; orgId: string; companyId: string }[]>`
    SELECT amount_satang as "amountSatang", org_id as "orgId", company_id as "companyId"
    FROM ledger_bank_txn
    WHERE id = ${bankTxnId}::uuid
    LIMIT 1
  `;
  if (!txn.length) return { ok: false, error: "ไม่พบ transaction ธนาคาร" };

  const { amountSatang, orgId, companyId } = txn[0];

  // Get book amount based on type
  let bookAmountSatang = 0;
  if (bookType === "payment") {
    const r = await prisma.$queryRaw<{ amount: number }[]>`
      SELECT ROUND(amount * 100)::bigint as amount FROM ledger_payment WHERE id = ${bookId}::uuid LIMIT 1
    `;
    bookAmountSatang = r[0]?.amount ?? 0;
  }

  const deltaSatang = amountSatang - bookAmountSatang;
  const matchId = randomUUID();

  const matchedCol = bookType === "payment"
    ? `matched_payment_id`
    : bookType === "expense"
    ? `matched_expense_id`
    : `matched_payment_request_id`;

  await prisma.$executeRaw`
    INSERT INTO ledger_bank_match (
      id, org_id, company_id, bank_txn_id,
      match_type, confidence, amount_satang, delta_satang,
      status, matched_by, matched_at, note
    ) VALUES (
      ${matchId}::uuid, ${orgId}::uuid, ${companyId}::uuid, ${bankTxnId}::uuid,
      'manual', 'high', ${amountSatang}, ${deltaSatang},
      'confirmed', ${session.user.id}::uuid, now(), ${note ?? null}
    )
  `;

  // Set book ID (dynamic column name — safe, only 3 allowed values)
  if (bookType === "payment") {
    await prisma.$executeRaw`
      UPDATE ledger_bank_match SET matched_payment_id = ${bookId}::uuid WHERE id = ${matchId}::uuid
    `;
  } else if (bookType === "expense") {
    await prisma.$executeRaw`
      UPDATE ledger_bank_match SET matched_expense_id = ${bookId}::uuid WHERE id = ${matchId}::uuid
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE ledger_bank_match SET matched_payment_request_id = ${bookId}::uuid WHERE id = ${matchId}::uuid
    `;
  }

  // Mark txn confirmed
  await prisma.$executeRaw`
    UPDATE ledger_bank_txn SET match_state = 'confirmed' WHERE id = ${bankTxnId}::uuid
  `;

  return { ok: true, matchId };
}

// ── 6. Reject / revert a suggestion ──────────────────────────────────────────

export async function rejectMatchAction(matchId: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("super_admin", "org_admin", "admin");

  await prisma.$executeRaw`
    UPDATE ledger_bank_match SET status = 'reversed', updated_at = now()
    WHERE id = ${matchId}::uuid AND status = 'suggested'
  `;

  await prisma.$executeRaw`
    UPDATE ledger_bank_txn t SET match_state = 'unmatched'
    FROM ledger_bank_match m
    WHERE m.id = ${matchId}::uuid AND t.id = m.bank_txn_id AND t.match_state = 'suggested'
  `;

  return { ok: true };
}

// ── 7. Lock period ────────────────────────────────────────────────────────────

export async function lockPeriodAction(batchId: string): Promise<{ ok: boolean; fingerprint?: string; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");

  // Check for any unmatched txns
  const unmatched = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM ledger_bank_txn
    WHERE batch_id = ${batchId}::uuid AND match_state = 'unmatched'
  `;
  if ((unmatched[0]?.count ?? 0) > 0) {
    return { ok: false, error: `ยังมี ${unmatched[0]?.count} รายการที่ยังไม่ได้กระทบยอด — กรุณาจัดการก่อนล็อก` };
  }

  // Compute fingerprint from all line_hashes
  const hashes = await prisma.$queryRaw<{ lineHash: string }[]>`
    SELECT line_hash as "lineHash" FROM ledger_bank_txn
    WHERE batch_id = ${batchId}::uuid ORDER BY row_index
  `;
  const fingerprint = computeBatchFingerprint(hashes.map((h) => h.lineHash));

  await prisma.$executeRaw`
    UPDATE ledger_bank_import_batch
    SET locked_at = now(), locked_by = ${session.user.id}::uuid,
        lock_fingerprint = ${fingerprint}, status = 'locked', updated_at = now()
    WHERE id = ${batchId}::uuid AND locked_at IS NULL
  `;

  return { ok: true, fingerprint };
}

// ── 8. Sync TRCloud revenue entries for a batch period ───────────────────────

export async function syncRevenueAction(batchId: string): Promise<{
  ok: boolean;
  inserted?: number;
  skipped?: number;
  error?: string;
}> {
  const session = await requireRole("super_admin", "org_admin", "admin");

  const batch = await prisma.$queryRaw<{
    periodStart: string;
    periodEnd: string;
    orgId: string;
    companyId: string;
  }[]>`
    SELECT
      period_start::text as "periodStart",
      period_end::text as "periodEnd",
      org_id as "orgId",
      company_id as "companyId"
    FROM ledger_bank_import_batch
    WHERE id = ${batchId}::uuid
      AND org_id = ${session.user.org_id}::uuid
    LIMIT 1
  `;
  if (!batch.length) return { ok: false, error: "ไม่พบ batch" };

  const { periodStart, periodEnd, orgId, companyId } = batch[0];
  const result = await syncTrcloudRevenue({ orgId, companyId, periodStart, periodEnd });

  if (result.error) return { ok: false, error: result.error };
  return { ok: true, inserted: result.inserted, skipped: result.skipped };
}

// ── 9. List revenue entries for a batch period ───────────────────────────────

export async function listRevenueForBatchAction(batchId: string) {
  const session = await requireRole(
    "super_admin", "org_admin", "admin", "area_manager", "viewer",
  );

  const batch = await prisma.$queryRaw<{
    periodStart: string;
    periodEnd: string;
    orgId: string;
    companyId: string;
  }[]>`
    SELECT
      period_start::text as "periodStart",
      period_end::text as "periodEnd",
      org_id as "orgId",
      company_id as "companyId"
    FROM ledger_bank_import_batch
    WHERE id = ${batchId}::uuid
      AND org_id = ${session.user.org_id}::uuid
    LIMIT 1
  `;
  if (!batch.length) return [];

  const { periodStart, periodEnd, orgId, companyId } = batch[0];
  return listRevenueEntriesForPeriod({ orgId, companyId, periodStart, periodEnd });
}

// ── 10. List batches for an account ───────────────────────────────────────────

export async function listBatchesAction(bankAccountId: string) {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");

  return prisma.$queryRaw<{
    id: string;
    periodStart: string;
    periodEnd: string;
    insertedCount: number;
    status: string;
    lockedAt: string | null;
    fingerprint: string | null;
    createdAt: string;
  }[]>`
    SELECT
      b.id,
      b.period_start::text as "periodStart",
      b.period_end::text as "periodEnd",
      b.inserted_count as "insertedCount",
      b.status,
      b.locked_at::text as "lockedAt",
      b.lock_fingerprint as "fingerprint",
      b.created_at::text as "createdAt"
    FROM ledger_bank_import_batch b
    WHERE b.bank_account_id = ${bankAccountId}::uuid
      AND b.org_id = ${session.user.org_id}::uuid
    ORDER BY b.period_start DESC
    LIMIT 24
  `;
}
