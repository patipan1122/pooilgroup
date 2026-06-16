// LedgerLine — Bank-Recon Controls: shared revert helper + workspace read functions.
//
// revertGroup() is the SINGLE definition of "what undoing a match does" — used by the
// per-group "นำออก" button, super_admin direct revert, the approval-execute path, and
// bulk-undo. It snapshots the group's items BEFORE deleting them so a reversed group
// stays searchable in the archive, and it re-asserts the period-lock guard.
//
// All queries self-scope org_id + company_id (Prisma bypasses RLS).

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

// ── shared revert: free bank+book, snapshot items, mark group reversed ──────────
// extraOps run in the SAME transaction (used by approval-execute to flip the request).
export async function revertGroup(args: {
  orgId: string; groupId: string; userId: string; reason: string;
  extraOps?: Prisma.PrismaPromise<unknown>[];
}): Promise<{ ok: boolean; error?: string }> {
  const { orgId, groupId, userId, reason, extraOps = [] } = args;

  // lock guard — never alter a closed/locked period (revert must go through unlock first)
  const locked = await prisma.$queryRaw<{ c: number }[]>`
    SELECT COUNT(*)::int as c
    FROM ledger_bank_match_item mi
    JOIN ledger_bank_txn t ON t.id = mi.bank_txn_id
    JOIN ledger_bank_import_batch b ON b.id = t.batch_id
    WHERE mi.group_id = ${groupId}::uuid AND mi.org_id = ${orgId}::uuid AND b.locked_at IS NOT NULL`;
  if ((locked[0]?.c ?? 0) > 0) return { ok: false, error: "งวดนี้ล็อกแล้ว — ต้องปลดล็อกงวดก่อนจึงย้อนได้" };

  // snapshot items BEFORE delete → keep "what this group matched" for the archive
  const snap = await prisma.$queryRaw<{ snap: unknown }[]>`
    SELECT json_build_object(
      'items', COALESCE(json_agg(json_build_object(
        'kind', mi.kind, 'bookType', mi.book_type, 'bookId', mi.book_id::text,
        'bookDocNo', mi.book_doc_no, 'bankTxnId', mi.bank_txn_id::text,
        'amountSatang', mi.amount_satang,
        'label', CASE WHEN mi.kind='bank' THEN COALESCE(NULLIF(t.ref2,''), NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร')
                      WHEN mi.book_type='revenue' THEN COALESCE(NULLIF(r.customer_name,''), NULLIF(r.description,''), NULLIF(mi.book_doc_no,''), 'รายได้')
                      WHEN mi.book_type='expense' THEN COALESCE(NULLIF(e.vendor,''), NULLIF(mi.book_doc_no,''), 'ค่าใช้จ่าย')
                      ELSE COALESCE(NULLIF(mi.book_doc_no,''), 'รายการบัญชี') END,
        'date', CASE WHEN mi.kind='bank' THEN t.txn_date::text
                     WHEN mi.book_type='revenue' THEN r.entry_date::text
                     WHEN mi.book_type='expense' THEN e.doc_date::text ELSE NULL END
      ) ORDER BY mi.kind) FILTER (WHERE mi.id IS NOT NULL), '[]'::json)
    ) as snap
    FROM ledger_bank_match_item mi
    LEFT JOIN ledger_bank_txn t      ON t.id = mi.bank_txn_id
    LEFT JOIN ledger_revenue_entry r ON mi.book_type='revenue' AND r.id = mi.book_id
    LEFT JOIN ledger_expense e       ON mi.book_type='expense' AND e.id = mi.book_id
    WHERE mi.group_id = ${groupId}::uuid AND mi.org_id = ${orgId}::uuid`;
  const snapshotJson = JSON.stringify(snap[0]?.snap ?? { items: [] });

  await prisma.$transaction([
    // free bank txns
    prisma.$executeRaw`
      UPDATE ledger_bank_txn SET match_state='unmatched'
      WHERE org_id=${orgId}::uuid AND id IN (
        SELECT mi.bank_txn_id FROM ledger_bank_match_item mi
        WHERE mi.group_id=${groupId}::uuid AND mi.kind='bank')`,
    // free revenue book entries (this also reverts the CashHub สีรุ้ง — it reads match_state live)
    prisma.$executeRaw`
      UPDATE ledger_revenue_entry SET match_state='unmatched', bank_txn_id=NULL, updated_at=now()
      WHERE org_id=${orgId}::uuid AND id IN (
        SELECT mi.book_id FROM ledger_bank_match_item mi
        WHERE mi.group_id=${groupId}::uuid AND mi.kind='book' AND mi.book_type='revenue')`,
    prisma.$executeRaw`DELETE FROM ledger_bank_match_item WHERE group_id=${groupId}::uuid AND org_id=${orgId}::uuid`,
    // status-guarded so a double-revert is a no-op (TOCTOU safety)
    prisma.$executeRaw`
      UPDATE ledger_bank_match_group
      SET status='reversed', reversed_by=${userId}::uuid, reversed_at=now(),
          reversal_reason=${reason}, reversed_snapshot=${snapshotJson}::jsonb, updated_at=now()
      WHERE id=${groupId}::uuid AND org_id=${orgId}::uuid AND status IN ('suggested','confirmed')`,
    ...extraOps,
  ]);
  return { ok: true };
}

