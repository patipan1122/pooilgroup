// LedgerLine — Bank Reconcile Board (PEAK-parity, reconcile by DATE RANGE).
//
// PEAK reconciles an account over a continuous date range (not per imported file).
// So bank movements = ALL unmatched txns for the account in the period, regardless
// of which statement file they came from. Import just ADDS movements; reconciliation
// is continuous per account.
//
// LEFT  = รายการบันทึกบัญชี (book: revenue in / expense out / payment out)
// RIGHT = รายการเคลื่อนไหว (bank movements in the date range)
// All queries self-scope org_id + company_id (Prisma bypasses RLS).

import { prisma } from "@/lib/prisma";

export interface BookEntry {
  bookId: string;
  bookType: "revenue" | "expense" | "payment";
  date: string;
  docNo: string;
  contact: string;
  detail: string;
  amountSatang: number;
  sub: string;
}
export interface BankMovement {
  id: string;
  date: string;
  description: string;  // counterparty / purpose (ref2 preferred) — the meaningful line
  txnType: string;      // bank transaction type (description) + channel — secondary detail
  ref1: string | null;
  amountSatang: number;
}
export interface MatchGroup {
  id: string;
  status: string;
  matchKind: string;
  bankTotalSatang: number;
  bookTotalSatang: number;
  deltaSatang: number;
  items: {
    kind: "bank" | "book";
    bankTxnId: string | null;
    bookType: string | null;
    bookId: string | null;
    bookDocNo: string | null;
    label: string;
    date: string | null;
    amountSatang: number;
  }[];
}

// ── Book side: UN-reconciled entries in the period (not in any active group) ───
export async function listBookEntries(params: {
  orgId: string; companyId: string; periodStart: string; periodEnd: string;
}): Promise<BookEntry[]> {
  const { orgId, companyId, periodStart, periodEnd } = params;
  const rows = await prisma.$queryRaw<{
    bookId: string; bookType: string; date: string; docNo: string;
    contact: string; detail: string; amountSatang: bigint; sub: string;
  }[]>`
    SELECT * FROM (
      SELECT r.id::text as "bookId", 'revenue' as "bookType", r.entry_date::text as "date",
             COALESCE(r.source_ref, '') as "docNo",
             COALESCE(NULLIF(r.customer_name,''), NULLIF(r.description,''), '') as "contact",
             TRIM(CONCAT_WS(' · ', NULLIF(r.payment_channel,''), NULLIF(r.description,''))) as "detail",
             r.amount_satang as "amountSatang", COALESCE(r.source_type,'') as "sub"
      FROM ledger_revenue_entry r
      WHERE r.org_id = ${orgId}::uuid AND r.company_id = ${companyId}::uuid
        AND r.entry_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND r.match_state <> 'matched'
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.book_type='revenue' AND mi.book_id = r.id)
      UNION ALL
      SELECT e.id::text, 'expense', e.doc_date::text,
             COALESCE(NULLIF(e.doc_code,''), NULLIF(e.vendor_doc_number,''), ''),
             COALESCE(NULLIF(e.vendor,''), ''),
             TRIM(CONCAT_WS(' · ', NULLIF(e.doc_type,''), NULLIF(e.note,''))),
             (-ROUND(e.total*100))::bigint, COALESCE(e.doc_type,'')
      FROM ledger_expense e
      WHERE e.org_id = ${orgId}::uuid AND e.company_id = ${companyId}::uuid
        AND e.doc_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND COALESCE(e.total,0) > 0
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.book_type='expense' AND mi.book_id = e.id)
      UNION ALL
      SELECT p.id::text, 'payment', p.paid_at::date::text,
             COALESCE(p.trans_ref,''), '', COALESCE(p.method,''), (-ROUND(p.amount*100))::bigint, COALESCE(p.method,'')
      FROM ledger_payment p
      WHERE p.org_id = ${orgId}::uuid AND p.company_id = ${companyId}::uuid
        AND p.paid_at::date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND COALESCE(p.amount,0) > 0
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.book_type='payment' AND mi.book_id = p.id)
    ) u
    ORDER BY u."date", u."amountSatang" DESC
    LIMIT 500
  `;
  return rows.map((r) => ({
    bookId: r.bookId, bookType: r.bookType as BookEntry["bookType"], date: r.date,
    docNo: r.docNo, contact: r.contact, detail: r.detail, amountSatang: Number(r.amountSatang), sub: r.sub,
  }));
}

