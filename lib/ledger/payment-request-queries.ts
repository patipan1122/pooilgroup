// LedgerLine — read-only queries for the /ledger/reconcile back-office page (PR4).
//
// The accountant (WFH) watches the whole "ขอโอนเงิน → จ่าย → สลิป → กระทบยอด" loop
// from one page. This module ONLY reads — it never mutates (the single allowed
// mutation, pairing a floating slip to a request, goes through the existing
// assignSlipToRequestAction). Everything is bucketed by request `state`:
//
//   awaiting  (รอโอน)        state = "open"
//   partial   (จ่ายบางส่วน)   state = "partial"
//   paid      (จ่ายแล้ว)      state = "paid", last 90d by paidAt
//   abnormal  (ต้องตรวจ)      state = "abnormal" + truly-floating slips
//
// HARD RULE (security): EVERY query is filtered by orgId AND companyId. One org
// owns multiple legal entities (Pooil ↔ JP Sync, separate VAT books); an org-only
// query would leak requests/slips across companies. companyId is never optional
// here and never falls back to org-wide.
//
// Money: stored as Decimal(15,2) baht; we convert to Number and round to 2dp at
// the edge so the UI/CSV never does float math on Decimal objects.
import { prisma } from "@/lib/prisma";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** How far back the "จ่ายแล้ว" bucket looks (recent history; full history is the
 *  ledger book, not the reconcile worklist). */
const PAID_WINDOW_DAYS = 90;

export interface ReconcileBill {
  expenseId: string;
  docCode: string;
  amount: number;
  wht: number;
}

export interface ReconcileRequestRow {
  id: string;
  state: string;
  vendor: string | null;
  branchId: string | null;
  billsGross: number;
  whtTotal: number;
  expectedTransfer: number;
  paidTotal: number;
  abnormalReason: string | null;
  // audit-trail (audit P1) — who requested / who paid + the slip evidence.
  requestedByName: string | null;
  paidBy: string | null; // LINE userId of the payer (from the slip)
  transRef: string | null; // bank slip reference (for manual bank-rec)
  slipUrl: string | null;
  slipThumbUrl: string | null;
  requestedAt: string;
  paidAt: string | null;
  bills: ReconcileBill[];
}

export interface ReconcileFloatingSlip {
  id: string;
  amount: number;
  sendingBank: string | null;
  transRef: string | null;
  slipUrl: string | null;
  slipThumbUrl: string | null;
  qrDecoded: boolean;
  paidAt: string | null;
  createdAt: string;
}

export interface ReconcileBucketSummary {
  count: number;
  expectedTotal: number;
}

export interface ReconcileResult {
  awaiting: ReconcileRequestRow[];
  partial: ReconcileRequestRow[];
  paid: ReconcileRequestRow[];
  abnormal: ReconcileRequestRow[];
  /** floating slips (no request, no bill) — shown under "ต้องตรวจ" for manual pairing. */
  floatingSlips: ReconcileFloatingSlip[];
  summary: {
    awaiting: ReconcileBucketSummary;
    partial: ReconcileBucketSummary;
    paid: ReconcileBucketSummary;
    abnormal: ReconcileBucketSummary; // counts requests + floating slips together
  };
}

export interface ReconcileFilters {
  /** restrict to one branch (must belong to the scoped company). */
  branchId?: string | null;
  /** YYYY-MM — filter on the request's requestedAt month (Asia/Bangkok-naive UTC range). */
  month?: string | null;
  /** case-insensitive substring on vendor. */
  vendor?: string | null;
}

/** Build a Prisma where-clause fragment for the optional filters. Always merged
 *  on top of the mandatory { orgId, companyId } base (never replaces it). */
