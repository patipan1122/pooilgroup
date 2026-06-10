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
        // P1#3 — ATOMIC PAYMENT MATCH: SELECT unpaid first INSIDE the transaction,
        // then UPDATE only if we hold the row. If another slip grabbed it between
        // findFirst and updateMany, findFirst returns null here and we throw →
        // the whole transaction rolls back (payment row not created either).
        // This prevents two concurrent slips from double-marking the same bill.
        const unpaidBill = await tx.ledgerExpense.findFirst({
          where: { id: matchedExpenseId, orgId, companyId, paymentStatus: "unpaid" },
          select: { id: true },
        });
        if (!unpaidBill) {
          // Bill already paid (race) or never existed — rollback the payment insert.
          throw Object.assign(new Error("ALREADY_PAID"), { code: "BILL_ALREADY_PAID" });
        }
        // ROW-LOCK the flip: condition on paymentStatus='unpaid' + scope org/company.
        // The findFirst above is NOT a lock (READ COMMITTED) — two slips for the same
        // bill could both pass it; updateMany re-evaluates → 2nd gets count=0 → throw.
        const flip = await tx.ledgerExpense.updateMany({
          where: { id: matchedExpenseId, orgId, companyId, paymentStatus: "unpaid" },
          data: { paymentStatus: "paid" },
        });
        if (flip.count !== 1) {
          throw Object.assign(new Error("ALREADY_PAID"), { code: "BILL_ALREADY_PAID" });
        }
        marked = true;
      }
      return { paymentId: payment.id, marked };
    });
    return { ok: true, paymentId: result.paymentId, marked: result.marked };
  } catch (e) {
    // P2002 = the unique trans_ref / sha256 index fired → already paid once.
    if (errCode(e) === "P2002") {
      return { ok: false, duplicate: true, error: "สลิปนี้ถูกบันทึกไปแล้ว (กันจ่ายซ้ำ)" };
    }
    // P1#3 — ATOMIC MATCH race: another slip grabbed the bill first → rollback ok.
    if ((e as { code?: string })?.code === "BILL_ALREADY_PAID") {
      return { ok: false, error: "บิลนี้ถูกจ่ายไปแล้ว (สลิปอื่นจับคู่ก่อน)" };
    }
    console.error("[ledger:recordSlipPayment] failed", e);
    return { ok: false, error: "บันทึกสลิปไม่สำเร็จ" };
  }
}

export type AutoMatchResult =
  | { kind: "matched"; expenseId: string; docCode: string; vendor: string | null }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number }
  /** P2#18 — slip amount matches bill MINUS WHT (vendor paid before deduction). */
  | { kind: "wht_mismatch"; expenseId: string; docCode: string; vendor: string | null; slipAmount: number; billTotal: number; wht: number };

/**
 * Find the single unpaid bill whose total equals the slip amount within the
 * recent window. Exactly one → matched; zero → none; more than one → ambiguous
 * (the human decides — we never guess). Quotations count (they are real unpaid
 * spend and a slip legitimately pays them).
 *
 * P2#18 — WHT HANDLING: if the slip amount doesn't match bill.total exactly but
 * matches bill.total - bill.wht (vendor paid after WHT deduction on their end),
 * return kind="wht_mismatch" with a warning so the accountant can review instead
 * of silently failing to match.
 */
export async function findAutoMatchBill(opts: {
  orgId: string;
  companyId: string;
  amount: number | null;
}): Promise<AutoMatchResult> {
  const { orgId, companyId, amount } = opts;
  if (amount == null || !(amount > 0)) return { kind: "none" };

  const since = new Date(Date.now() - AUTO_MATCH_WINDOW_DAYS * 24 * 3600 * 1000);

  // Bills that are already inside an ACTIVE payment-request ("ขอโอนเงิน") must not be
  // grabbed by this legacy amount-matcher — their slip is matched to the REQUEST
  // (matchSlipToRequest runs first in the webhook). Excluding them keeps a stray
  // same-amount slip from closing the wrong (already-requested) bill. With no
  // requests this is `notIn: []` → behaviour is identical to before (byte-safe).
  const activeReq = await prisma.ledgerPaymentRequestBill
    .findMany({ where: { orgId, companyId, active: true }, select: { expenseId: true } })
    .catch(() => [] as { expenseId: string }[]);
  const excludedBillIds = activeReq.map((r) => r.expenseId);

  // Primary search: exact total match.
  const candidates = await prisma.ledgerExpense.findMany({
    where: {
      orgId,
      companyId,
      status: { in: ["confirmed", "locked"] },
      paymentStatus: "unpaid",
      total: amount, // Prisma accepts number for a Decimal filter
      createdAt: { gte: since },
      ...(excludedBillIds.length > 0 ? { id: { notIn: excludedBillIds } } : {}),
    },
    select: { id: true, docCode: true, vendor: true, wht: true },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  if (candidates.length === 0) {
    // P2#18 — WHT fallback: look for bills where (total - wht) == slipAmount.
    // This handles the common Thai accounting case where the vendor deducts WHT
    // themselves and remits only the net amount (total − WHT).
    // We look for a SINGLE such bill; ambiguous (multiple) → still "none" so the
    // human pairs it manually (safer than a wrong auto-match).
    const whtCandidates = await prisma.ledgerExpense.findMany({
      where: {
        orgId,
        companyId,
        status: { in: ["confirmed", "locked"] },
        paymentStatus: "unpaid",
        wht: { gt: 0 }, // only bills that have WHT recorded
        createdAt: { gte: since },
        ...(excludedBillIds.length > 0 ? { id: { notIn: excludedBillIds } } : {}),
      },
      select: { id: true, docCode: true, vendor: true, total: true, wht: true },
      orderBy: { createdAt: "desc" },
      take: 50, // reasonable upper bound for WHT scan
    });

    // Filter in JS: total - wht === slipAmount (using rounded comparison to avoid
    // Decimal float drift — both are stored as Decimal(15,2) so 2dp is enough).
    const netMatch = whtCandidates.filter((r) => {
      const netAmount = Math.round((Number(r.total) - Number(r.wht)) * 100) / 100;
      return Math.abs(netAmount - amount) < 0.005; // ±½ สตางค์
    });

    if (netMatch.length === 1) {
      return {
        kind: "wht_mismatch",
        expenseId: netMatch[0].id,
        docCode: netMatch[0].docCode,
        vendor: netMatch[0].vendor,
        slipAmount: amount,
        billTotal: Number(netMatch[0].total),
        wht: Number(netMatch[0].wht),
      };
    }
    return { kind: "none" };
  }

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
