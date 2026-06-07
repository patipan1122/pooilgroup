// LedgerLine — payment-request ("ขอโอนเงิน") core: create · match-slip · close · cancel.
//
// The daily AP loop (workshop 2026-06-07, flag LEDGER_PAYREQ_V1):
//   operation selects bills → createPaymentRequest → card pushed to the executive
//   (= slip-intake) LINE group → executive transfers + drops the slip → the slip is
//   matched to the REQUEST (matchSlipToRequest, NOT amount-guessed against all bills)
//   → every bill in the request flips to paid in ONE transaction → reconcile.
//
// Money safety (RULE I + workshop guards):
//   • 1-OPEN-request-per-bill — a partial-unique index on the join table; a 2nd "ขอโอน"
//     on the same bill surfaces as P2002 (race-proof anti double-pay, not an app check).
//   • companyId is filtered on EVERY query + asserted single across selected bills
//     (Pooil↔JP Sync are separate VAT entities — cross-entity leak is forbidden).
//   • WHT (หัก ณ ที่จ่าย): the slip is matched to expectedTransfer = gross − wht
//     (the NET the executive actually transfers), NOT to the gross bill total.
//   • Atomic close — payment row + all bills flipped paid in the SAME $transaction.
//   • Pay/slip is a CASH event ONLY — never touches TRCloud push / apType / posting.
//   • Decimal(15,2) baht — round2 for compares, never float drift.
import { prisma } from "@/lib/prisma";
import { expenseConfirmability, confirmabilityMessage } from "./confirmability";

/** Bank-fee + rounding slack when matching a slip to a request's expected amount.
 *  A cross-bank transfer fee makes the slip a few baht OVER the expected net.
 *  TODO(CEO): confirm the real cross-bank fee to tune this band. */
const MATCH_TOLERANCE_BAHT = 20;

/** Max bills in one request (a sane batch ceiling). */
const MAX_BILLS_PER_REQUEST = 50;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export type PaymentRequestState =
  | "open" // card pushed, awaiting transfer/slip
  | "partial" // some slip(s) in, < expected
  | "paid" // fully paid, all bills closed
  | "cancelled" // voided before any slip
  | "abnormal" // mismatch — accountant resolves
  | "reversed"; // voided after pay

export interface PayeeSnapshot {
  acctName?: string | null;
  bankCode?: string | null;
  acctNo?: string | null;
  promptpay?: string | null;
  qrPayload?: string | null;
}

export interface CreatePaymentRequestInput {
  orgId: string;
  /** bill ids the operator ticked (same company + same vendor). */
  billIds: string[];
  payee: PayeeSnapshot;
  /** pool user id of the requester. */
  requestedBy: string;
}

export interface CreatePaymentRequestResult {
  ok: boolean;
  requestId?: string;
  error?: string;
  companyId?: string;
  branchId?: string | null;
  vendor?: string | null;
  billsGross?: number;
  whtTotal?: number;
  expectedTransfer?: number;
  billCount?: number;
}

/** Duck-typed Prisma error-code check (repo idiom). */
function errCode(e: unknown): string | null {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
    ? (e as { code: string }).code
    : null;
}

const norm = (s: string | null | undefined): string => (s ?? "").trim();

/**
 * Create one payment request from a set of bills.
 * Validates: same company, same vendor, each bill non-void + classifiable
 * (branch+category present per the confirm-gate), then atomically creates the
 * request + join rows + forces every bill to paymentStatus='unpaid'.
 * The partial-unique index guarantees a bill can't be in two open requests.
 */
