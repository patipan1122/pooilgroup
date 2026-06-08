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
  /** Uploaded QR image URL (R2) — exec scans it straight from the LINE card. */
  qrImageUrl?: string | null;
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

  // 2.5) P0 (bug-hunt B) — reject bills that are ALREADY settled. Without this the
  // force-unpaid updateMany below would REOPEN a paid bill → executive pays it twice.
  // paymentStatus alone is NOT a reliable signal (it DEFAULTS to 'paid' on every bill),
  // so we look for real evidence: a ledger_payment row matched to the bill, OR
  // membership in a request that already closed 'paid'.
  const [directPaid, reqPaid] = await Promise.all([
    prisma.ledgerPayment.findMany({
      where: { orgId, companyId, matchedExpenseId: { in: ids } },
      select: { matchedExpenseId: true },
    }),
    prisma.ledgerPaymentRequestBill.findMany({
      where: { orgId, companyId, expenseId: { in: ids }, request: { state: "paid" } },
      select: { expenseId: true },
    }),
  ]);
  const settled = new Set<string>([
    ...directPaid.map((p) => p.matchedExpenseId).filter((x): x is string => !!x),
    ...reqPaid.map((r) => r.expenseId),
  ]);
  if (settled.size > 0)
    return { ok: false, error: `มีบิลที่จ่ายเงินไปแล้ว ${settled.size} ใบ — ขอโอนซ้ำไม่ได้` };

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
          payeeQrImageUrl: payee.qrImageUrl ?? null,
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
  /** LINE group the slip arrived in — anchors candidate requests to THIS group
   *  (pushedGroupId) so we can name the right request even when the amount is off. */
  groupId?: string | null;
  /** Recipient name read off the slip (verify โอนถูกคนไหม). */
  recipientName?: string | null;
  /** Recipient account/promptpay as seen on the slip (may be masked). */
  recipientAcct?: string | null;
}

/** Detail for a slip that hit a request but did NOT match exactly — the webhook
 *  turns this into the in-group warning card (โอนเกิน/โอนขาด/บัญชีไม่ตรง). */
export interface SlipMismatchDetail {
  vendor: string | null;
  /** the NET the request expected (expectedTransfer − already-paid). */
  expected: number;
  slipAmount: number;
  /** slip − expected: positive = โอนเกิน, negative = โอนขาด. */
  diff: number;
  payeeName: string | null;
  payeeAcct: string | null;
  slipRecipientName: string | null;
  slipRecipientAcct: string | null;
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
  // Found the request but the amount is off (exact-to-the-baht required) — DON'T close.
  | { matched: false; reason: "amount_mismatch"; detail: SlipMismatchDetail }
  // Found a request but it pays a DIFFERENT account/name than the slip — DON'T close.
  | { matched: false; reason: "payee_mismatch"; detail: SlipMismatchDetail }
  | { matched: false; reason: "no_request" | "ambiguous" | "duplicate" | "error" };

/** digits only (drops the masking x/* and separators). */
const onlyDigits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");
/** longest contiguous run of digits in a (possibly masked) account string. */
function longestDigitRun(s: string | null | undefined): string {
  return (String(s ?? "").match(/\d+/g) ?? []).reduce((a, b) => (b.length > a.length ? b : a), "");
}
/** loose Thai name compare — drop spaces / company suffixes / titles, then substring. */
function normName(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/บริษัท|บมจ\.?|บจก\.?|หจก\.?|ห้างหุ้นส่วนจำกัด|จำกัด\(มหาชน\)|จำกัด|มหาชน|company|limited|ltd\.?|co\.?|นาย|นางสาว|นาง|น\.ส\.|mr\.?|mrs\.?|ms\.?/g, "")
    .replace(/[\s().,\-_/]/g, "");
}
function nameSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normName(a), y = normName(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}
/** does the slip's visible account run appear inside the payee account / promptpay? */
function acctSeen(slipAcct: string | null | undefined, payeeAcctNo: string | null, payeePromptpay: string | null): boolean {
  const run = longestDigitRun(slipAcct);
  if (run.length < 3) return false; // nothing usable read off the slip
  const a = onlyDigits(payeeAcctNo), p = onlyDigits(payeePromptpay);
  return (a.length >= 3 && a.includes(run)) || (p.length >= 3 && p.includes(run));
}