function buildFilterWhere(filters?: ReconcileFilters) {
  const where: {
    branchId?: string;
    vendor?: { contains: string; mode: "insensitive" };
    requestedAt?: { gte: Date; lt: Date };
  } = {};
  if (filters?.branchId) where.branchId = filters.branchId;
  if (filters?.vendor && filters.vendor.trim()) {
    where.vendor = { contains: filters.vendor.trim(), mode: "insensitive" };
  }
  if (filters?.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    const [y, m] = filters.month.split("-").map(Number);
    // UTC month range — requestedAt is timestamptz; this is a coarse calendar
    // filter for the accountant's "show me this month's requests", good enough.
    const gte = new Date(Date.UTC(y, m - 1, 1));
    const lt = new Date(Date.UTC(y, m, 1));
    where.requestedAt = { gte, lt };
  }
  return where;
}

/** Map a Prisma request row (with bills relation) → the serialisable row shape.
 *  docCode is filled by `docCodeByExpense` (a separate scoped lookup, since the
 *  join table has no Prisma relation to LedgerExpense). */
function mapRequestRow(
  r: {
    id: string;
    state: string;
    vendor: string | null;
    branchId: string | null;
    billsGross: unknown;
    whtTotal: unknown;
    expectedTransfer: unknown;
    paidTotal: unknown;
    abnormalReason: string | null;
    requestedAt: Date;
    paidAt: Date | null;
    requestedBy: string | null;
    paidBy: string | null;
    bills: Array<{ expenseId: string; billAmount: unknown; billWht: unknown }>;
  },
  docCodeByExpense: Map<string, string>,
  userName: Map<string, string>,
  slipByReq: Map<string, { transRef: string | null; slipUrl: string | null; slipThumbUrl: string | null }>,
): ReconcileRequestRow {
  const slip = slipByReq.get(r.id);
  return {
    id: r.id,
    state: r.state,
    vendor: r.vendor,
    branchId: r.branchId,
    billsGross: round2(Number(r.billsGross)),
    whtTotal: round2(Number(r.whtTotal)),
    expectedTransfer: round2(Number(r.expectedTransfer)),
    paidTotal: round2(Number(r.paidTotal)),
    abnormalReason: r.abnormalReason,
    requestedAt: r.requestedAt.toISOString(),
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    requestedByName: r.requestedBy ? userName.get(r.requestedBy) ?? null : null,
    paidBy: r.paidBy,
    transRef: slip?.transRef ?? null,
    slipUrl: slip?.slipUrl ?? null,
    slipThumbUrl: slip?.slipThumbUrl ?? null,
    bills: r.bills.map((b) => ({
      expenseId: b.expenseId,
      docCode: docCodeByExpense.get(b.expenseId) ?? "—",
      amount: round2(Number(b.billAmount)),
      wht: round2(Number(b.billWht)),
    })),
  };
}

const REQUEST_SELECT = {
  id: true,
  state: true,
  vendor: true,
  branchId: true,
  billsGross: true,
  whtTotal: true,
  expectedTransfer: true,
  paidTotal: true,
  abnormalReason: true,
  requestedAt: true,
  paidAt: true,
  requestedBy: true,
  paidBy: true,
  bills: {
    select: { expenseId: true, billAmount: true, billWht: true },
  },
} as const;

/**
 * Load all 4 reconcile buckets for one company. Read-only.
 * Each request includes its bills (docCode + amount). Floating slips (a slip with
 * neither a request nor a bill) ride along in the "ต้องตรวจ" bucket.
 */