// helper: format a bank account label "กสิกร ····0886"
function acctLabel(bankCode: string | null, accountNo: string | null): string | null {
  if (!bankCode && !accountNo) return null;
  const last4 = accountNo && accountNo.length >= 4 ? `····${accountNo.slice(-4)}` : (accountNo ?? "");
  return `${bankCode ?? ""} ${last4}`.trim();
}

// ── Matched archive (#2): confirmed (live items) + reversed (snapshot items) ────
export interface ArchiveItem {
  kind: string; label: string; amountSatang: number; date: string | null;
  bookType: string | null; paymentChannel: string | null; sourceType: string | null;
}
export interface ArchiveGroup {
  id: string; status: string; matchType: string; matchKind: string;
  bankTotalSatang: number; bookTotalSatang: number; deltaSatang: number;
  confirmedAt: string | null; reversedAt: string | null; reversalReason: string | null;
  accountLabel: string | null;
  items: ArchiveItem[];
}
export async function listMatchedArchive(params: {
  orgId: string; companyId: string; bankAccountId?: string; search?: string;
}): Promise<ArchiveGroup[]> {
  const { orgId, companyId, bankAccountId, search } = params;
  const groups = await prisma.$queryRaw<{
    id: string; status: string; matchType: string; matchKind: string;
    bankTotalSatang: bigint; bookTotalSatang: bigint; deltaSatang: bigint;
    confirmedAt: string | null; reversedAt: string | null; reversalReason: string | null;
    bankCode: string | null; accountNo: string | null; reversedSnapshot: unknown;
  }[]>`
    SELECT g.id::text, g.status, g.match_type as "matchType", g.match_kind as "matchKind",
           g.bank_total_satang as "bankTotalSatang", g.book_total_satang as "bookTotalSatang",
           g.delta_satang as "deltaSatang",
           g.confirmed_at::text as "confirmedAt", g.reversed_at::text as "reversedAt",
           g.reversal_reason as "reversalReason",
           a.bank_code as "bankCode", a.account_no as "accountNo",
           g.reversed_snapshot as "reversedSnapshot"
    FROM ledger_bank_match_group g
    LEFT JOIN ledger_bank_account a ON a.id = g.bank_account_id
    WHERE g.org_id=${orgId}::uuid AND g.company_id=${companyId}::uuid
      AND g.status IN ('confirmed','reversed')
      -- account filter (transfers span accounts → always included when an account is set)
      AND (${bankAccountId ?? null}::uuid IS NULL
           OR g.bank_account_id = ${bankAccountId ?? null}::uuid
           OR g.match_type='transfer')
    ORDER BY COALESCE(g.reversed_at, g.confirmed_at, g.created_at) DESC
    LIMIT 400
  `;
  if (!groups.length) return [];
  // live items for confirmed groups (reversed groups read from snapshot)
  const confirmedIds = groups.filter((g) => g.status === "confirmed").map((g) => g.id);
  const liveItems = confirmedIds.length
    ? await prisma.$queryRaw<{
        groupId: string; kind: string; label: string; amountSatang: bigint; date: string | null;
        bookType: string | null; paymentChannel: string | null; sourceType: string | null;
      }[]>`
        SELECT mi.group_id::text as "groupId", mi.kind,
               CASE WHEN mi.kind='bank' THEN COALESCE(NULLIF(t.ref2,''), NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร')
                    WHEN mi.book_type='revenue' THEN COALESCE(NULLIF(r.customer_name,''), NULLIF(r.description,''), NULLIF(mi.book_doc_no,''), 'รายได้')
                    WHEN mi.book_type='expense' THEN COALESCE(NULLIF(e.vendor,''), NULLIF(mi.book_doc_no,''), 'ค่าใช้จ่าย')
                    ELSE COALESCE(NULLIF(mi.book_doc_no,''), 'รายการบัญชี') END as "label",
               mi.amount_satang as "amountSatang",
               CASE WHEN mi.kind='bank' THEN t.txn_date::text
                    WHEN mi.book_type='revenue' THEN r.entry_date::text
                    WHEN mi.book_type='expense' THEN e.doc_date::text ELSE NULL END as "date",
               mi.book_type as "bookType", r.payment_channel as "paymentChannel", r.source_type as "sourceType"
        FROM ledger_bank_match_item mi
        LEFT JOIN ledger_bank_txn t      ON t.id = mi.bank_txn_id
        LEFT JOIN ledger_revenue_entry r ON mi.book_type='revenue' AND r.id = mi.book_id
        LEFT JOIN ledger_expense e       ON mi.book_type='expense' AND e.id = mi.book_id
        WHERE mi.group_id = ANY(${confirmedIds}::uuid[])
        ORDER BY mi.kind, mi.amount_satang DESC`
    : [];

  const out: ArchiveGroup[] = groups.map((g) => {
    let items: ArchiveItem[];
    if (g.status === "confirmed") {
      items = liveItems.filter((i) => i.groupId === g.id).map((i) => ({
        kind: i.kind, label: i.label, amountSatang: Number(i.amountSatang), date: i.date,
        bookType: i.bookType, paymentChannel: i.paymentChannel, sourceType: i.sourceType,
      }));
    } else {
      const snap = (g.reversedSnapshot as { items?: { kind: string; label: string; amountSatang: number; date: string | null; bookType: string | null }[] } | null);
      items = (snap?.items ?? []).map((i) => ({
        kind: i.kind, label: i.label, amountSatang: Number(i.amountSatang), date: i.date,
        bookType: i.bookType ?? null, paymentChannel: null, sourceType: null,
      }));
    }
    return {
      id: g.id, status: g.status, matchType: g.matchType, matchKind: g.matchKind,
      bankTotalSatang: Number(g.bankTotalSatang), bookTotalSatang: Number(g.bookTotalSatang),
      deltaSatang: Number(g.deltaSatang),
      confirmedAt: g.confirmedAt, reversedAt: g.reversedAt, reversalReason: g.reversalReason,
      accountLabel: acctLabel(g.bankCode, g.accountNo), items,
    };
  });

  const q = (search ?? "").trim().toLowerCase();
  if (!q) return out;
  return out.filter((g) => {
    const hay = `${g.accountLabel ?? ""} ${g.reversalReason ?? ""} ${g.items.map((i) => i.label).join(" ")} ${(Math.abs(g.bankTotalSatang) / 100).toFixed(2)}`.toLowerCase();
    return hay.includes(q);
  });
}

