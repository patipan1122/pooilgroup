// LedgerLine — deterministic duplicate-payment checks (pure DB, no AI, ~0 token).
//
// P1#25 — DEDUP INDEX COMPANY: dedup checks now include companyId. One org can have
// multiple legal entities (e.g. Pooil Group + JP Sync share an org_id). The same bank
// transRef could theoretically appear in both companies independently (different vendors,
// different invoices). The DB unique index mirrors this: (org_id, company_id, sending_bank,
// trans_ref). Scope = org+company, not org-only.
//
// P0#6 — createPaymentDeduped: สร้าง ledger_payment พร้อม early-return dedup
// P1#3 — matchPaymentToExpense: atomic find+lock+update ป้องกัน 2 สลิปแย่งบิลเดียวกัน
import { prisma } from "@/lib/prisma";
import { findRecentAmountDuplicate } from "./dedup";

export type SlipDupKind = "trans_ref" | "slip_image" | "none";

export interface SlipDupResult {
  kind: SlipDupKind;
  /** trans_ref → BLOCK mark-paid until the user explicitly overrides (real 2nd transfer
   *  is rare + intentional). slip_image → silent block (the same photo resent). */
  blocking: boolean;
  existingPaymentId?: string;
  existingExpenseId?: string | null;
}

/** Hard dedup: same bank-transfer ref, or the exact same slip image. */
export async function checkSlipDuplicate(opts: {
  orgId: string;
  /** P1#25 — companyId added to scope dedup per legal entity, not just per org. */
  companyId: string;
  sendingBank: string | null;
  transRef: string | null;
  slipSha256: string | null;
}): Promise<SlipDupResult> {
  const { orgId, companyId, sendingBank, transRef, slipSha256 } = opts;

  // 1) same transfer (bank + ref) → BLOCK. Exact key, no time window, no false
  //    positives (monthly same-amount bills carry DIFFERENT refs).
  //    P1#25: companyId scopes the check per legal entity (one org = multiple companies).
  if (transRef && sendingBank) {
    const dup = await prisma.ledgerPayment.findFirst({
      where: { orgId, companyId, sendingBank, transRef },
      select: { id: true, matchedExpenseId: true },
    });
    if (dup) {
      return {
        kind: "trans_ref",
        blocking: true,
        existingPaymentId: dup.id,
        existingExpenseId: dup.matchedExpenseId,
      };
    }
  }

  // 2) same image resent → silent block (scope by company too — same slip image across
  //    two legal entities in one org must not cross-block / leak the other's payment id).
  if (slipSha256) {
    const dup = await prisma.ledgerPayment.findFirst({
      where: { orgId, companyId, slipSha256 },
      select: { id: true, matchedExpenseId: true },
    });
    if (dup) {
      return {
        kind: "slip_image",
        blocking: true,
        existingPaymentId: dup.id,
        existingExpenseId: dup.matchedExpenseId,
      };
    }
  }

  return { kind: "none", blocking: false };
}

/**
 * Soft heads-up only — NEVER blocks. A recent non-void expense with the SAME amount
 * in the same company (reuses lib/ledger/dedup.ts). Because real duplicate transfers
 * are caught precisely by the trans_ref key above, this is just a nudge for the human
 * to eyeball; recurring same-amount bills (rent/utilities) legitimately repeat.
 */
export async function checkFuzzyPaymentWarning(opts: {
  orgId: string;
  companyId: string;
  amount: number | null;
}): Promise<{ warn: boolean; existingId?: string; existingDocCode?: string }> {
  const dup = await findRecentAmountDuplicate(opts.orgId, opts.companyId, opts.amount);
  if (!dup) return { warn: false };
  return { warn: true, existingId: dup.id, existingDocCode: dup.docCode };
}

export interface CreatePaymentInput {
  orgId: string;
  companyId: string;
  sendingBank: string | null;
  transRef: string | null;
  slipSha256: string | null;
  amount: number;
  slipUrl?: string | null;
  matchedExpenseId?: string | null;
  createdBy?: string | null;
}

export interface CreatePaymentResult {
  ok: boolean;
  payment?: { id: string; matchedExpenseId: string | null };
  already?: boolean; // true = dedup hit, returning existing record
  error?: string;
}

/**
 * P0#6 — PAYMENT DEDUP: สร้าง ledger_payment พร้อม early-return dedup
 * ถ้ามี payment ที่มี (orgId, companyId, transRef) เดียวกันอยู่แล้ว → คืน existing แทนสร้างใหม่
 * ป้องกัน LINE webhook retry / double-tap ทำให้จ่ายซ้ำ
 */