export async function listReconcile(
  orgId: string,
  companyId: string,
  filters?: ReconcileFilters,
): Promise<ReconcileResult> {
  const filterWhere = buildFilterWhere(filters);
  const base = { orgId, companyId, ...filterWhere };
  const paidSince = new Date(Date.now() - PAID_WINDOW_DAYS * 24 * 3600 * 1000);

  const [awaitingRaw, partialRaw, paidRaw, abnormalRaw, floatingRaw] = await Promise.all([
    prisma.ledgerPaymentRequest.findMany({
      where: { ...base, state: "open" },
      select: REQUEST_SELECT,
      orderBy: { requestedAt: "desc" },
      take: 300,
    }),
    prisma.ledgerPaymentRequest.findMany({
      where: { ...base, state: "partial" },
      select: REQUEST_SELECT,
      orderBy: { requestedAt: "desc" },
      take: 300,
    }),
    prisma.ledgerPaymentRequest.findMany({
      where: { ...base, state: "paid", paidAt: { gte: paidSince } },
      select: REQUEST_SELECT,
      orderBy: { paidAt: "desc" },
      take: 300,
    }),
    prisma.ledgerPaymentRequest.findMany({
      where: { ...base, state: "abnormal" },
      select: REQUEST_SELECT,
      orderBy: { requestedAt: "desc" },
      take: 300,
    }),
    // A truly-floating slip: no request AND no bill → it needs human attention.
    // companyId-scoped (a slip belongs to exactly one company).
    prisma.ledgerPayment.findMany({
      where: { orgId, companyId, paymentRequestId: null, matchedExpenseId: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        amount: true,
        sendingBank: true,
        transRef: true,
        slipUrl: true,
        slipThumbUrl: true,
        qrDecoded: true,
        paidAt: true,
        createdAt: true,
      },
    }),
  ]);

  // Resolve docCodes for every bill across all buckets in ONE scoped query
  // (avoids an N+1 per request). companyId-scoped so a stray id can't read a
  // doc-code from another company.
  const allExpenseIds = Array.from(
    new Set(
      [...awaitingRaw, ...partialRaw, ...paidRaw, ...abnormalRaw].flatMap((r) =>
        r.bills.map((b) => b.expenseId),
      ),
    ),
  );
  const docCodeByExpense = new Map<string, string>();
  if (allExpenseIds.length > 0) {
    const codes = await prisma.ledgerExpense.findMany({
      where: { id: { in: allExpenseIds }, orgId, companyId },
      select: { id: true, docCode: true },
    });
    for (const c of codes) docCodeByExpense.set(c.id, c.docCode);
  }

  // audit-trail (audit P1) — resolve requester names + the slip evidence (transRef +
  // url) per request, both in ONE scoped query each (no N+1). Used by the board + CSV.
  const allReqRows = [...awaitingRaw, ...partialRaw, ...paidRaw, ...abnormalRaw];
  const reqIds = allReqRows.map((r) => r.id);
  const userName = new Map<string, string>();
  const requesterIds = Array.from(
    new Set(allReqRows.map((r) => r.requestedBy).filter((x): x is string => !!x)),
  );
  if (requesterIds.length > 0) {
    const users = await prisma.user
      .findMany({ where: { id: { in: requesterIds }, orgId }, select: { id: true, name: true } })
      .catch(() => [] as { id: string; name: string }[]);
    for (const u of users) userName.set(u.id, u.name);
  }
  const slipByReq = new Map<string, { transRef: string | null; slipUrl: string | null; slipThumbUrl: string | null }>();
  if (reqIds.length > 0) {
    const pays = await prisma.ledgerPayment
      .findMany({
        where: { orgId, companyId, paymentRequestId: { in: reqIds } },
        orderBy: { createdAt: "asc" },
        select: { paymentRequestId: true, transRef: true, slipUrl: true, slipThumbUrl: true },
      })
      .catch(() => [] as { paymentRequestId: string | null; transRef: string | null; slipUrl: string | null; slipThumbUrl: string | null }[]);
    for (const p of pays) {
      if (!p.paymentRequestId || slipByReq.has(p.paymentRequestId)) continue; // first slip per request
      slipByReq.set(p.paymentRequestId, { transRef: p.transRef, slipUrl: p.slipUrl, slipThumbUrl: p.slipThumbUrl });
    }
  }

  const awaiting = awaitingRaw.map((r) => mapRequestRow(r, docCodeByExpense, userName, slipByReq));
  const partial = partialRaw.map((r) => mapRequestRow(r, docCodeByExpense, userName, slipByReq));
  const paid = paidRaw.map((r) => mapRequestRow(r, docCodeByExpense, userName, slipByReq));
  const abnormal = abnormalRaw.map((r) => mapRequestRow(r, docCodeByExpense, userName, slipByReq));
  const floatingSlips: ReconcileFloatingSlip[] = floatingRaw.map((s) => ({
    id: s.id,
    amount: round2(Number(s.amount)),
    sendingBank: s.sendingBank,
    transRef: s.transRef,
    slipUrl: s.slipUrl,
    slipThumbUrl: s.slipThumbUrl,
    qrDecoded: s.qrDecoded,
    paidAt: s.paidAt ? s.paidAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  }));

  const sumExpected = (rows: ReconcileRequestRow[]): number =>
    round2(rows.reduce((s, r) => s + r.expectedTransfer, 0));

  return {
    awaiting,
    partial,
    paid,
    abnormal,
    floatingSlips,
    summary: {
      awaiting: { count: awaiting.length, expectedTotal: sumExpected(awaiting) },
      partial: { count: partial.length, expectedTotal: sumExpected(partial) },
      paid: { count: paid.length, expectedTotal: sumExpected(paid) },
      // "ต้องตรวจ" combines abnormal requests + floating slips.
      abnormal: {
        count: abnormal.length + floatingSlips.length,
        expectedTotal: round2(
          sumExpected(abnormal) + floatingSlips.reduce((s, f) => s + f.amount, 0),
        ),
      },
    },
  };
}

