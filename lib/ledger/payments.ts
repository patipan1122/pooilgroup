// LedgerLine PR4 (D4) — payment-slip recording, auto-match, and floating list.
//
// A slip arrives in the dedicated "ส่งสลิป" LINE group. The QR gives a unique
// transRef (the dedup key, decoded for free in slip-qr.ts); AI-OCR gives the
// amount once. We then try to AUTO-MATCH that amount to exactly ONE unpaid bill
// inside a recent window. Match → mark the bill paid + store the slip. No/many
// matches → a "floating" slip (matched_expense_id = null) the accountant pairs
// to a bill on the web. Duplicate transRef is caught by the DB unique index
// (PR1) — recordSlipPayment never double-pays.
//
// Money safety: amounts are stored in Decimal(15,2) baht (never float math);
// the matched bill flips to paymentStatus="paid" in the SAME transaction as the
// payment row, so a slip can never mark a bill paid without leaving its evidence.
import { prisma } from "@/lib/prisma";

/** Duck-typed Prisma error-code check (repo idiom — no value import of Prisma). */
function errCode(e: unknown): string | null {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
    ? ((e as { code: string }).code)
    : null;
}

/** How far back (days) auto-match looks. D4: payments are same-day/hourly, so a
 *  tight window keeps amount-collisions on old bills from mis-matching. */
const AUTO_MATCH_WINDOW_DAYS = 31;

export interface RecordSlipInput {
  orgId: string;
  companyId: string;
  /** the bill this slip pays — null = floating (accountant matches later). */
  matchedExpenseId: string | null;
  /** slip amount in baht (from AI-OCR), or null if unreadable. */
  amount: number | null;
  method?: "transfer" | "cash" | "qr";
  sendingBank: string | null;
  transRef: string | null;
  slipSha256: string | null;
  slipUrl: string | null;
  slipThumbUrl?: string | null;
  qrRaw: string | null;
  qrDecoded: boolean;
  /** pool user id (web action) or null (system/webhook). */
  markedBy: string | null;
  paidAt?: Date | null;
}

export interface RecordSlipResult {
  ok: boolean;
  paymentId?: string;
  /** true when the bill was flipped to paid (matchedExpenseId was set + valid). */
  marked?: boolean;
  /** DB caught a duplicate transRef / same image — not recorded. */
  duplicate?: boolean;
  error?: string;
}

/**
 * Record one slip as a ledger_payment, optionally marking its matched bill paid.
 * The unique indexes (org+bank+transRef, org+sha256) are the backstop against a
 * double-pay — a collision surfaces as `duplicate:true` (the caller should have
 * already given a friendly heads-up via checkSlipDuplicate).
 */
export async function recordSlipPayment(input: RecordSlipInput): Promise<RecordSlipResult> {
  const {
    orgId, companyId, matchedExpenseId, amount, method = "transfer",
    sendingBank, transRef, slipSha256, slipUrl, slipThumbUrl, qrRaw, qrDecoded,
    markedBy, paidAt,
  } = input;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.ledgerPayment.create({
        data: {
          orgId,
          companyId,
          matchedExpenseId: matchedExpenseId ?? null,
          amount: amount ?? 0, // Prisma accepts number for a Decimal column
          method,
          sendingBank,
          transRef,
          slipSha256,
          slipUrl,
          slipThumbUrl: slipThumbUrl ?? null,
          qrRaw,
          qrDecoded,
          markedBy,
          paidAt: paidAt ?? new Date(),
        },
        select: { id: true },
      });

      let marked = false;
      if (matchedExpenseId) {
        // Scope the flip by org+company so a client-supplied id can't pay a bill
        // in another company/tenant. Only an unpaid/partial bill flips (idempotent).
        const upd = await tx.ledgerExpense.updateMany({
          where: { id: matchedExpenseId, orgId, companyId },
          data: { paymentStatus: "paid" },
        });
        marked = upd.count > 0;
      }
      return { paymentId: payment.id, marked };
    });
    return { ok: true, paymentId: result.paymentId, marked: result.marked };
  } catch (e) {
    // P2002 = the unique trans_ref / sha256 index fired → already paid once.
    if (errCode(e) === "P2002") {
      return { ok: false, duplicate: true, error: "สลิปนี้ถูกบันทึกไปแล้ว (กันจ่ายซ้ำ)" };
    }
    console.error("[ledger:recordSlipPayment] failed", e);
    return { ok: false, error: "บันทึกสลิปไม่สำเร็จ" };
  }
}

export type AutoMatchResult =
  | { kind: "matched"; expenseId: string; docCode: string; vendor: string | null }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number };

/**
 * Find the single unpaid bill whose total equals the slip amount within the
 * recent window. Exactly one → matched; zero → none; more than one → ambiguous
 * (the human decides — we never guess). Quotations count (they are real unpaid
 * spend and a slip legitimately pays them).
 */
export async function findAutoMatchBill(opts: {
  orgId: string;
  companyId: string;
  amount: number | null;
}): Promise<AutoMatchResult> {
  const { orgId, companyId, amount } = opts;
  if (amount == null || !(amount > 0)) return { kind: "none" };

  const since = new Date(Date.now() - AUTO_MATCH_WINDOW_DAYS * 24 * 3600 * 1000);
  const candidates = await prisma.ledgerExpense.findMany({
    where: {
      orgId,
      companyId,
      status: { in: ["confirmed", "locked"] },
      paymentStatus: "unpaid",
      total: amount, // Prisma accepts number for a Decimal filter
      createdAt: { gte: since },
    },
    select: { id: true, docCode: true, vendor: true },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length > 1) return { kind: "ambiguous", count: candidates.length };
  return {
    kind: "matched",
    expenseId: candidates[0].id,
    docCode: candidates[0].docCode,
    vendor: candidates[0].vendor,
  };
}

export interface FloatingPaymentRow {
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

/** Floating slips (matched_expense_id = null) — the accountant's match queue. */
export async function listFloatingPayments(
  orgId: string,
  companyId: string,
): Promise<FloatingPaymentRow[]> {
  const rows = await prisma.ledgerPayment
    .findMany({
      where: { orgId, companyId, matchedExpenseId: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, amount: true, sendingBank: true, transRef: true,
        slipUrl: true, slipThumbUrl: true, qrDecoded: true, paidAt: true, createdAt: true,
      },
    })
    .catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    sendingBank: r.sendingBank,
    transRef: r.transRef,
    slipUrl: r.slipUrl,
    slipThumbUrl: r.slipThumbUrl,
    qrDecoded: r.qrDecoded,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