export async function createPaymentDeduped(
  input: CreatePaymentInput,
): Promise<CreatePaymentResult> {
  // Early-return dedup: ตรวจก่อน INSERT (schema field = transRef, @map "trans_ref")
  // P1#25 — companyId added so dedup is scoped per legal entity, not org-wide.
  if (input.transRef) {
    const existing = await prisma.ledgerPayment.findFirst({
      where: { orgId: input.orgId, companyId: input.companyId, transRef: input.transRef },
      select: { id: true, matchedExpenseId: true },
    });
    if (existing) {
      return { ok: true, payment: { id: existing.id, matchedExpenseId: existing.matchedExpenseId }, already: true };
    }
  }
  if (input.slipSha256) {
    const existing = await prisma.ledgerPayment.findFirst({
      where: { orgId: input.orgId, companyId: input.companyId, slipSha256: input.slipSha256 },
      select: { id: true, matchedExpenseId: true },
    });
    if (existing) {
      return { ok: true, payment: { id: existing.id, matchedExpenseId: existing.matchedExpenseId }, already: true };
    }
  }

  try {
    const payment = await prisma.ledgerPayment.create({
      data: {
        orgId: input.orgId,
        companyId: input.companyId,
        sendingBank: input.sendingBank,
        transRef: input.transRef,      // schema: transRef (@map "trans_ref")
        slipSha256: input.slipSha256,
        amount: input.amount,
        slipUrl: input.slipUrl ?? null,
        matchedExpenseId: input.matchedExpenseId ?? null,
        // NOTE: LedgerPayment schema ไม่มีคอลัมน์ createdBy — ถ้าต้องการ audit trail เพิ่ม migration
        // ปัจจุบัน markedBy ใช้สำหรับ "ใครกดยืนยันการจ่าย" (ไม่ใช่ผู้สร้าง payment record)
      },
      select: { id: true, matchedExpenseId: true },
    });
    return { ok: true, payment: { id: payment.id, matchedExpenseId: payment.matchedExpenseId }, already: false };
  } catch (err) {
    // Concurrent duplicate: two slips with the same transRef raced past the findFirst above.
    // Re-read the winner and return as dedup rather than surfacing an error.
    const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
    if (code === "P2002" && input.transRef) {
      const existing = await prisma.ledgerPayment.findFirst({
        where: { orgId: input.orgId, companyId: input.companyId, transRef: input.transRef },
        select: { id: true, matchedExpenseId: true },
      });
      if (existing) {
        return { ok: true, payment: { id: existing.id, matchedExpenseId: existing.matchedExpenseId }, already: true };
      }
    }
    return { ok: false, error: "บันทึกการชำระไม่สำเร็จ" };
  }
}

export interface MatchPaymentResult {
  ok: boolean;
  matched?: boolean; // false = no unpaid expense found for this amount/id
  error?: string;
}

/**
 * P1#3 — ATOMIC MATCH: find unpaid expense + mark paid ใน transaction เดียว
 * ป้องกัน race condition ที่ 2 สลิปแย่งบิลเดียวกัน (เช่น สลิปซ้ำ + สลิปจริง)
 * ถ้า expenseId ระบุมา → lock row นั้นตรง ๆ; ถ้าไม่ระบุ → match by amount (best-effort)
 */
export async function matchPaymentToExpense(opts: {
  orgId: string;
  companyId: string;
  paymentId: string;
  amount: number;
  expenseId?: string | null;
}): Promise<MatchPaymentResult> {
  try {
    const matched = await prisma.$transaction(async (tx) => {
      // 1) Find the matching unpaid expense and lock it FOR UPDATE (serializable read).
      //    Prisma does not expose SELECT FOR UPDATE directly; we use findFirst inside a
      //    transaction which serialises with other writes on the same row via Postgres
      //    default READ COMMITTED + the subsequent updateMany which atomically checks status.
      const expense = opts.expenseId
        ? await tx.ledgerExpense.findFirst({
            where: { id: opts.expenseId, orgId: opts.orgId, companyId: opts.companyId, paymentStatus: "unpaid" },
            select: { id: true },
          })
        : await tx.ledgerExpense.findFirst({
            where: { orgId: opts.orgId, companyId: opts.companyId, paymentStatus: "unpaid", total: opts.amount },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });

      if (!expense) return false;

      // 2) Atomically mark paid — the WHERE paymentStatus='unpaid' is the concurrency guard:
      //    if a concurrent transaction already flipped it, count=0 and we abort.
      const update = await tx.ledgerExpense.updateMany({
        where: { id: expense.id, orgId: opts.orgId, paymentStatus: "unpaid" },
        data: { paymentStatus: "paid" },
      });
      if (update.count !== 1) return false; // another slip won the race

      // 3) Link the payment record to the now-paid expense (scope org+company).
      await tx.ledgerPayment.update({
        where: { id: opts.paymentId, orgId: opts.orgId, companyId: opts.companyId },
        data: { matchedExpenseId: expense.id },
      });

      return true;
    });

    return { ok: true, matched };
  } catch (err) {
    console.error("[ledger:matchPaymentToExpense] failed", err);
    return { ok: false, error: "จับคู่การชำระไม่สำเร็จ" };
  }
}