/**
 * Match an incoming slip to ONE open/partial request, then VERIFY it (CEO 2026-06-07):
 *  1. IDENTIFY which request the slip pays — by recipient NAME, then visible account
 *     run, then exact amount, then a lone open request in the group. Group-anchored
 *     (pushedGroupId) so the right vendor is named even when the amount is wrong.
 *  2. VERIFY amount EXACT to the baht ("ตรงเป๊ะทุกบาท") → off = amount_mismatch
 *     (โอนเกิน/โอนขาด), and recipient name/account → wrong = payee_mismatch.
 *  3. Only on exact+correct: create the payment + flip every bill paid + close, all
 *     in ONE transaction. On any mismatch it returns matched=false WITH detail so the
 *     webhook keeps the slip as a floating payment and warns the group — never closes
 *     the wrong thing.
 */
export async function matchSlipToRequest(
  input: MatchSlipToRequestInput,
): Promise<MatchSlipResult> {
  const { orgId, companyId, slipAmount, groupId, recipientName, recipientAcct } = input;
  if (slipAmount == null || !(slipAmount > 0)) return { matched: false, reason: "no_request" };

  const openAll = await prisma.ledgerPaymentRequest.findMany({
    where: { orgId, companyId, state: { in: ["open", "partial"] } },
    select: {
      id: true, vendor: true, expectedTransfer: true, paidTotal: true,
      payeeAcctName: true, payeeAcctNo: true, payeePromptpay: true, pushedGroupId: true,
    },
    take: 200,
  });
  if (openAll.length === 0) return { matched: false, reason: "no_request" };
  // Prefer requests pushed to THIS group; fall back to entity-wide if none are tagged.
  const inGroup = groupId ? openAll.filter((r) => r.pushedGroupId === groupId) : [];
  const open = inGroup.length > 0 ? inGroup : openAll;
  type OpenReq = (typeof openAll)[number];
  const remainingOf = (r: OpenReq) => round2(Number(r.expectedTransfer) - Number(r.paidTotal));

  // 1. IDENTIFY the target — strongest signal first; never guess between two.
  const byName = recipientName ? open.filter((r) => nameSimilar(r.payeeAcctName, recipientName)) : [];
  const byAcct = recipientAcct ? open.filter((r) => acctSeen(recipientAcct, r.payeeAcctNo, r.payeePromptpay)) : [];
  const byAmount = open.filter((r) => Math.abs(slipAmount - remainingOf(r)) <= 0.01);
  let target: OpenReq | undefined;
  if (byName.length === 1) target = byName[0];
  else if (byAcct.length === 1) target = byAcct[0];
  else if (byAmount.length === 1) target = byAmount[0];
  else if (open.length === 1) target = open[0];
  if (!target) return { matched: false, reason: open.length > 1 ? "ambiguous" : "no_request" };

  const remaining = remainingOf(target);
  const diff = round2(slipAmount - remaining);
  const detail: SlipMismatchDetail = {
    vendor: target.vendor,
    expected: remaining,
    slipAmount,
    diff,
    payeeName: target.payeeAcctName,
    payeeAcct: target.payeeAcctNo ?? target.payeePromptpay,
    slipRecipientName: recipientName ?? null,
    slipRecipientAcct: recipientAcct ?? null,
  };

  // 2a. VERIFY amount — exact to the baht (only satang slack). Off → don't close.
  if (Math.abs(diff) > 0.01) return { matched: false, reason: "amount_mismatch", detail };

  // 2b. VERIFY payee — only when the slip actually gave readable recipient info AND it
  //     matches NEITHER the payee name NOR the payee account (lenient: masked + fuzzy).
  const haveRecipientInfo = !!(recipientName || longestDigitRun(recipientAcct).length >= 3);
  if (haveRecipientInfo) {
    const nameOk = recipientName ? nameSimilar(target.payeeAcctName, recipientName) : false;
    const acctOk = recipientAcct ? acctSeen(recipientAcct, target.payeeAcctNo, target.payeePromptpay) : false;
    if (!nameOk && !acctOk) return { matched: false, reason: "payee_mismatch", detail };
  }

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
      // P0 (bug-hunt A) — CLOSE FIRST with a CONDITIONAL updateMany gated on state.
      // updateMany row-locks the request row: two concurrent same-amount slips both
      // pass the findFirst re-read, but the 2nd's updateMany blocks on the lock, then
      // re-evaluates state→already 'paid'→count 0→throw→whole tx (incl. its payment
      // row) rolls back. Prevents the silent double-pay. Scoped by org+company (B-018).
      const closed = await tx.ledgerPaymentRequest.updateMany({
        where: { id: req.id, orgId, companyId, state: { in: ["open", "partial"] } },
        data: {
          state: "paid",
          paidTotal: newPaid,
          paidAt: new Date(),
          paidBy: input.paidByLineUserId ?? null,
        },
      });
      if (closed.count !== 1) throw Object.assign(new Error("RACE"), { code: "REQ_GONE" });
      if (billIds.length > 0) {
        await tx.ledgerExpense.updateMany({
          // status:not void → never flip a voided bill to paid (defense-in-depth).
          where: { id: { in: billIds }, orgId, companyId, status: { not: "void" } },
          data: { paymentStatus: "paid" },
        });
      }
      await tx.ledgerPaymentRequestBill.updateMany({
        where: { requestId: req.id, orgId, companyId },
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

  try {
    await prisma.$transaction(async (tx) => {
      // P1 (bug-hunt F) — CONDITIONAL cancel gated on state (row-lock). If a racing
      // slip closed the request to 'paid' between the pre-check and here, count 0 →
      // throw → abort (don't release a bill that was actually just paid).
      const cancelled = await tx.ledgerPaymentRequest.updateMany({
        where: { id: requestId, orgId, companyId, state: { in: ["open", "partial", "abnormal"] } },
        data: { state: "cancelled", cancelledBy, cancelledAt: new Date() },
      });
      if (cancelled.count !== 1) throw Object.assign(new Error("GONE"), { code: "REQ_GONE" });
      const billRows = await tx.ledgerPaymentRequestBill.findMany({
        where: { requestId, active: true },
        select: { expenseId: true },
      });
      await tx.ledgerPaymentRequestBill.updateMany({
        where: { requestId, orgId, companyId },
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
  } catch (e) {
    if (errCode(e) === "REQ_GONE")
      return { ok: false, error: "คำขอถูกปิด/จ่ายไปแล้ว ยกเลิกไม่ได้" };
    console.error("[ledger:cancelPaymentRequest] failed", e);
    return { ok: false, error: "ยกเลิกคำขอไม่สำเร็จ" };
  }
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
      const expected = round2(Number(req.expectedTransfer));
      const newPaid = round2(Number(req.paidTotal) + Number(payment.amount));
      const fullyPaid = newPaid >= expected - 0.01;
      // P2 (bug-hunt) — manual assign lacked the over-pay guard the auto path has.
      const overpay = newPaid > expected + MATCH_TOLERANCE_BAHT;

      // P1 (bug-hunt D) — CLAIM the slip atomically (row-lock): two accountants
      // assigning the SAME floating slip concurrently → only the 1st claim wins
      // (paymentRequestId:null in the where); the 2nd gets count 0 → throw → abort,
      // so paidTotal isn't double-counted.
      const claimed = await tx.ledgerPayment.updateMany({
        where: { id: paymentId, orgId, companyId, paymentRequestId: null, matchedExpenseId: null },
        data: { paymentRequestId: req.id, markedBy },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("TAKEN"), { code: "SLIP_TAKEN" });

      if (overpay) {
        // Slip far exceeds the expected net (wrong pair / batched transfer) → flag,
        // don't auto-close the bills; the accountant resolves the abnormal.
        await tx.ledgerPaymentRequest.updateMany({
          where: { id: req.id, orgId, companyId, state: { in: ["open", "partial", "abnormal"] } },
          data: { state: "abnormal", paidTotal: newPaid, abnormalReason: "สลิปเกินยอดที่คาด" },
        });
      } else if (fullyPaid) {
        const billRows = await tx.ledgerPaymentRequestBill.findMany({
          where: { requestId: req.id, active: true },
          select: { expenseId: true },
        });
        const closed = await tx.ledgerPaymentRequest.updateMany({
          where: { id: req.id, orgId, companyId, state: { in: ["open", "partial", "abnormal"] } },
          data: { state: "paid", paidTotal: newPaid, paidAt: new Date() },
        });
        if (closed.count !== 1) throw Object.assign(new Error("RACE"), { code: "REQ_GONE" });
        const ids = billRows.map((b) => b.expenseId);
        if (ids.length > 0) {
          await tx.ledgerExpense.updateMany({
            where: { id: { in: ids }, orgId, companyId, status: { not: "void" } },
            data: { paymentStatus: "paid" },
          });
        }
        await tx.ledgerPaymentRequestBill.updateMany({
          where: { requestId: req.id, orgId, companyId },
          data: { active: false },
        });
      } else {
        await tx.ledgerPaymentRequest.updateMany({
          where: { id: req.id, orgId, companyId, state: { in: ["open", "partial"] } },
          data: { state: "partial", paidTotal: newPaid },
        });
      }
    });
    return { ok: true };
  } catch (e) {
    if (errCode(e) === "SLIP_TAKEN") return { ok: false, error: "สลิปนี้ถูกจับคู่ไปแล้ว" };
    if (errCode(e) === "REQ_GONE") return { ok: false, error: "คำขอนี้ปิดไปแล้ว" };
    console.error("[ledger:assignSlipToRequest] failed", e);
    return { ok: false, error: "จับคู่สลิปกับคำขอไม่สำเร็จ" };
  }
}