// ── Special-items hub (#7): transfers + skipped(no-match) across ALL accounts ───
export interface TransferRecord {
  id: string; status: string; note: string | null; createdAt: string; reversalReason: string | null;
  legs: { bankTxnId: string; date: string; amountSatang: number; accountLabel: string | null; description: string }[];
}
export interface SkippedRecord {
  matchId: string; bankTxnId: string; date: string; amountSatang: number;
  accountLabel: string | null; description: string; reason: string | null; at: string | null;
}
export async function listSpecialItems(params: {
  orgId: string; companyId: string;
}): Promise<{ transfers: TransferRecord[]; skipped: SkippedRecord[] }> {
  const { orgId, companyId } = params;
  // transfers (new group model · match_type='transfer')
  const trows = await prisma.$queryRaw<{
    groupId: string; status: string; note: string | null; createdAt: string; reversalReason: string | null;
    bankTxnId: string; date: string; amountSatang: bigint; bankCode: string | null; accountNo: string | null; description: string;
  }[]>`
    SELECT g.id::text as "groupId", g.status, g.note, g.created_at::text as "createdAt",
           g.reversal_reason as "reversalReason",
           t.id::text as "bankTxnId", t.txn_date::text as "date", t.amount_satang as "amountSatang",
           a.bank_code as "bankCode", a.account_no as "accountNo",
           COALESCE(NULLIF(t.ref2,''), NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร') as "description"
    FROM ledger_bank_match_group g
    JOIN ledger_bank_match_item mi ON mi.group_id=g.id AND mi.kind='bank'
    JOIN ledger_bank_txn t ON t.id=mi.bank_txn_id
    LEFT JOIN ledger_bank_account a ON a.id=t.bank_account_id
    WHERE g.org_id=${orgId}::uuid AND g.company_id=${companyId}::uuid
      AND g.match_type='transfer' AND g.status IN ('suggested','confirmed')
    ORDER BY g.created_at DESC, t.amount_satang DESC
    LIMIT 600`;
  const tmap = new Map<string, TransferRecord>();
  for (const r of trows) {
    let rec = tmap.get(r.groupId);
    if (!rec) {
      rec = { id: r.groupId, status: r.status, note: r.note, createdAt: r.createdAt, reversalReason: r.reversalReason, legs: [] };
      tmap.set(r.groupId, rec);
    }
    rec.legs.push({
      bankTxnId: r.bankTxnId, date: r.date, amountSatang: Number(r.amountSatang),
      accountLabel: acctLabel(r.bankCode, r.accountNo), description: r.description,
    });
  }

  // skipped / excluded (old 1:1 table · match_type='exclusion')
  const srows = await prisma.$queryRaw<{
    matchId: string; bankTxnId: string; date: string; amountSatang: bigint;
    bankCode: string | null; accountNo: string | null; description: string; reason: string | null; at: string | null;
  }[]>`
    SELECT m.id::text as "matchId", t.id::text as "bankTxnId", t.txn_date::text as "date",
           t.amount_satang as "amountSatang", a.bank_code as "bankCode", a.account_no as "accountNo",
           COALESCE(NULLIF(t.ref2,''), NULLIF(t.description,''), NULLIF(t.channel,''), 'รายการธนาคาร') as "description",
           m.exclusion_reason as "reason", m.matched_at::text as "at"
    FROM ledger_bank_match m
    JOIN ledger_bank_txn t ON t.id=m.bank_txn_id
    LEFT JOIN ledger_bank_account a ON a.id=t.bank_account_id
    WHERE m.org_id=${orgId}::uuid AND m.company_id=${companyId}::uuid
      AND m.match_type='exclusion' AND m.status='confirmed'
    ORDER BY m.matched_at DESC NULLS LAST
    LIMIT 600`;
  const skipped: SkippedRecord[] = srows.map((s) => ({
    matchId: s.matchId, bankTxnId: s.bankTxnId, date: s.date, amountSatang: Number(s.amountSatang),
    accountLabel: acctLabel(s.bankCode, s.accountNo), description: s.description, reason: s.reason, at: s.at,
  }));

  return { transfers: [...tmap.values()], skipped };
}

