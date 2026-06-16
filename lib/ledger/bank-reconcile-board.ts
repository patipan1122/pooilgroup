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
  sub: string;        // source_type (ธุรกิจ/ระบบที่มา) — ใช้ทำ filter "ธุรกิจ"
  channel: string;    // payment_channel (cash/transfer/qr/card) — ใช้ทำ filter "ประเภท"
}
export interface BankMovement {
  id: string;
  date: string;
  description: string;  // counterparty / purpose (ref2 preferred) — the meaningful line
  txnType: string;      // bank transaction type (description) + channel — secondary detail
  ref1: string | null;
  amountSatang: number;
  // ── extra bank detail from the statement CSV (shown in the row expander) ──
  ref2: string | null;        // raw counterparty line ("รับโอนจาก KTB x6223 …")
  channel: string | null;     // bank channel (Mobile / EDC/K SHOP/MYQR …)
  balanceSatang: number | null; // running balance after this txn
  valueDate: string | null;   // value/settlement date
}
export interface MatchGroup {
  id: string;
  status: string;
  matchKind: string;
  matchType: string;          // 'standard' | 'transfer'
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
    // ── richer human detail (so รอยืนยัน reads like the real IV, not a bare tag) ──
    customerName: string | null;
    sourceType: string | null;     // revenue source_type (CASHHUB_AMAZON …)
    paymentChannel: string | null; // revenue payment_channel (cash/qr/card …)
    vendor: string | null;         // expense vendor
    detailLine: string | null;     // composed human detail
    bizDate: string | null;        // book-side date (entry/doc/paid date)
    // ── ฝั่งธนาคาร: รายละเอียด statement ครบ (ใช้ไล่หาบรรทัดเป๊ะในแอปธนาคาร) ──
    bankTxnType: string | null;    // ledger_bank_txn.description (ประเภทรายการธนาคาร)
    bankChannel: string | null;    // ช่องทาง (Mobile / EDC / MYQR …)
    bankRef1: string | null;       // เลขอ้างอิงในสเตทเมนต์
    bankBalanceSatang: number | null; // ยอดคงเหลือหลังรายการ
    bankValueDate: string | null;  // วันที่เงินเข้าจริง (value date)
  }[];
}

// ── Book side: UN-reconciled entries in the period (not in any active group) ───
export async function listBookEntries(params: {
  orgId: string; companyId: string; bankAccountId: string; periodStart: string; periodEnd: string;
}): Promise<BookEntry[]> {
  const { orgId, companyId, bankAccountId, periodStart, periodEnd } = params;
  const rows = await prisma.$queryRaw<{
    bookId: string; bookType: string; date: string; docNo: string;
    contact: string; detail: string; amountSatang: bigint; sub: string; channel: string;
  }[]>`
    SELECT * FROM (
      SELECT r.id::text as "bookId", 'revenue' as "bookType", r.entry_date::text as "date",
             COALESCE(r.source_ref, '') as "docNo",
             COALESCE(NULLIF(r.customer_name,''), NULLIF(r.description,''), '') as "contact",
             COALESCE(NULLIF(r.description,''), '') as "detail",
             r.amount_satang as "amountSatang", COALESCE(r.source_type,'') as "sub",
             COALESCE(r.payment_channel,'') as "channel"
      FROM ledger_revenue_entry r
      WHERE r.org_id = ${orgId}::uuid AND r.company_id = ${companyId}::uuid
        AND r.entry_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND r.match_state <> 'matched'
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.book_type='revenue' AND mi.book_id = r.id)
        -- บัญชีใครบัญชีมัน: รายได้ที่ผูกเลขบัญชีไว้ (โรงแรม cash→BBL · qr→TTB) โผล่เฉพาะบัญชีตัวเอง
        --   · รายได้ที่ยังไม่ผูกบัญชี (NULL) โผล่ทุกบัญชี (กันข้อมูลหาย) · กัน auto-match ข้ามบัญชี
        AND (r.expected_bank_account_id = ${bankAccountId}::uuid OR r.expected_bank_account_id IS NULL)
      UNION ALL
      SELECT e.id::text, 'expense', e.doc_date::text,
             COALESCE(NULLIF(e.doc_code,''), NULLIF(e.vendor_doc_number,''), ''),
             COALESCE(NULLIF(e.vendor,''), ''),
             TRIM(CONCAT_WS(' · ', NULLIF(e.doc_type,''), NULLIF(e.note,''))),
             (-ROUND(e.total*100))::bigint, COALESCE(e.doc_type,''), ''
      FROM ledger_expense e
      WHERE e.org_id = ${orgId}::uuid AND e.company_id = ${companyId}::uuid
        AND e.doc_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND COALESCE(e.total,0) > 0
        AND NOT EXISTS (SELECT 1 FROM ledger_bank_match_item mi WHERE mi.book_type='expense' AND mi.book_id = e.id)
      UNION ALL
      SELECT p.id::text, 'payment', p.paid_at::date::text,
             COALESCE(p.trans_ref,''), '', COALESCE(p.method,''), (-ROUND(p.amount*100))::bigint, COALESCE(p.method,''), COALESCE(p.method,'')
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
    docNo: r.docNo, contact: r.contact, detail: r.detail, amountSatang: Number(r.amountSatang), sub: r.sub, channel: r.channel,
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
    ref2: string | null; channel: string | null; balanceSatang: bigint | null; valueDate: string | null;
  }[]>`
    SELECT t.id::text as id, t.txn_date::text as "date",
           -- the meaningful line: counterparty / purpose lives in ref2 (e.g. "รับโอนจาก KTB x6223 …")
           COALESCE(NULLIF(t.ref2,''), NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร') as "description",
           TRIM(CONCAT_WS(' · ', NULLIF(t.description,''), NULLIF(t.channel,''))) as "txnType",
           t.ref1, t.amount_satang as "amountSatang",
           t.ref2, t.channel, t.balance_satang as "balanceSatang", t.value_date::text as "valueDate"
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
    ref2: r.ref2, channel: r.channel,
    balanceSatang: r.balanceSatang == null ? null : Number(r.balanceSatang), valueDate: r.valueDate,
  }));
}