// ─── #4 LIFF detail page (ดูรายละเอียด/จ่าย) ──────────────────────────────────
export interface PaymentRequestDetail {
  id: string;
  state: string;
  vendor: string | null;
  billsGross: number;
  whtTotal: number;
  expectedTransfer: number;
  paidTotal: number;
  payeeAcctName: string | null;
  payeeBankCode: string | null;
  payeeAcctNo: string | null;
  payeePromptpay: string | null;
  payeeQrImageUrl: string | null;
  requestedAt: string;
  bills: { docCode: string; amount: number; wht: number }[];
}

/** Read one request (read-only) for the LIFF detail page. Scoped by orgId; the
 *  caller (the LIFF page) resolves orgId from the verified ledger actor. */
export async function getPaymentRequestDetail(
  orgId: string,
  id: string,
): Promise<PaymentRequestDetail | null> {
  const r = await prisma.ledgerPaymentRequest.findFirst({
    where: { id, orgId },
    select: {
      id: true, state: true, vendor: true, companyId: true,
      billsGross: true, whtTotal: true, expectedTransfer: true, paidTotal: true,
      payeeAcctName: true, payeeBankCode: true, payeeAcctNo: true, payeePromptpay: true,
      payeeQrImageUrl: true,
      requestedAt: true,
      bills: { select: { expenseId: true, billAmount: true, billWht: true } },
    },
  });
  if (!r) return null;
  const ids = r.bills.map((b) => b.expenseId);
  const codeMap = new Map<string, string>();
  if (ids.length > 0) {
    const codes = await prisma.ledgerExpense.findMany({
      where: { id: { in: ids }, orgId, companyId: r.companyId },
      select: { id: true, docCode: true },
    });
    for (const c of codes) codeMap.set(c.id, c.docCode);
  }
  return {
    id: r.id,
    state: r.state,
    vendor: r.vendor,
    billsGross: round2(Number(r.billsGross)),
    whtTotal: round2(Number(r.whtTotal)),
    expectedTransfer: round2(Number(r.expectedTransfer)),
    paidTotal: round2(Number(r.paidTotal)),
    payeeAcctName: r.payeeAcctName,
    payeeBankCode: r.payeeBankCode,
    payeeAcctNo: r.payeeAcctNo,
    payeePromptpay: r.payeePromptpay,
    payeeQrImageUrl: r.payeeQrImageUrl,
    requestedAt: r.requestedAt.toISOString(),
    bills: r.bills.map((b) => ({
      docCode: codeMap.get(b.expenseId) ?? "—",
      amount: round2(Number(b.billAmount)),
      wht: round2(Number(b.billWht)),
    })),
  };
}