// ── Approval inbox (#3) ────────────────────────────────────────────────────────
export interface EditRequestRecord {
  id: string; groupId: string; reason: string; status: string;
  requestedByName: string; requestedAt: string;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  accountLabel: string | null; bankTotalSatang: number; bookTotalSatang: number; deltaSatang: number;
  groupStatus: string;
}
export async function listEditRequests(params: {
  orgId: string; companyId: string; status?: "PENDING" | "APPROVED" | "REJECTED";
}): Promise<EditRequestRecord[]> {
  const { orgId, companyId, status } = params;
  const rows = await prisma.$queryRaw<{
    id: string; groupId: string; reason: string; status: string;
    requestedByName: string | null; requestedAt: string;
    decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
    bankCode: string | null; accountNo: string | null;
    bankTotalSatang: bigint; bookTotalSatang: bigint; deltaSatang: bigint; groupStatus: string;
  }[]>`
    SELECT req.id::text, req.target_group_id::text as "groupId", req.reason, req.status,
           COALESCE(NULLIF(ru.name,''), ru.email) as "requestedByName", req.requested_at::text as "requestedAt",
           COALESCE(NULLIF(du.name,''), du.email) as "decidedByName", req.decided_at::text as "decidedAt",
           req.decision_note as "decisionNote",
           a.bank_code as "bankCode", a.account_no as "accountNo",
           g.bank_total_satang as "bankTotalSatang", g.book_total_satang as "bookTotalSatang",
           g.delta_satang as "deltaSatang", g.status as "groupStatus"
    FROM ledger_recon_edit_request req
    JOIN ledger_bank_match_group g ON g.id = req.target_group_id
    LEFT JOIN ledger_bank_account a ON a.id = g.bank_account_id
    LEFT JOIN users ru ON ru.id = req.requested_by
    LEFT JOIN users du ON du.id = req.decided_by
    WHERE req.org_id=${orgId}::uuid AND req.company_id=${companyId}::uuid
      AND (${status ?? null}::text IS NULL OR req.status = ${status ?? null})
    ORDER BY req.requested_at DESC
    LIMIT 300`;
  return rows.map((r) => ({
    id: r.id, groupId: r.groupId, reason: r.reason, status: r.status,
    requestedByName: r.requestedByName ?? "—", requestedAt: r.requestedAt,
    decidedByName: r.decidedByName, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    accountLabel: acctLabel(r.bankCode, r.accountNo),
    bankTotalSatang: Number(r.bankTotalSatang), bookTotalSatang: Number(r.bookTotalSatang),
    deltaSatang: Number(r.deltaSatang), groupStatus: r.groupStatus,
  }));
}