export async function createPaymentRequest(
  input: CreatePaymentRequestInput,
): Promise<CreatePaymentRequestResult> {
  const { orgId, billIds, payee, requestedBy } = input;
  const ids = Array.from(new Set(billIds.filter(Boolean)));
  if (ids.length === 0) return { ok: false, error: "ยังไม่ได้เลือกบิล" };
  if (ids.length > MAX_BILLS_PER_REQUEST)
    return { ok: false, error: `เลือกได้ไม่เกิน ${MAX_BILLS_PER_REQUEST} ใบต่อคำขอ` };

  // Load all selected bills scoped by org. companyId is asserted below — a
  // client-supplied id array can't smuggle a cross-company bill through.
  const bills = await prisma.ledgerExpense.findMany({
    where: { id: { in: ids }, orgId },
    select: {
      id: true, companyId: true, branchId: true, categoryId: true, status: true,
      vendor: true, total: true, wht: true,
    },
  });
  if (bills.length !== ids.length) return { ok: false, error: "ไม่พบบิลบางใบ (อาจถูกลบ)" };

  // 1) Single company (Pooil↔JP Sync separate VAT — never mix in one request).
  const companies = Array.from(new Set(bills.map((b) => b.companyId)));
  if (companies.length > 1)
    return { ok: false, error: "บิลข้ามบริษัท — แยกขอโอนทีละบริษัท" };
  const companyId = companies[0];

  // 2) No void bills.
  if (bills.some((b) => b.status === "void"))
    return { ok: false, error: "มีบิลที่ถูกยกเลิกอยู่ในรายการ" };

  // 3) Each bill classifiable (branch + category present) — D6 gate (status may be draft).
  for (const b of bills) {
    const c = expenseConfirmability({ branchId: b.branchId, categoryId: b.categoryId });
    if (!c.ok) return { ok: false, error: `บิลบางใบ${confirmabilityMessage(c.missing)}` };
  }

  // 4) Single vendor (the payee account is one — bills must share a vendor).
  const vendors = Array.from(new Set(bills.map((b) => norm(b.vendor)).filter((v) => v.length > 0)));
  if (vendors.length > 1)
    return { ok: false, error: "บิลต่างผู้ขาย — แยกขอโอนทีละผู้ขาย" };
  const vendor = vendors[0] ?? bills[0].vendor ?? null;

  // 5) Common branch (null if mixed — reconcile still scopes by company).
  const branches = Array.from(new Set(bills.map((b) => b.branchId).filter(Boolean)));
  const branchId = branches.length === 1 ? (branches[0] as string) : null;

  const billsGross = round2(bills.reduce((s, b) => s + Number(b.total), 0));
  const whtTotal = round2(bills.reduce((s, b) => s + Number(b.wht), 0));
  const expectedTransfer = round2(billsGross - whtTotal);

  try {
    const requestId = await prisma.$transaction(async (tx) => {
      const req = await tx.ledgerPaymentRequest.create({
        data: {
          orgId, companyId, branchId, vendor,
          payeeAcctName: payee.acctName ?? null,
          payeeBankCode: payee.bankCode ?? null,
          payeeAcctNo: payee.acctNo ?? null,
          payeePromptpay: payee.promptpay ?? null,
          payeeQrPayload: payee.qrPayload ?? null,
          billsGross, whtTotal, expectedTransfer, paidTotal: 0,
          state: "open",
          requestedBy,
        },
        select: { id: true },
      });
      // Join rows — the partial-unique (org,company,expense_id) WHERE active fires
      // here as P2002 if any bill is already in an OPEN request.
      await tx.ledgerPaymentRequestBill.createMany({
        data: bills.map((b) => ({
          orgId, companyId, requestId: req.id, expenseId: b.id,
          billAmount: Number(b.total), billWht: Number(b.wht), active: true,
        })),
      });
      // Force unpaid (bills are born paymentStatus='paid' by default → the
      // "รอจ่าย" bucket would be empty without this).
      await tx.ledgerExpense.updateMany({
        where: { id: { in: ids }, orgId, companyId },
        data: { paymentStatus: "unpaid" },
      });
      return req.id;
    });
    return {
      ok: true, requestId, companyId, branchId, vendor,
      billsGross, whtTotal, expectedTransfer, billCount: bills.length,
    };
  } catch (e) {
    if (errCode(e) === "P2002")
      return { ok: false, error: "บิลบางใบมีคำขอโอนค้างอยู่แล้ว (กันขอ/จ่ายซ้ำ)" };
    console.error("[ledger:createPaymentRequest] failed", e);
    return { ok: false, error: "สร้างคำขอโอนไม่สำเร็จ" };
  }
}

export interface MatchSlipToRequestInput {
  orgId: string;
  companyId: string;
  slipAmount: number | null;
  sendingBank: string | null;
  transRef: string | null;
  slipSha256: string | null;
  slipUrl: string | null;
  qrRaw: string | null;
  qrDecoded: boolean;
  /** LINE userId of the executive who sent the slip (D2 audit: who paid). */
  paidByLineUserId?: string | null;
}

export type MatchSlipResult =
  | {
      matched: true;
      requestId: string;
      vendor: string | null;
      billCount: number;
      paidTotal: number;
      paymentId: string;
    }
  | { matched: false; reason: "no_request" | "ambiguous" | "duplicate" | "error" };