// ── Suggested / confirmed groups (รอยืนยัน tab) ───────────────────────────────
export async function listMatchGroups(params: {
  orgId: string; companyId: string; bankAccountId: string; status: "suggested" | "confirmed";
}): Promise<MatchGroup[]> {
  const { orgId, companyId, bankAccountId, status } = params;
  const groups = await prisma.$queryRaw<{
    id: string; status: string; matchKind: string; matchType: string;
    bankTotalSatang: bigint; bookTotalSatang: bigint; deltaSatang: bigint;
  }[]>`
    SELECT id::text, status, match_kind as "matchKind", match_type as "matchType",
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
  // LEFT JOIN to the 3 book tables (keyed by book_type) so each item carries full human
  // detail — the รอยืนยัน list reads like the real IV: "รายได้ คาเฟ่ Amazon · เงินสด · 30 เม.ย.".
  const items = await prisma.$queryRaw<{
    groupId: string; kind: string; bankTxnId: string | null; bookType: string | null;
    bookId: string | null; bookDocNo: string | null; label: string; date: string | null; amountSatang: bigint;
    customerName: string | null; sourceType: string | null; paymentChannel: string | null;
    vendor: string | null; detailLine: string | null; bizDate: string | null;
    bankTxnType: string | null; bankChannel: string | null; bankRef1: string | null;
    bankBalanceSatang: bigint | null; bankValueDate: string | null;
  }[]>`
    SELECT mi.group_id::text as "groupId", mi.kind, mi.bank_txn_id::text as "bankTxnId",
           mi.book_type as "bookType", mi.book_id::text as "bookId", mi.book_doc_no as "bookDocNo",
           -- ฝั่งธนาคาร: เอา "ชื่อคู่ค้า" (ref2) มาก่อน (เช่น "รับโอนจาก KTB X0752 SHOPEEPAY")
           -- เพื่อให้ "ดูชื่อ" ตอนยืนยันได้ + ใช้เทียบชื่อผู้ให้บริการ 2 ฝั่ง (ชื่อสำคัญ)
           -- ฝั่งบัญชี: ลูกค้า (revenue) / ผู้ขาย (expense) แบบอ่านรู้เรื่อง
           CASE WHEN mi.kind='bank' THEN COALESCE(NULLIF(t.ref2,''), NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร')
                WHEN mi.book_type='revenue' THEN COALESCE(NULLIF(r.customer_name,''), NULLIF(r.description,''), NULLIF(mi.book_doc_no,''), 'รายได้')
                WHEN mi.book_type='expense' THEN COALESCE(NULLIF(e.vendor,''), NULLIF(mi.book_doc_no,''), 'ค่าใช้จ่าย')
                ELSE COALESCE(NULLIF(mi.book_doc_no,''), 'รายการบัญชี') END as "label",
           CASE WHEN mi.kind='bank' THEN t.txn_date::text ELSE NULL END as "date",
           mi.amount_satang as "amountSatang",
           r.customer_name as "customerName",
           r.source_type as "sourceType",
           r.payment_channel as "paymentChannel",
           e.vendor as "vendor",
           CASE WHEN mi.book_type='revenue'
                  THEN NULLIF(TRIM(CONCAT_WS(' · ', NULLIF(r.source_type,''), NULLIF(r.payment_channel,''), NULLIF(r.description,''))), '')
                WHEN mi.book_type='expense'
                  THEN NULLIF(TRIM(CONCAT_WS(' · ', NULLIF(e.doc_type,''), NULLIF(e.note,''))), '')
                ELSE NULL END as "detailLine",
           CASE WHEN mi.book_type='revenue' THEN r.entry_date::text
                WHEN mi.book_type='expense' THEN e.doc_date::text
                ELSE NULL END as "bizDate",
           -- ฝั่งธนาคาร: รายละเอียด statement ครบ (โชว์ทางขวาให้ไล่หาบรรทัดเป๊ะในแอปธนาคารได้)
           CASE WHEN mi.kind='bank' THEN NULLIF(t.description,'') ELSE NULL END as "bankTxnType",
           CASE WHEN mi.kind='bank' THEN NULLIF(t.channel,'')     ELSE NULL END as "bankChannel",
           CASE WHEN mi.kind='bank' THEN NULLIF(t.ref1,'')        ELSE NULL END as "bankRef1",
           CASE WHEN mi.kind='bank' THEN t.balance_satang         ELSE NULL END as "bankBalanceSatang",
           CASE WHEN mi.kind='bank' THEN t.value_date::text       ELSE NULL END as "bankValueDate"
    FROM ledger_bank_match_item mi
    LEFT JOIN ledger_bank_txn t       ON t.id = mi.bank_txn_id
    LEFT JOIN ledger_revenue_entry r  ON mi.book_type='revenue' AND r.id = mi.book_id
    LEFT JOIN ledger_expense e        ON mi.book_type='expense' AND e.id = mi.book_id
    WHERE mi.group_id = ANY(${ids}::uuid[])
    ORDER BY mi.kind, mi.amount_satang DESC
  `;
  return groups.map((g) => ({
    id: g.id, status: g.status, matchKind: g.matchKind, matchType: g.matchType,
    bankTotalSatang: Number(g.bankTotalSatang), bookTotalSatang: Number(g.bookTotalSatang),
    deltaSatang: Number(g.deltaSatang),
    items: items.filter((i) => i.groupId === g.id).map((i) => ({
      kind: i.kind as "bank" | "book", bankTxnId: i.bankTxnId, bookType: i.bookType,
      bookId: i.bookId, bookDocNo: i.bookDocNo, label: i.label, date: i.date, amountSatang: Number(i.amountSatang),
      customerName: i.customerName, sourceType: i.sourceType, paymentChannel: i.paymentChannel,
      vendor: i.vendor, detailLine: i.detailLine, bizDate: i.bizDate,
      bankTxnType: i.bankTxnType, bankChannel: i.bankChannel, bankRef1: i.bankRef1,
      bankBalanceSatang: i.bankBalanceSatang == null ? null : Number(i.bankBalanceSatang),
      bankValueDate: i.bankValueDate,
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
  orgId: string; companyId: string; bankAccountId: string; periodStart: string; periodEnd: string;
}): Promise<BookLedgerRow[]> {
  const { orgId, companyId, bankAccountId, periodStart, periodEnd } = params;
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
        -- บัญชีใครบัญชีมัน: รายได้ผูกบัญชีไหน โผล่บัญชีนั้น · NULL = โผล่ทุกบัญชี (กันข้อมูลหาย)
        AND (r.expected_bank_account_id = ${bankAccountId}::uuid OR r.expected_bank_account_id IS NULL)
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