// ── Bank side: unmatched movements for the ACCOUNT in the date range ───────────
// (across all imported batches — reconcile is continuous per account, not per file)
export async function listBankMovements(params: {
  orgId: string; companyId: string; bankAccountId: string; periodStart: string; periodEnd: string;
}): Promise<BankMovement[]> {
  const { orgId, companyId, bankAccountId, periodStart, periodEnd } = params;
  const rows = await prisma.$queryRaw<{
    id: string; date: string; description: string; txnType: string; ref1: string | null; amountSatang: bigint;
  }[]>`
    SELECT t.id::text as id, t.txn_date::text as "date",
           -- the meaningful line: counterparty / purpose lives in ref2 (e.g. "รับโอนจาก KTB x6223 …")
           COALESCE(NULLIF(t.ref2,''), NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร') as "description",
           TRIM(CONCAT_WS(' · ', NULLIF(t.description,''), NULLIF(t.channel,''))) as "txnType",
           t.ref1, t.amount_satang as "amountSatang"
    FROM ledger_bank_txn t
    WHERE t.bank_account_id = ${bankAccountId}::uuid AND t.org_id = ${orgId}::uuid
      AND t.company_id = ${companyId}::uuid
      AND t.txn_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
      AND t.match_state = 'unmatched'
      AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.bank_txn_id = t.id)
    ORDER BY t.txn_date, t.row_index
    LIMIT 1000
  `;
  return rows.map((r) => ({
    id: r.id, date: r.date, description: r.description, txnType: r.txnType, ref1: r.ref1, amountSatang: Number(r.amountSatang),
  }));
}

