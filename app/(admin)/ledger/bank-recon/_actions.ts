"use server";

// LedgerLine — Bank Reconciliation Server Actions
// All mutations: import batch, confirm match, reject suggestion, lock period.
//
// NOTE: do NOT add `export const runtime = "nodejs"` here — a "use server" file may
// ONLY export async functions (Turbopack build fails otherwise, even though tsc passes).
// Server actions already run on the Node.js runtime by default. ref memory
// feedback-use-server-only-async-2026-06-02.

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
  if (!result.rows.length || !result.periodStart || !result.periodEnd) {
    return { ok: false, error: "ไฟล์นี้ไม่มีรายการเดินบัญชี (statement ว่าง)" };
  }

  // Verify bank account belongs to org
  const acct = await prisma.$queryRaw<{ id: string; accountNo: string; bankCode: string }[]>`
    SELECT a.id, a.account_no as "accountNo", a.bank_code as "bankCode"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.id = ${bankAccountId}::uuid
      AND a.org_id = ${orgId}::uuid
      AND ac.can_import = true
    LIMIT 1
  `;
  if (!acct.length) return { ok: false, error: "ไม่พบบัญชีธนาคาร หรือไม่มีสิทธิ์ import" };

  // P0-12: the detected file format must match the account's bank (don't import
  // a KBank statement into an SCB account just because auto-detect guessed).
  if (result.bankCode !== acct[0].bankCode) {
    return {
      ok: false,
      error: `ไฟล์นี้เป็นรูปแบบ ${result.bankCode} แต่บัญชีที่เลือกเป็น ${acct[0].bankCode} — อัปไฟล์ผิดธนาคาร`,
    };
  }

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

  // P0-6: verify the file actually belongs to THIS account (prevent importing
  // e.g. an SCB statement into a KBank account → money mixed across accounts).
  // Compare digits-only; require the last 4 digits to match (statements may mask
  // or format the number differently than what we store).
  const digitsOnly = (s: string) => s.replace(/\D/g, "");
  const fileDigits = digitsOnly(result.accountNo ?? "");
  const acctDigits = digitsOnly(accountNo);
  if (fileDigits && acctDigits && fileDigits.slice(-4) !== acctDigits.slice(-4)) {
    return {
      ok: false,
      error: `เลขบัญชีในไฟล์ (…${fileDigits.slice(-4)}) ไม่ตรงกับบัญชีที่เลือก (…${acctDigits.slice(-4)}) — อาจอัปไฟล์ผิดบัญชี`,
    };
  }

  // Build txn rows with lineHash
  const txnRows = result.rows.map((row) => {
    const lineHash = computeLineHash({
      accountNo,
      txnDate: row.txnDate,
      amountSatang: row.amountSatang,
      balanceSatang: row.balanceSatang,
      ref1: row.ref1,
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

  // Run auto-match in background (non-blocking suggestions, no confirm).
  // BOTH credits and debits — the engine handles each direction (P0: was credit-only,
  // so debits never got auto-suggested). Cap raised; large statements still covered.
  const insertedIds = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_bank_txn
    WHERE batch_id = ${batchId}::uuid
      AND match_state = 'unmatched'
      AND amount_satang <> 0
    LIMIT 1000
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
    if (s.bookType === "revenue") {
      await prisma.$executeRaw`
        INSERT INTO ledger_bank_match
          (org_id, company_id, bank_txn_id, matched_revenue_id,
           match_type, confidence, amount_satang, delta_satang, status)
        VALUES
          (${orgId}::uuid, ${companyId}::uuid, ${s.bankTxnId}::uuid, ${s.bookId}::uuid,
           ${s.matchType}, ${s.confidence},
           ${s.bankAmountSatang}, ${s.deltaSatang}, 'suggested')
        ON CONFLICT DO NOTHING
      `;
    } else if (s.bookType === "payment") {
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

// ── helper: is the batch behind this txn/match locked? (org-scoped) ──────────
// Prisma runs as the postgres role (rolbypassrls=TRUE) → RLS is NOT a backstop.
// Every query here MUST self-scope org_id. ref memory feedback-ledger-query-must-filter-companyid.

// ── 4. Confirm a match (human approval) ──────────────────────────────────────

export async function confirmMatchAction(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;

  const rows = await prisma.$queryRaw<{
    bankTxnId: string;
    matchedRevenueId: string | null;
    locked: boolean;
  }[]>`
    SELECT m.bank_txn_id as "bankTxnId",
           m.matched_revenue_id as "matchedRevenueId",
           (b.locked_at IS NOT NULL) as "locked"
    FROM ledger_bank_match m
    JOIN ledger_bank_txn t ON t.id = m.bank_txn_id
    JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE m.id = ${matchId}::uuid
      AND m.org_id = ${orgId}::uuid
      AND m.status = 'suggested'
    LIMIT 1
  `;
  if (!rows.length) return { ok: false, error: "ไม่พบ match หรือยืนยันไปแล้ว" };
  const { bankTxnId, matchedRevenueId, locked } = rows[0];
  if (locked) return { ok: false, error: "งวดนี้ล็อกแล้ว แก้ไขการกระทบยอดไม่ได้" };

  const ops = [
    prisma.$executeRaw`
      UPDATE ledger_bank_match
      SET status='confirmed', confirmed_by=${session.user.id}::uuid, confirmed_at=now(), updated_at=now()
      WHERE id=${matchId}::uuid AND org_id=${orgId}::uuid AND status='suggested'
    `,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='confirmed'
      WHERE id=${bankTxnId}::uuid AND org_id=${orgId}::uuid
    `,
  ];
  // Write-back: close the revenue entry so it is never re-suggested (P0-3, anti double-count)
  if (matchedRevenueId) {
    ops.push(prisma.$executeRaw`
      UPDATE ledger_revenue_entry
      SET match_state='matched', bank_txn_id=${bankTxnId}::uuid, updated_at=now()
      WHERE id=${matchedRevenueId}::uuid AND org_id=${orgId}::uuid
    `);
  }
  await prisma.$transaction(ops);
  return { ok: true };
}

// ── 5. Create manual match ─────────────────────────────────────────────────────

export async function createManualMatchAction(params: {
  bankTxnId: string;
  bookType: "expense" | "payment" | "payment_request" | "revenue";
  bookId: string;
  note?: string;
}): Promise<{ ok: boolean; matchId?: string; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const { bankTxnId, bookType, bookId, note } = params;

  // Bank txn must belong to caller's org + its batch must not be locked
  const txn = await prisma.$queryRaw<{
    amountSatang: number; companyId: string; locked: boolean;
  }[]>`
    SELECT t.amount_satang as "amountSatang", t.company_id as "companyId",
           (b.locked_at IS NOT NULL) as "locked"
    FROM ledger_bank_txn t
    JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE t.id = ${bankTxnId}::uuid AND t.org_id = ${orgId}::uuid
    LIMIT 1
  `;
  if (!txn.length) return { ok: false, error: "ไม่พบ transaction ธนาคาร" };
  const { amountSatang, companyId, locked } = txn[0];
  if (locked) return { ok: false, error: "งวดนี้ล็อกแล้ว แก้ไขการกระทบยอดไม่ได้" };

  // Resolve book amount (in satang), org+company scoped, by type
  let bookAmountSatang = 0;
  if (bookType === "revenue") {
    const r = await prisma.$queryRaw<{ amt: number }[]>`
      SELECT amount_satang as amt FROM ledger_revenue_entry
      WHERE id=${bookId}::uuid AND org_id=${orgId}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if (!r.length) return { ok: false, error: "ไม่พบรายการรายได้ที่เลือก" };
    bookAmountSatang = Number(r[0].amt);
  } else if (bookType === "payment") {
    const r = await prisma.$queryRaw<{ amt: number }[]>`
      SELECT ROUND(amount*100)::bigint as amt FROM ledger_payment
      WHERE id=${bookId}::uuid AND org_id=${orgId}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if (!r.length) return { ok: false, error: "ไม่พบรายการจ่ายที่เลือก" };
    bookAmountSatang = Number(r[0].amt);
  } else if (bookType === "expense") {
    const r = await prisma.$queryRaw<{ amt: number }[]>`
      SELECT ROUND(total*100)::bigint as amt FROM ledger_expense
      WHERE id=${bookId}::uuid AND org_id=${orgId}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if (!r.length) return { ok: false, error: "ไม่พบบิลค่าใช้จ่ายที่เลือก" };
    bookAmountSatang = Number(r[0].amt);
  } else {
    const r = await prisma.$queryRaw<{ amt: number }[]>`
      SELECT ROUND(paid_total*100)::bigint as amt FROM ledger_payment_request
      WHERE id=${bookId}::uuid AND org_id=${orgId}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if (!r.length) return { ok: false, error: "ไม่พบใบขอโอนที่เลือก" };
    bookAmountSatang = Number(r[0].amt);
  }

  // Bank debits are negative; book amounts are positive magnitudes → compare absolutes.
  const deltaSatang = Math.abs(amountSatang) - bookAmountSatang;
  const matchId = randomUUID();

  const ops = [
    bookType === "revenue"
      ? prisma.$executeRaw`
          INSERT INTO ledger_bank_match (id, org_id, company_id, bank_txn_id, matched_revenue_id,
            match_type, confidence, amount_satang, delta_satang, status, matched_by, matched_at, note)
          VALUES (${matchId}::uuid, ${orgId}::uuid, ${companyId}::uuid, ${bankTxnId}::uuid, ${bookId}::uuid,
            'manual','high',${amountSatang},${deltaSatang},'confirmed',${session.user.id}::uuid, now(), ${note ?? null})`
      : bookType === "payment"
      ? prisma.$executeRaw`
          INSERT INTO ledger_bank_match (id, org_id, company_id, bank_txn_id, matched_payment_id,
            match_type, confidence, amount_satang, delta_satang, status, matched_by, matched_at, note)
          VALUES (${matchId}::uuid, ${orgId}::uuid, ${companyId}::uuid, ${bankTxnId}::uuid, ${bookId}::uuid,
            'manual','high',${amountSatang},${deltaSatang},'confirmed',${session.user.id}::uuid, now(), ${note ?? null})`
      : bookType === "expense"
      ? prisma.$executeRaw`
          INSERT INTO ledger_bank_match (id, org_id, company_id, bank_txn_id, matched_expense_id,
            match_type, confidence, amount_satang, delta_satang, status, matched_by, matched_at, note)
          VALUES (${matchId}::uuid, ${orgId}::uuid, ${companyId}::uuid, ${bankTxnId}::uuid, ${bookId}::uuid,
            'manual','high',${amountSatang},${deltaSatang},'confirmed',${session.user.id}::uuid, now(), ${note ?? null})`
      : prisma.$executeRaw`
          INSERT INTO ledger_bank_match (id, org_id, company_id, bank_txn_id, matched_payment_request_id,
            match_type, confidence, amount_satang, delta_satang, status, matched_by, matched_at, note)
          VALUES (${matchId}::uuid, ${orgId}::uuid, ${companyId}::uuid, ${bankTxnId}::uuid, ${bookId}::uuid,
            'manual','high',${amountSatang},${deltaSatang},'confirmed',${session.user.id}::uuid, now(), ${note ?? null})`,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='confirmed' WHERE id=${bankTxnId}::uuid AND org_id=${orgId}::uuid`,
  ];
  if (bookType === "revenue") {
    ops.push(prisma.$executeRaw`
      UPDATE ledger_revenue_entry SET match_state='matched', bank_txn_id=${bankTxnId}::uuid, updated_at=now()
      WHERE id=${bookId}::uuid AND org_id=${orgId}::uuid`);
  }

  try {
    await prisma.$transaction(ops);
  } catch {
    return { ok: false, error: "รายการนี้ถูกจับคู่ไปแล้ว หรือบันทึกไม่สำเร็จ" };
  }
  return { ok: true, matchId };
}

// ── 6. Reject / revert a suggestion ──────────────────────────────────────────

export async function rejectMatchAction(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;

  const rows = await prisma.$queryRaw<{ bankTxnId: string; locked: boolean }[]>`
    SELECT m.bank_txn_id as "bankTxnId", (b.locked_at IS NOT NULL) as "locked"
    FROM ledger_bank_match m
    JOIN ledger_bank_txn t ON t.id = m.bank_txn_id
    JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE m.id = ${matchId}::uuid AND m.org_id = ${orgId}::uuid AND m.status = 'suggested'
    LIMIT 1
  `;
  if (!rows.length) return { ok: false, error: "ไม่พบ suggestion" };
  if (rows[0].locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };

  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE ledger_bank_match SET status='reversed', reversed_by=${session.user.id}::uuid,
        reversed_at=now(), updated_at=now()
      WHERE id=${matchId}::uuid AND org_id=${orgId}::uuid AND status='suggested'`,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='unmatched'
      WHERE id=${rows[0].bankTxnId}::uuid AND org_id=${orgId}::uuid AND match_state='suggested'`,
  ]);
  return { ok: true };
}

// ── 6b. Un-confirm a confirmed match (only before lock) ──────────────────────

export async function unconfirmMatchAction(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;

  const rows = await prisma.$queryRaw<{
    bankTxnId: string; matchedRevenueId: string | null; locked: boolean;
  }[]>`
    SELECT m.bank_txn_id as "bankTxnId", m.matched_revenue_id as "matchedRevenueId",
           (b.locked_at IS NOT NULL) as "locked"
    FROM ledger_bank_match m
    JOIN ledger_bank_txn t ON t.id = m.bank_txn_id
    JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE m.id = ${matchId}::uuid AND m.org_id = ${orgId}::uuid AND m.status = 'confirmed'
    LIMIT 1
  `;
  if (!rows.length) return { ok: false, error: "ไม่พบรายการที่ยืนยันไว้" };
  if (rows[0].locked) return { ok: false, error: "งวดนี้ล็อกแล้ว ยกเลิกการยืนยันไม่ได้" };

  const ops = [
    prisma.$executeRaw`
      UPDATE ledger_bank_match SET status='reversed', reversed_by=${session.user.id}::uuid,
        reversed_at=now(), reversal_reason='un-confirm', updated_at=now()
      WHERE id=${matchId}::uuid AND org_id=${orgId}::uuid AND status='confirmed'`,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='unmatched'
      WHERE id=${rows[0].bankTxnId}::uuid AND org_id=${orgId}::uuid`,
  ];
  if (rows[0].matchedRevenueId) {
    ops.push(prisma.$executeRaw`
      UPDATE ledger_revenue_entry SET match_state='unmatched', bank_txn_id=NULL, updated_at=now()
      WHERE id=${rows[0].matchedRevenueId}::uuid AND org_id=${orgId}::uuid`);
  }
  await prisma.$transaction(ops);
  return { ok: true };
}

// ── 6c. Exclude a txn (no book counterpart: bank fee, interest, owner transfer) ──

export async function excludeTxnAction(params: {
  bankTxnId: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const { bankTxnId, reason } = params;
  if (!reason?.trim()) return { ok: false, error: "กรุณาระบุเหตุผลที่ข้ามรายการนี้" };

  const txn = await prisma.$queryRaw<{
    amountSatang: number; companyId: string; locked: boolean; state: string;
  }[]>`
    SELECT t.amount_satang as "amountSatang", t.company_id as "companyId",
           (b.locked_at IS NOT NULL) as "locked", t.match_state as "state"
    FROM ledger_bank_txn t
    JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE t.id = ${bankTxnId}::uuid AND t.org_id = ${orgId}::uuid
    LIMIT 1
  `;
  if (!txn.length) return { ok: false, error: "ไม่พบ transaction" };
  if (txn[0].locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };

  const { amountSatang, companyId } = txn[0];
  const matchId = randomUUID();
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO ledger_bank_match (id, org_id, company_id, bank_txn_id,
        match_type, confidence, amount_satang, delta_satang, status,
        matched_by, matched_at, exclusion_reason)
      VALUES (${matchId}::uuid, ${orgId}::uuid, ${companyId}::uuid, ${bankTxnId}::uuid,
        'exclusion','high',${amountSatang}, 0, 'confirmed',
        ${session.user.id}::uuid, now(), ${reason.trim()})`,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='excluded'
      WHERE id=${bankTxnId}::uuid AND org_id=${orgId}::uuid`,
  ]);
  return { ok: true };
}

// ── 7. Lock period ────────────────────────────────────────────────────────────

export async function lockPeriodAction(batchId: string): Promise<{ ok: boolean; fingerprint?: string; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;

  // Batch must belong to caller's org (RLS does not apply to Prisma)
  const batch = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT (locked_at IS NOT NULL) as locked FROM ledger_bank_import_batch
    WHERE id = ${batchId}::uuid AND org_id = ${orgId}::uuid LIMIT 1
  `;
  if (!batch.length) return { ok: false, error: "ไม่พบงวดนี้" };
  if (batch[0].locked) return { ok: false, error: "งวดนี้ล็อกไปแล้ว" };

  // "settled" = confirmed or excluded. Anything still unmatched/suggested blocks the lock.
  const pending = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM ledger_bank_txn
    WHERE batch_id = ${batchId}::uuid AND org_id = ${orgId}::uuid
      AND match_state NOT IN ('confirmed','excluded')
  `;
  if ((pending[0]?.count ?? 0) > 0) {
    return { ok: false, error: `ยังมี ${pending[0]?.count} รายการที่ยังไม่ได้ยืนยัน/ข้าม — จัดการให้ครบก่อนล็อก` };
  }

  // Compute fingerprint from all line_hashes (org-scoped)
  const hashes = await prisma.$queryRaw<{ lineHash: string }[]>`
    SELECT line_hash as "lineHash" FROM ledger_bank_txn
    WHERE batch_id = ${batchId}::uuid AND org_id = ${orgId}::uuid ORDER BY row_index
  `;
  const fingerprint = computeBatchFingerprint(hashes.map((h) => h.lineHash));

  await prisma.$executeRaw`
    UPDATE ledger_bank_import_batch
    SET locked_at = now(), locked_by = ${session.user.id}::uuid,
        lock_fingerprint = ${fingerprint}, status = 'locked', updated_at = now()
    WHERE id = ${batchId}::uuid AND org_id = ${orgId}::uuid AND locked_at IS NULL
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

// ════════════════════════════════════════════════════════════════════════════
// PEAK-parity group matching (N:M) — รอกระทบยอด → รอยืนยัน → กระทบยอดทั้งหมด
// ════════════════════════════════════════════════════════════════════════════

type BookRef = { bookType: "revenue" | "expense" | "payment"; bookId: string };

async function fetchBookAmount(
  orgId: string, companyId: string, ref: BookRef,
): Promise<{ amountSatang: number; docNo: string } | null> {
  if (ref.bookType === "revenue") {
    const r = await prisma.$queryRaw<{ amt: bigint; doc: string }[]>`
      SELECT amount_satang as amt, COALESCE(source_ref,'') as doc FROM ledger_revenue_entry
      WHERE id=${ref.bookId}::uuid AND org_id=${orgId}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    return r.length ? { amountSatang: Number(r[0].amt), docNo: r[0].doc } : null;
  }
  if (ref.bookType === "expense") {
    const r = await prisma.$queryRaw<{ amt: bigint; doc: string }[]>`
      SELECT (-ROUND(total*100))::bigint as amt, COALESCE(doc_code,'') as doc FROM ledger_expense
      WHERE id=${ref.bookId}::uuid AND org_id=${orgId}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    return r.length ? { amountSatang: Number(r[0].amt), docNo: r[0].doc } : null;
  }
  const r = await prisma.$queryRaw<{ amt: bigint; doc: string }[]>`
    SELECT (-ROUND(amount*100))::bigint as amt, COALESCE(trans_ref,'') as doc FROM ledger_payment
    WHERE id=${ref.bookId}::uuid AND org_id=${orgId}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
  return r.length ? { amountSatang: Number(r[0].amt), docNo: r[0].doc } : null;
}

// Create a match group from selected bank movements + book entries.
export async function createMatchGroupAction(params: {
  bankAccountId: string;
  bankTxnIds: string[];
  bookRefs: BookRef[];
  matchKind?: "auto" | "manual";
  note?: string;
}): Promise<{ ok: boolean; error?: string; groupId?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const { bankAccountId, bankTxnIds, bookRefs } = params;

  if (!bankTxnIds.length || !bookRefs.length) {
    return { ok: false, error: "ต้องเลือกอย่างน้อย 1 รายการธนาคาร และ 1 รายการบัญชี" };
  }

  // Bank side: verify org + account + unmatched + not locked; sum amounts
  const bankRows = await prisma.$queryRaw<{
    id: string; amountSatang: bigint; companyId: string; locked: boolean; state: string;
  }[]>`
    SELECT t.id::text as id, t.amount_satang as "amountSatang", t.company_id as "companyId",
           (b.locked_at IS NOT NULL) as "locked", t.match_state as "state"
    FROM ledger_bank_txn t
    JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE t.id = ANY(${bankTxnIds}::uuid[]) AND t.org_id = ${orgId}::uuid
      AND t.bank_account_id = ${bankAccountId}::uuid
  `;
  if (bankRows.length !== bankTxnIds.length) return { ok: false, error: "ไม่พบรายการธนาคารบางรายการ" };
  if (bankRows.some((r) => r.locked)) return { ok: false, error: "งวดนี้ล็อกแล้ว" };
  if (bankRows.some((r) => r.state !== "unmatched")) return { ok: false, error: "บางรายการธนาคารถูกจับคู่ไปแล้ว" };

  const companyId = bankRows[0].companyId;
  const bankTotal = bankRows.reduce((s, r) => s + Number(r.amountSatang), 0);

  // Book side: fetch amounts
  let bookTotal = 0;
  const bookItems: { ref: BookRef; amountSatang: number; docNo: string }[] = [];
  for (const ref of bookRefs) {
    const b = await fetchBookAmount(orgId, companyId, ref);
    if (!b) return { ok: false, error: "ไม่พบรายการบัญชีบางรายการ" };
    bookTotal += b.amountSatang;
    bookItems.push({ ref, amountSatang: b.amountSatang, docNo: b.docNo });
  }

  const delta = bankTotal - bookTotal;
  const groupId = randomUUID();

  const ops = [
    prisma.$executeRaw`
      INSERT INTO ledger_bank_match_group
        (id, org_id, company_id, bank_account_id, status, match_kind,
         bank_total_satang, book_total_satang, delta_satang, note, created_by)
      VALUES (${groupId}::uuid, ${orgId}::uuid, ${companyId}::uuid, ${bankAccountId}::uuid,
        'suggested', ${params.matchKind ?? "manual"},
        ${bankTotal}, ${bookTotal}, ${delta}, ${params.note ?? null}, ${session.user.id}::uuid)`,
  ];
  for (const r of bankRows) {
    ops.push(prisma.$executeRaw`
      INSERT INTO ledger_bank_match_item (id, group_id, org_id, kind, bank_txn_id, amount_satang)
      VALUES (gen_random_uuid(), ${groupId}::uuid, ${orgId}::uuid, 'bank', ${r.id}::uuid, ${Number(r.amountSatang)})`);
    ops.push(prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='suggested' WHERE id=${r.id}::uuid AND org_id=${orgId}::uuid AND match_state='unmatched'`);
  }
  for (const b of bookItems) {
    ops.push(prisma.$executeRaw`
      INSERT INTO ledger_bank_match_item (id, group_id, org_id, kind, book_type, book_id, book_doc_no, amount_satang)
      VALUES (gen_random_uuid(), ${groupId}::uuid, ${orgId}::uuid, 'book', ${b.ref.bookType}, ${b.ref.bookId}::uuid, ${b.docNo}, ${b.amountSatang})`);
  }

  try {
    await prisma.$transaction(ops);
  } catch {
    return { ok: false, error: "บางรายการถูกจับคู่ไปแล้ว หรือบันทึกไม่สำเร็จ" };
  }
  return { ok: true, groupId };
}

// Auto-match: pair each unmatched credit/debit with a single book entry of equal
// amount within ±2 days, creating suggested groups (PEAK step-1 auto).
export async function autoMatchGroupsAction(
  batchId: string, bankAccountId: string,
): Promise<{ ok: boolean; created: number; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;

  const batch = await prisma.$queryRaw<{ companyId: string; ps: string; pe: string; locked: boolean }[]>`
    SELECT company_id as "companyId", period_start::text as ps, period_end::text as pe,
           (locked_at IS NOT NULL) as locked
    FROM ledger_bank_import_batch WHERE id=${batchId}::uuid AND org_id=${orgId}::uuid LIMIT 1`;
  if (!batch.length) return { ok: false, created: 0, error: "ไม่พบงวด" };
  if (batch[0].locked) return { ok: false, created: 0, error: "งวดนี้ล็อกแล้ว" };
  const { companyId } = batch[0];

  // unmatched bank movements (this batch, not yet in a group)
  const banks = await prisma.$queryRaw<{ id: string; amt: bigint; d: string }[]>`
    SELECT t.id::text as id, t.amount_satang as amt, t.txn_date::text as d
    FROM ledger_bank_txn t
    WHERE t.batch_id=${batchId}::uuid AND t.org_id=${orgId}::uuid AND t.match_state='unmatched'
      AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.bank_txn_id=t.id)
    ORDER BY t.txn_date LIMIT 500`;

  // candidate book entries in period (not yet grouped)
  const book = await listBookEntriesForAuto(orgId, companyId, batch[0].ps, batch[0].pe);

  const usedBook = new Set<string>();
  let created = 0;
  for (const bk of banks) {
    const amt = Number(bk.amt);
    const bd = new Date(bk.d).getTime();
    const hit = book.find((e) => !usedBook.has(`${e.bookType}:${e.bookId}`)
      && e.amountSatang === amt
      && Math.abs((new Date(e.date).getTime() - bd) / 86400000) <= 2);
    if (!hit) continue;
    usedBook.add(`${hit.bookType}:${hit.bookId}`);
    const res = await createMatchGroupAction({
      bankAccountId, bankTxnIds: [bk.id],
      bookRefs: [{ bookType: hit.bookType, bookId: hit.bookId }], matchKind: "auto",
    });
    if (res.ok) created++;
  }
  return { ok: true, created };
}

async function listBookEntriesForAuto(orgId: string, companyId: string, ps: string, pe: string) {
  const { listBookEntries } = await import("@/lib/ledger/bank-reconcile-board");
  return listBookEntries({ orgId, companyId, periodStart: ps, periodEnd: pe });
}

export async function confirmGroupAction(groupId: string): Promise<{ ok: boolean; error?: string }> {
  return confirmGroupsInternal([groupId]);
}

export async function confirmAllGroupsAction(bankAccountId: string): Promise<{ ok: boolean; confirmed: number; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const groups = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM ledger_bank_match_group
    WHERE bank_account_id=${bankAccountId}::uuid AND org_id=${orgId}::uuid AND status='suggested'`;
  if (!groups.length) return { ok: true, confirmed: 0 };
  const res = await confirmGroupsInternal(groups.map((g) => g.id));
  return res.ok ? { ok: true, confirmed: groups.length } : { ok: false, confirmed: 0, error: res.error };
}

async function confirmGroupsInternal(groupIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;

  // guard: none locked
  const locked = await prisma.$queryRaw<{ c: number }[]>`
    SELECT COUNT(*)::int as c
    FROM ledger_bank_match_group g
    JOIN ledger_bank_match_item mi ON mi.group_id=g.id AND mi.kind='bank'
    JOIN ledger_bank_txn t ON t.id=mi.bank_txn_id
    JOIN ledger_bank_import_batch b ON b.id=t.batch_id
    WHERE g.id = ANY(${groupIds}::uuid[]) AND g.org_id=${orgId}::uuid AND b.locked_at IS NOT NULL`;
  if ((locked[0]?.c ?? 0) > 0) return { ok: false, error: "งวดนี้ล็อกแล้ว" };

  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE ledger_bank_match_group SET status='confirmed', confirmed_by=${session.user.id}::uuid,
        confirmed_at=now(), updated_at=now()
      WHERE id = ANY(${groupIds}::uuid[]) AND org_id=${orgId}::uuid AND status='suggested'`,
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='confirmed'
      WHERE org_id=${orgId}::uuid AND id IN (
        SELECT mi.bank_txn_id FROM ledger_bank_match_item mi
        WHERE mi.group_id = ANY(${groupIds}::uuid[]) AND mi.kind='bank')`,
    // close revenue book entries so the auto-match engine never re-suggests them
    prisma.$executeRaw`
      UPDATE ledger_revenue_entry SET match_state='matched', updated_at=now()
      WHERE org_id=${orgId}::uuid AND id IN (
        SELECT mi.book_id FROM ledger_bank_match_item mi
        WHERE mi.group_id = ANY(${groupIds}::uuid[]) AND mi.kind='book' AND mi.book_type='revenue')`,
  ]);
  return { ok: true };
}

// Remove a group (suggested or confirmed, if not locked) — frees bank + book entries.
export async function removeGroupAction(groupId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;

  const locked = await prisma.$queryRaw<{ c: number }[]>`
    SELECT COUNT(*)::int as c
    FROM ledger_bank_match_item mi
    JOIN ledger_bank_txn t ON t.id=mi.bank_txn_id
    JOIN ledger_bank_import_batch b ON b.id=t.batch_id
    WHERE mi.group_id=${groupId}::uuid AND mi.org_id=${orgId}::uuid AND b.locked_at IS NOT NULL`;
  if ((locked[0]?.c ?? 0) > 0) return { ok: false, error: "งวดนี้ล็อกแล้ว" };

  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='unmatched'
      WHERE org_id=${orgId}::uuid AND id IN (
        SELECT mi.bank_txn_id FROM ledger_bank_match_item mi
        WHERE mi.group_id=${groupId}::uuid AND mi.kind='bank')`,
    prisma.$executeRaw`
      UPDATE ledger_revenue_entry SET match_state='unmatched', bank_txn_id=NULL, updated_at=now()
      WHERE org_id=${orgId}::uuid AND id IN (
        SELECT mi.book_id FROM ledger_bank_match_item mi
        WHERE mi.group_id=${groupId}::uuid AND mi.kind='book' AND mi.book_type='revenue')`,
    prisma.$executeRaw`DELETE FROM ledger_bank_match_item WHERE group_id=${groupId}::uuid AND org_id=${orgId}::uuid`,
    prisma.$executeRaw`
      UPDATE ledger_bank_match_group SET status='reversed', reversed_by=${session.user.id}::uuid,
        reversed_at=now(), updated_at=now()
      WHERE id=${groupId}::uuid AND org_id=${orgId}::uuid`,
  ]);
  return { ok: true };
}

// Manually add a bank movement to a batch (PEAK "เพิ่มรายการ").
export async function addBankMovementAction(params: {
  batchId: string; bankAccountId: string; date: string;
  amountSatang: number; description: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const { batchId, bankAccountId, date, amountSatang, description } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "วันที่ไม่ถูกต้อง" };
  if (!Number.isInteger(amountSatang) || amountSatang === 0) return { ok: false, error: "จำนวนเงินไม่ถูกต้อง" };

  const acct = await prisma.$queryRaw<{ companyId: string; accountNo: string; locked: boolean }[]>`
    SELECT b.company_id as "companyId", a.account_no as "accountNo", (b.locked_at IS NOT NULL) as locked
    FROM ledger_bank_import_batch b JOIN ledger_bank_account a ON a.id=b.bank_account_id
    WHERE b.id=${batchId}::uuid AND b.org_id=${orgId}::uuid AND b.bank_account_id=${bankAccountId}::uuid LIMIT 1`;
  if (!acct.length) return { ok: false, error: "ไม่พบงวด" };
  if (acct[0].locked) return { ok: false, error: "งวดนี้ล็อกแล้ว" };

  const maxIdx = await prisma.$queryRaw<{ m: number }[]>`
    SELECT COALESCE(MAX(row_index),0)+1 as m FROM ledger_bank_txn WHERE batch_id=${batchId}::uuid`;
  const rowIndex = maxIdx[0]?.m ?? 1000;
  const lineHash = computeLineHash({
    accountNo: acct[0].accountNo, txnDate: date, amountSatang, balanceSatang: 0, ref1: "MANUAL", rowIndex,
  });
  try {
    await prisma.$executeRaw`
      INSERT INTO ledger_bank_txn
        (id, org_id, company_id, bank_account_id, batch_id, line_hash, txn_date,
         amount_satang, balance_satang, description, source_type, row_index)
      VALUES (gen_random_uuid(), ${orgId}::uuid, ${acct[0].companyId}::uuid, ${bankAccountId}::uuid,
        ${batchId}::uuid, ${lineHash}, ${date}::date, ${amountSatang}, 0, ${description || "เพิ่มเอง"},
        'MANUAL_BAAC', ${rowIndex})`;
  } catch {
    return { ok: false, error: "รายการนี้มีอยู่แล้ว หรือบันทึกไม่สำเร็จ" };
  }
  return { ok: true };
}

// Manually add a revenue book entry (PEAK book-side add / import รายได้).
export async function addRevenueEntryAction(params: {
  companyId: string; entryDate: string; amountSatang: number;
  description: string; customerName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const { companyId, entryDate, amountSatang, description, customerName } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return { ok: false, error: "วันที่ไม่ถูกต้อง" };
  if (!Number.isInteger(amountSatang) || amountSatang <= 0) return { ok: false, error: "จำนวนเงินต้องมากกว่า 0" };
  if (!companyId) return { ok: false, error: "ไม่พบบริษัท" };

  await prisma.$executeRaw`
    INSERT INTO ledger_revenue_entry
      (org_id, company_id, entry_date, amount_satang, source_type, description, customer_name)
    VALUES (${orgId}::uuid, ${companyId}::uuid, ${entryDate}::date, ${amountSatang},
      'MANUAL', ${description || "รายได้ (บันทึกเอง)"}, ${customerName ?? null})`;
  return { ok: true };
}