/**
 * Try to match an incoming slip to exactly ONE open/partial request by the NET
 * amount (expectedTransfer − already-paid, within a bank-fee tolerance). On a
 * unique match: create the payment row linked to the request + flip every bill
 * to paid + close the request, ALL in one transaction. Otherwise returns
 * matched=false so the webhook falls through to the legacy bill auto-matcher /
 * floating queue — this is purely ADDITIVE, it never closes the wrong thing.
 */
export async function matchSlipToRequest(
  input: MatchSlipToRequestInput,
): Promise<MatchSlipResult> {
  const { orgId, companyId, slipAmount } = input;
  if (slipAmount == null || !(slipAmount > 0)) return { matched: false, reason: "no_request" };

  const open = await prisma.ledgerPaymentRequest.findMany({
    where: { orgId, companyId, state: { in: ["open", "partial"] } },
    select: { id: true, vendor: true, expectedTransfer: true, paidTotal: true },
    take: 200,
  });
  if (open.length === 0) return { matched: false, reason: "no_request" };

  // A slip COMPLETES a request when it covers the remaining net (allowing a small
  // cross-bank fee over). Match only when EXACTLY ONE request is completable —
  // never guess between two same-amount requests.
  const completable = open.filter((r) => {
    const remaining = round2(Number(r.expectedTransfer) - Number(r.paidTotal));
    return slipAmount >= remaining - 0.01 && slipAmount <= remaining + MATCH_TOLERANCE_BAHT;
  });
  if (completable.length !== 1) {
    return { matched: false, reason: completable.length > 1 ? "ambiguous" : "no_request" };
  }
  const target = completable[0];

  try {
    const out = await prisma.$transaction(async (tx) => {
      // Re-read the request under the transaction + guard it's still open.
      const req = await tx.ledgerPaymentRequest.findFirst({
        where: { id: target.id, orgId, companyId, state: { in: ["open", "partial"] } },
        select: { id: true, vendor: true, expectedTransfer: true, paidTotal: true },
      });
      if (!req) throw Object.assign(new Error("GONE"), { code: "REQ_GONE" });

      const payment = await tx.ledgerPayment.create({
        data: {
          orgId, companyId,
          paymentRequestId: req.id,
          amount: slipAmount,
          method: "transfer",
          sendingBank: input.sendingBank,
          transRef: input.transRef,
          slipSha256: input.slipSha256,
          slipUrl: input.slipUrl,
          slipThumbUrl: input.slipUrl,
          qrRaw: input.qrRaw,
          qrDecoded: input.qrDecoded,
          markedBy: null,
          paidAt: new Date(),
        },
        select: { id: true },
      });

      const newPaid = round2(Number(req.paidTotal) + slipAmount);
      // Flip every bill in this request to paid (atomic; guard paymentStatus).
      const billRows = await tx.ledgerPaymentRequestBill.findMany({
        where: { requestId: req.id, active: true },
        select: { expenseId: true },
      });
      const billIds = billRows.map((b) => b.expenseId);
      if (billIds.length > 0) {
        await tx.ledgerExpense.updateMany({
          where: { id: { in: billIds }, orgId, companyId },
          data: { paymentStatus: "paid" },
        });
      }
      // Close the request + free the per-bill guard.
      await tx.ledgerPaymentRequest.update({
        where: { id: req.id },
        data: {
          state: "paid",
          paidTotal: newPaid,
          paidAt: new Date(),
          paidBy: input.paidByLineUserId ?? null,
        },
      });
      await tx.ledgerPaymentRequestBill.updateMany({
        where: { requestId: req.id },
        data: { active: false },
      });
      return { paymentId: payment.id, vendor: req.vendor, billCount: billIds.length, paidTotal: newPaid };
    });
    return {
      matched: true,
      requestId: target.id,
      vendor: out.vendor,
      billCount: out.billCount,
      paidTotal: out.paidTotal,
      paymentId: out.paymentId,
    };
  } catch (e) {
    if (errCode(e) === "P2002") return { matched: false, reason: "duplicate" };
    if (errCode(e) === "REQ_GONE") return { matched: false, reason: "no_request" };
    console.error("[ledger:matchSlipToRequest] failed", e);
    return { matched: false, reason: "error" };
  }
}

export interface CancelResult {
  ok: boolean;
  error?: string;
}

/**
 * Cancel a request BEFORE it is paid (open/partial only). Releases the per-bill
 * guard (active=false) so the bills can be requested again. After pay → use a
 * reversal flow instead (never hard-delete the payment evidence).
 */
