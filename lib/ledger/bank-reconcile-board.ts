// LedgerLine — Bank Reconcile Board (PEAK-parity 2-column matching).
//
// LEFT  = รายการบันทึกบัญชี (book entries: revenue in / expense out / payment out)
// RIGHT = รายการเคลื่อนไหว (bank movements from the imported statement)
// User selects N from each side (sums balance) → group → รอยืนยัน → confirm.
//
// All queries self-scope org_id + company_id (Prisma bypasses RLS — rolbypassrls).

import { prisma } from "@/lib/prisma";

export interface BookEntry {
  bookId: string;
  bookType: "revenue" | "expense" | "payment";
  date: string;          // YYYY-MM-DD
  docNo: string;
  contact: string;
  amountSatang: number;  // signed: + money in, − money out
  sub: string;           // source_type / doc_type / method
}

export interface BankMovement {
  id: string;
  date: string;
  description: string;
  ref1: string | null;
  amountSatang: number;  // signed: + credit, − debit
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

// ── Book side: unreconciled entries in the period (not in any active group) ────
export async function listBookEntries(params: {
  orgId: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<BookEntry[]> {
  const { orgId, companyId, periodStart, periodEnd } = params;
  const rows = await prisma.$queryRaw<{
    bookId: string; bookType: string; date: string; docNo: string;
    contact: string; amountSatang: bigint; sub: string;
  }[]>`
    SELECT * FROM (
      -- revenue (money IN, positive)
      SELECT r.id::text as "bookId", 'revenue' as "bookType", r.entry_date::text as "date",
             COALESCE(r.source_ref, '') as "docNo",
             COALESCE(NULLIF(r.customer_name,''), NULLIF(r.description,''), '') as "contact",
             r.amount_satang as "amountSatang",
             COALESCE(r.source_type,'') as "sub"
      FROM ledger_revenue_entry r
      WHERE r.org_id = ${orgId}::uuid AND r.company_id = ${companyId}::uuid
        AND r.entry_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND r.match_state <> 'matched'
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi
                        WHERE mi.book_type='revenue' AND mi.book_id = r.id)
      UNION ALL
      -- expense (money OUT, negative)
      SELECT e.id::text, 'expense', e.doc_date::text,
             COALESCE(NULLIF(e.doc_code,''), NULLIF(e.vendor_doc_number,''), ''),
             COALESCE(NULLIF(e.vendor,''), NULLIF(e.note,''), ''),
             (-ROUND(e.total*100))::bigint,
             COALESCE(e.doc_type,'')
      FROM ledger_expense e
      WHERE e.org_id = ${orgId}::uuid AND e.company_id = ${companyId}::uuid
        AND e.doc_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND COALESCE(e.total,0) > 0
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi
                        WHERE mi.book_type='expense' AND mi.book_id = e.id)
      UNION ALL
      -- payment (money OUT, negative)
      SELECT p.id::text, 'payment', p.paid_at::date::text,
             COALESCE(p.trans_ref,''), '',
             (-ROUND(p.amount*100))::bigint,
             COALESCE(p.method,'')
      FROM ledger_payment p
      WHERE p.org_id = ${orgId}::uuid AND p.company_id = ${companyId}::uuid
        AND p.paid_at::date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND COALESCE(p.amount,0) > 0
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi
                        WHERE mi.book_type='payment' AND mi.book_id = p.id)
    ) u
    ORDER BY u."date", u."amountSatang" DESC
    LIMIT 500
  `;
  return rows.map((r) => ({
    bookId: r.bookId,
    bookType: r.bookType as BookEntry["bookType"],
    date: r.date,
    docNo: r.docNo,
    contact: r.contact,
    amountSatang: Number(r.amountSatang),
    sub: r.sub,
  }));
}

// ── Bank side: unmatched movements in this batch (not in any active group) ─────
export async function listBankMovements(params: {
  orgId: string;
  companyId: string;
  batchId: string;
}): Promise<BankMovement[]> {
  const { orgId, companyId, batchId } = params;
  const rows = await prisma.$queryRaw<{
    id: string; date: string; description: string; ref1: string | null; amountSatang: bigint;
  }[]>`
    SELECT t.id::text as id, t.txn_date::text as "date",
           COALESCE(NULLIF(t.description,''), NULLIF(t.channel,''), '') as "description",
           t.ref1, t.amount_satang as "amountSatang"
    FROM ledger_bank_txn t
    WHERE t.batch_id = ${batchId}::uuid AND t.org_id = ${orgId}::uuid AND t.company_id = ${companyId}::uuid
      AND t.match_state = 'unmatched'
      AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.bank_txn_id = t.id)
    ORDER BY t.txn_date, t.row_index
    LIMIT 500
  `;
  return rows.map((r) => ({
    id: r.id, date: r.date, description: r.description, ref1: r.ref1,
    amountSatang: Number(r.amountSatang),
  }));
}

// ── Suggested groups (รอยืนยัน tab) with their items ──────────────────────────
export async function listMatchGroups(params: {
  orgId: string;
  companyId: string;
  bankAccountId: string;
  status: "suggested" | "confirmed";
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
    groupId: string; kind: string; bankTxnId: string | null;
    bookType: string | null; bookId: string | null; bookDocNo: string | null;
    label: string; date: string | null; amountSatang: bigint;
  }[]>`
    SELECT mi.group_id::text as "groupId", mi.kind, mi.bank_txn_id::text as "bankTxnId",
           mi.book_type as "bookType", mi.book_id::text as "bookId", mi.book_doc_no as "bookDocNo",
           CASE
             WHEN mi.kind='bank' THEN COALESCE(NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร')
             ELSE COALESCE(NULLIF(mi.book_doc_no,''), 'รายการบัญชี')
           END as "label",
           CASE WHEN mi.kind='bank' THEN t.txn_date::text ELSE NULL END as "date",
           mi.amount_satang as "amountSatang"
    FROM ledger_bank_match_item mi
    LEFT JOIN ledger_bank_txn t ON t.id = mi.bank_txn_id
    WHERE mi.group_id = ANY(${ids}::uuid[])
    ORDER BY mi.kind, mi.amount_satang DESC
  `;

  return groups.map((g) => ({
    id: g.id,
    status: g.status,
    matchKind: g.matchKind,
    bankTotalSatang: Number(g.bankTotalSatang),
    bookTotalSatang: Number(g.bookTotalSatang),
    deltaSatang: Number(g.deltaSatang),
    items: items.filter((i) => i.groupId === g.id).map((i) => ({
      kind: i.kind as "bank" | "book",
      bankTxnId: i.bankTxnId,
      bookType: i.bookType,
      bookId: i.bookId,
      bookDocNo: i.bookDocNo,
      label: i.label,
      date: i.date,
      amountSatang: Number(i.amountSatang),
    })),
  }));
}