// ── Suggested / confirmed groups (รอยืนยัน tab) ───────────────────────────────
export async function listMatchGroups(params: {
  orgId: string; companyId: string; bankAccountId: string; status: "suggested" | "confirmed";
}): Promise<MatchGroup[]> {
  const { orgId, companyId, bankAccountId, status } = params;
  const groups = await prisma.$queryRaw<{
    id: string; status: string; matchKind: string;
    bankTotalSatang: bigint; bookTotalSatang: bigint; deltaSatang: bigint;
  }[]>`
    SELECT id::text, status, match_kind as "matchKind",
           bank_total_satang as "bankTotalSatang", book_total_satang as "bookTotalSatang",
           delta_satang as "deltaSatang"
    FROM ledger_bank_match_group
    WHERE bank_account_id = ${bankAccountId}::uuid AND org_id = ${orgId}::uuid
      AND company_id = ${companyId}::uuid AND status = ${status}
    ORDER BY created_at DESC
    LIMIT 200
  `;
  if (!groups.length) return [];
  const ids = groups.map((g) => g.id);
  const items = await prisma.$queryRaw<{
    groupId: string; kind: string; bankTxnId: string | null; bookType: string | null;
    bookId: string | null; bookDocNo: string | null; label: string; date: string | null; amountSatang: bigint;
  }[]>`
    SELECT mi.group_id::text as "groupId", mi.kind, mi.bank_txn_id::text as "bankTxnId",
           mi.book_type as "bookType", mi.book_id::text as "bookId", mi.book_doc_no as "bookDocNo",
           CASE WHEN mi.kind='bank' THEN COALESCE(NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร')
                ELSE COALESCE(NULLIF(mi.book_doc_no,''), 'รายการบัญชี') END as "label",
           CASE WHEN mi.kind='bank' THEN t.txn_date::text ELSE NULL END as "date",
           mi.amount_satang as "amountSatang"
    FROM ledger_bank_match_item mi
    LEFT JOIN ledger_bank_txn t ON t.id = mi.bank_txn_id
    WHERE mi.group_id = ANY(${ids}::uuid[])
    ORDER BY mi.kind, mi.amount_satang DESC
  `;
  return groups.map((g) => ({
    id: g.id, status: g.status, matchKind: g.matchKind,
    bankTotalSatang: Number(g.bankTotalSatang), bookTotalSatang: Number(g.bookTotalSatang),
    deltaSatang: Number(g.deltaSatang),
    items: items.filter((i) => i.groupId === g.id).map((i) => ({
      kind: i.kind as "bank" | "book", bankTxnId: i.bankTxnId, bookType: i.bookType,
      bookId: i.bookId, bookDocNo: i.bookDocNo, label: i.label, date: i.date, amountSatang: Number(i.amountSatang),
    })),
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// Account overview (PEAK "ภาพรวมเงินเข้า-เงินออก" — รายการเคลื่อนไหว / รายการบันทึก)
// ════════════════════════════════════════════════════════════════════════════

export interface LedgerTxnRow {
  id: string; date: string; description: string; txnType: string; channel: string | null; ref1: string | null;
  amountSatang: number; balanceSatang: number; matchState: string;
}

// รายการเคลื่อนไหว (bank) — every txn in range with running balance + status + full detail
export async function listBankLedger(params: {
  orgId: string; companyId: string; bankAccountId: string; periodStart: string; periodEnd: string;
}): Promise<LedgerTxnRow[]> {
  const { orgId, companyId, bankAccountId, periodStart, periodEnd } = params;
  const rows = await prisma.$queryRaw<{
    id: string; date: string; description: string; txnType: string; channel: string | null; ref1: string | null;
    amountSatang: bigint; balanceSatang: bigint; matchState: string;
  }[]>`
    SELECT t.id::text as id, t.txn_date::text as "date",
           COALESCE(NULLIF(t.ref2,''), NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร') as "description",
           COALESCE(NULLIF(t.description,''),'') as "txnType",
           t.channel, t.ref1, t.amount_satang as "amountSatang", t.balance_satang as "balanceSatang",
           t.match_state as "matchState"
    FROM ledger_bank_txn t
    WHERE t.bank_account_id = ${bankAccountId}::uuid AND t.org_id = ${orgId}::uuid
      AND t.company_id = ${companyId}::uuid
      AND t.txn_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    ORDER BY t.txn_date DESC, t.row_index DESC
    LIMIT 1000
  `;
  return rows.map((r) => ({
    id: r.id, date: r.date, description: r.description, txnType: r.txnType, channel: r.channel, ref1: r.ref1,
    amountSatang: Number(r.amountSatang), balanceSatang: Number(r.balanceSatang), matchState: r.matchState,
  }));
}

export interface BookLedgerRow {
  bookId: string; bookType: string; date: string; docNo: string; contact: string;
  detail: string; kind: string; amountSatang: number; reconciled: boolean;
}

// รายการบันทึกบัญชี (book) — every entry in range with reconciled flag + detail
export async function listBookLedger(params: {
  orgId: string; companyId: string; periodStart: string; periodEnd: string;
}): Promise<BookLedgerRow[]> {
  const { orgId, companyId, periodStart, periodEnd } = params;
  const rows = await prisma.$queryRaw<{
    bookId: string; bookType: string; date: string; docNo: string; contact: string;
    detail: string; kind: string; amountSatang: bigint; reconciled: boolean;
  }[]>`
    SELECT * FROM (
      SELECT r.id::text as "bookId", 'revenue' as "bookType", r.entry_date::text as "date",
             COALESCE(r.source_ref,'') as "docNo",
             COALESCE(NULLIF(r.customer_name,''), NULLIF(r.description,''),'') as "contact",
             TRIM(CONCAT_WS(' · ', NULLIF(r.source_type,''), NULLIF(r.payment_channel,''), NULLIF(r.description,''))) as "detail",
             'รายได้' as "kind",
             r.amount_satang as "amountSatang",
             (r.match_state='matched' OR EXISTS(SELECT 1 FROM ledger_bank_match_item mi WHERE mi.book_type='revenue' AND mi.book_id=r.id)) as reconciled
      FROM ledger_revenue_entry r
      WHERE r.org_id=${orgId}::uuid AND r.company_id=${companyId}::uuid
        AND r.entry_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
      UNION ALL
      SELECT e.id::text, 'expense', e.doc_date::text,
             COALESCE(NULLIF(e.doc_code,''), NULLIF(e.vendor_doc_number,''),''),
             COALESCE(NULLIF(e.vendor,''),''),
             TRIM(CONCAT_WS(' · ', NULLIF(e.doc_type,''), NULLIF(e.note,''),
                  CASE e.payment_status WHEN 'paid' THEN 'จ่ายแล้ว' WHEN 'unpaid' THEN 'ยังไม่จ่าย' ELSE NULLIF(e.payment_status,'') END)) as "detail",
             'ค่าใช้จ่าย' as "kind",
             (-ROUND(e.total*100))::bigint,
             EXISTS(SELECT 1 FROM ledger_bank_match_item mi WHERE mi.book_type='expense' AND mi.book_id=e.id)
      FROM ledger_expense e
      WHERE e.org_id=${orgId}::uuid AND e.company_id=${companyId}::uuid
        AND e.doc_date BETWEEN ${periodStart}::date AND ${periodEnd}::date AND COALESCE(e.total,0)>0
    ) u
    ORDER BY u."date" DESC, u."amountSatang" DESC
    LIMIT 800
  `;
  return rows.map((r) => ({
    bookId: r.bookId, bookType: r.bookType, date: r.date, docNo: r.docNo,
    contact: r.contact, detail: r.detail, kind: r.kind, amountSatang: Number(r.amountSatang), reconciled: r.reconciled,
  }));
}

export interface AccountSummary {
  openingSatang: number; inSatang: number; outSatang: number; closingSatang: number;
  lastImportedDate: string | null;
}

export async function accountSummary(params: {
  orgId: string; companyId: string; bankAccountId: string; periodStart: string; periodEnd: string;
}): Promise<AccountSummary> {
  const { orgId, companyId, bankAccountId, periodStart, periodEnd } = params;
  const agg = await prisma.$queryRaw<{
    inSat: bigint | null; outSat: bigint | null; lastBal: bigint | null; lastImported: string | null;
  }[]>`
    SELECT
      SUM(CASE WHEN amount_satang > 0 THEN amount_satang ELSE 0 END) as "inSat",
      SUM(CASE WHEN amount_satang < 0 THEN -amount_satang ELSE 0 END) as "outSat",
      (SELECT balance_satang FROM ledger_bank_txn t2
       WHERE t2.bank_account_id=${bankAccountId}::uuid AND t2.org_id=${orgId}::uuid
         AND t2.txn_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
       ORDER BY t2.txn_date DESC, t2.row_index DESC LIMIT 1) as "lastBal",
      (SELECT MAX(txn_date)::text FROM ledger_bank_txn t3
       WHERE t3.bank_account_id=${bankAccountId}::uuid AND t3.org_id=${orgId}::uuid) as "lastImported"
    FROM ledger_bank_txn t
    WHERE t.bank_account_id=${bankAccountId}::uuid AND t.org_id=${orgId}::uuid
      AND t.company_id=${companyId}::uuid
      AND t.txn_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
  `;
  const inSat = Number(agg[0]?.inSat ?? 0);
  const outSat = Number(agg[0]?.outSat ?? 0);
  const closing = Number(agg[0]?.lastBal ?? 0);
  // opening = closing − net (derived from the running balance of the last txn)
  const opening = closing - (inSat - outSat);
  return {
    openingSatang: opening, inSatang: inSat, outSatang: outSat, closingSatang: closing,
    lastImportedDate: agg[0]?.lastImported ?? null,
  };
}