export async function cancelPaymentRequest(opts: {
  orgId: string;
  companyId: string;
  requestId: string;
  cancelledBy: string;
}): Promise<CancelResult> {
  const { orgId, companyId, requestId, cancelledBy } = opts;
  const req = await prisma.ledgerPaymentRequest.findFirst({
    where: { id: requestId, orgId, companyId },
    select: { id: true, state: true },
  });
  if (!req) return { ok: false, error: "ไม่พบคำขอโอน" };
  if (req.state === "paid" || req.state === "reversed")
    return { ok: false, error: "คำขอนี้จ่ายแล้ว — ยกเลิกไม่ได้ (ต้องทำรายการคืน)" };
  if (req.state === "cancelled") return { ok: true };

  await prisma.$transaction(async (tx) => {
    const billRows = await tx.ledgerPaymentRequestBill.findMany({
      where: { requestId, active: true },
      select: { expenseId: true },
    });
    await tx.ledgerPaymentRequest.update({
      where: { id: requestId },
      data: { state: "cancelled", cancelledBy, cancelledAt: new Date() },
    });
    await tx.ledgerPaymentRequestBill.updateMany({
      where: { requestId },
      data: { active: false },
    });
    // Bills go back to "unpaid" (still owed) — they were forced unpaid on request.
    const ids = billRows.map((b) => b.expenseId);
    if (ids.length > 0) {
      await tx.ledgerExpense.updateMany({
        where: { id: { in: ids }, orgId, companyId, paymentStatus: { not: "paid" } },
        data: { paymentStatus: "unpaid" },
      });
    }
  });
  return { ok: true };
}

/**
 * Accountant manually assigns a floating slip (paymentRequestId = null) to an
 * open/partial request — the safety net for slips that didn't auto-match
 * (sent to the wrong place, batched, or odd amount). Atomic close like the auto path.
 */
export async function assignSlipToRequest(opts: {
  orgId: string;
  companyId: string;
  paymentId: string;
  requestId: string;
  markedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { orgId, companyId, paymentId, requestId, markedBy } = opts;
  const payment = await prisma.ledgerPayment.findFirst({
    where: { id: paymentId, orgId, companyId },
    select: { id: true, amount: true, paymentRequestId: true, matchedExpenseId: true },
  });
  if (!payment) return { ok: false, error: "ไม่พบสลิป" };
  if (payment.paymentRequestId || payment.matchedExpenseId)
    return { ok: false, error: "สลิปนี้จับคู่แล้ว" };

  try {
    await prisma.$transaction(async (tx) => {
      const req = await tx.ledgerPaymentRequest.findFirst({
        where: { id: requestId, orgId, companyId, state: { in: ["open", "partial", "abnormal"] } },
        select: { id: true, expectedTransfer: true, paidTotal: true },
      });
      if (!req) throw Object.assign(new Error("GONE"), { code: "REQ_GONE" });
      const newPaid = round2(Number(req.paidTotal) + Number(payment.amount));
      const fullyPaid = newPaid >= round2(Number(req.expectedTransfer)) - 0.01;

      await tx.ledgerPayment.update({
        where: { id: paymentId },
        data: { paymentRequestId: req.id, markedBy },
      });
      if (fullyPaid) {
        const billRows = await tx.ledgerPaymentRequestBill.findMany({
          where: { requestId: req.id, active: true },
          select: { expenseId: true },
        });
        const ids = billRows.map((b) => b.expenseId);
        if (ids.length > 0) {
          await tx.ledgerExpense.updateMany({
            where: { id: { in: ids }, orgId, companyId },
            data: { paymentStatus: "paid" },
          });
        }
        await tx.ledgerPaymentRequest.update({
          where: { id: req.id },
          data: { state: "paid", paidTotal: newPaid, paidAt: new Date() },
        });
        await tx.ledgerPaymentRequestBill.updateMany({
          where: { requestId: req.id },
          data: { active: false },
        });
      } else {
        await tx.ledgerPaymentRequest.update({
          where: { id: req.id },
          data: { state: "partial", paidTotal: newPaid },
        });
      }
    });
    return { ok: true };
  } catch (e) {
    if (errCode(e) === "REQ_GONE") return { ok: false, error: "คำขอนี้ปิดไปแล้ว" };
    console.error("[ledger:assignSlipToRequest] failed", e);
    return { ok: false, error: "จับคู่สลิปกับคำขอไม่สำเร็จ" };
  }
}