// ── Accounts for the transfer page (pick 2 legs across accounts) ────────────────
export interface AccountOption { id: string; bankCode: string; accountNo: string; accountName: string; label: string; }
export async function listAccountsForCompany(params: {
  orgId: string; companyId: string;
}): Promise<AccountOption[]> {
  const { orgId, companyId } = params;
  const rows = await prisma.$queryRaw<{ id: string; bankCode: string; accountNo: string; accountName: string }[]>`
    SELECT a.id::text, a.bank_code as "bankCode", a.account_no as "accountNo", a.account_name as "accountName"
    FROM ledger_bank_account a
    JOIN ledger_bank_account_company ac ON ac.bank_account_id = a.id
    WHERE a.org_id=${orgId}::uuid AND ac.company_id=${companyId}::uuid AND a.is_active=true
    ORDER BY a.bank_code, a.account_no`;
  return rows.map((r) => ({
    ...r, label: `${acctLabel(r.bankCode, r.accountNo) ?? r.accountNo} · ${r.accountName}`,
  }));
}

// ── Reconcile coverage (% กระทบยอด) — count + ฿ by match_state + direction ──────
// ใช้บนหน้าบัญชี (ต่อบัญชี) + หน้าหลัก (รวมทุกบัญชี). อ่านสด ๆ จาก ledger_bank_txn.
// match_state: unmatched(ยังไม่จัดการ) · suggested(รอยืนยัน) · confirmed(ยืนยัน/โยกเงิน) · excluded(ข้าม).
export interface ReconcileCoverage {
  total: number; totalSatang: number;
  unmatched: number; unmatchedSatang: number;
  suggested: number; suggestedSatang: number;
  confirmed: number; confirmedSatang: number;
  excluded: number; excludedSatang: number;
  inCount: number; inSatang: number;     // เงินเข้า (credit)
  outCount: number; outSatang: number;   // เงินออก (debit)
  // derived (0–100, ปัดเศษ) — ตามยอดเงิน (satang) เป็นหลัก + ตามจำนวนรายการ
  confirmedPctSatang: number; confirmedPctCount: number;  // "ยืนยันแล้วจริง"
  handledPctSatang: number; handledPctCount: number;      // จัดการแล้ว (ยืนยัน+ข้าม+รอยืนยัน) = ไม่นับสีแดง
}
export async function reconcileCoverage(params: {
  orgId: string; companyId: string; bankAccountId?: string; periodStart: string; periodEnd: string;
}): Promise<ReconcileCoverage> {
  const { orgId, companyId, bankAccountId, periodStart, periodEnd } = params;
  const rows = await prisma.$queryRaw<{
    total: number; totalSatang: bigint;
    unmatched: number; unmatchedSatang: bigint;
    suggested: number; suggestedSatang: bigint;
    confirmed: number; confirmedSatang: bigint;
    excluded: number; excludedSatang: bigint;
    inCount: number; inSatang: bigint; outCount: number; outSatang: bigint;
  }[]>`
    SELECT
      COUNT(*)::int as "total",
      COALESCE(SUM(ABS(amount_satang)),0)::bigint as "totalSatang",
      COUNT(*) FILTER (WHERE match_state='unmatched')::int as "unmatched",
      COALESCE(SUM(ABS(amount_satang)) FILTER (WHERE match_state='unmatched'),0)::bigint as "unmatchedSatang",
      COUNT(*) FILTER (WHERE match_state='suggested')::int as "suggested",
      COALESCE(SUM(ABS(amount_satang)) FILTER (WHERE match_state='suggested'),0)::bigint as "suggestedSatang",
      COUNT(*) FILTER (WHERE match_state='confirmed')::int as "confirmed",
      COALESCE(SUM(ABS(amount_satang)) FILTER (WHERE match_state='confirmed'),0)::bigint as "confirmedSatang",
      COUNT(*) FILTER (WHERE match_state='excluded')::int as "excluded",
      COALESCE(SUM(ABS(amount_satang)) FILTER (WHERE match_state='excluded'),0)::bigint as "excludedSatang",
      COUNT(*) FILTER (WHERE amount_satang > 0)::int as "inCount",
      COALESCE(SUM(amount_satang) FILTER (WHERE amount_satang > 0),0)::bigint as "inSatang",
      COUNT(*) FILTER (WHERE amount_satang < 0)::int as "outCount",
      COALESCE(SUM(ABS(amount_satang)) FILTER (WHERE amount_satang < 0),0)::bigint as "outSatang"
    FROM ledger_bank_txn
    WHERE org_id=${orgId}::uuid AND company_id=${companyId}::uuid
      AND txn_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
      AND (${bankAccountId ?? null}::uuid IS NULL OR bank_account_id = ${bankAccountId ?? null}::uuid)`;
  const r = rows[0];
  const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
  const total = n(r?.total), totalSat = n(r?.totalSatang);
  const confirmed = n(r?.confirmed), confirmedSat = n(r?.confirmedSatang);
  const suggested = n(r?.suggested), suggestedSat = n(r?.suggestedSatang);
  const excluded = n(r?.excluded), excludedSat = n(r?.excludedSatang);
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const handledSat = confirmedSat + excludedSat + suggestedSat;
  const handledCnt = confirmed + excluded + suggested;
  return {
    total, totalSatang: totalSat,
    unmatched: n(r?.unmatched), unmatchedSatang: n(r?.unmatchedSatang),
    suggested, suggestedSatang: suggestedSat,
    confirmed, confirmedSatang: confirmedSat,
    excluded, excludedSatang: excludedSat,
    inCount: n(r?.inCount), inSatang: n(r?.inSatang),
    outCount: n(r?.outCount), outSatang: n(r?.outSatang),
    confirmedPctSatang: pct(confirmedSat, totalSat), confirmedPctCount: pct(confirmed, total),
    handledPctSatang: pct(handledSat, totalSat), handledPctCount: pct(handledCnt, total),
  };
}
