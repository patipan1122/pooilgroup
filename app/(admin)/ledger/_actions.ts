"use server";

// Ledger UI server actions — Partition C local fallback.
//
// NOTE[ledger-partition-B]: The canonical mutation layer lives at
// `lib/ledger/actions.ts` (Partition B). These local actions keep the UI's
// existing call signatures (confirmExpense(id, raw), voidExpense(id), …) but are
// HARDENED to the same security bar as Partition B. Every exported action below
// now enforces:
//   1. NEVER auto-post — confirm is an explicit human action; recheck must pass.
//   2. Multi-tenant — every read/write is scoped by org_id + company_id.
//   3. Module entitlement — non-admin callers must hold the `ledger` grant
//      (server actions are directly-invokable POST endpoints, so the layout's
//      assertModuleEnabled does NOT protect them — each action re-checks).
//   4. Role gates — confirm/void/export are accountant-tier; category/budget
//      writes are admin-tier — matching the settings page + nav role policy.
//   5. Audit — confirm/void/export write a LEDGER_* audit row (the financial
//      "post" event must leave a trail for the auditor / TRCloud reconciliation).

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { archiveExpenseToDrive } from "@/lib/ledger/drive";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { liffIdForModule } from "@/lib/line/channels";
import { requireSession, type DbUser } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { recheckReceipt, gradeCompleteness } from "@/lib/ledger/recheck";
import { OUR_BUYER } from "@/lib/ledger/group-identity";
import { setPermission, isLedgerRole, isLedgerCapability } from "@/lib/ledger/permissions";
import { listExpenses } from "@/lib/ledger/queries";
import { recordSlipPayment } from "@/lib/ledger/payments";
import { ledgerPayreqV1 } from "@/lib/ledger/flags";
import {
  createPaymentRequest,
  cancelPaymentRequest,
  assignSlipToRequest,
} from "@/lib/ledger/payment-request";
import { buildPaymentRequestCard } from "@/lib/ledger/payment-request-card";
import { pushFlexToSlipGroup, pushTextToSlipGroup } from "@/lib/ledger/line-push";
import { parseReceipt } from "@/lib/ledger/ai-parse";
import { storeReceiptImage } from "@/lib/ledger/storage";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import type { InputVatBlockReason } from "@/lib/ledger/types";
import { buildTrcloudCsv } from "@/lib/ledger/trcloud-export";
import { createDraftExpense } from "@/lib/ledger/actions";
import {
  pushExpenseToTrcloud,
  deleteTrcloudAp,
  trcloudPushConfigured,
  type PushableExpense,
} from "@/lib/ledger/trcloud-push";
import { resolveLedgerActor, actorCanReachBranch, ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { searchPurchases } from "@/lib/ledger/spend-analytics";
import { audit } from "@/lib/audit/log";
import { encryptToken, decryptToken } from "@/lib/recruit/channel-crypto";
import {
  expenseConfirmability,
  confirmabilityMessage,
} from "@/lib/ledger/confirmability";

export type ActionResult = { ok: boolean; error?: string };

// ── Auth helpers (shared gate stack for every action) ───────────────────────

/**
 * Resolve the session AND enforce module entitlement. Returns the session when
 * allowed, or an ActionResult error to bubble straight back to the client.
 * Admin tier bypasses the per-user grant (support/debug), everyone else needs
 * an active `ledger` row in user_modules — same rule as the page layout.
 */
async function requireLedgerAccess(): Promise<
  { ok: true; session: Awaited<ReturnType<typeof requireSession>> } | { ok: false; error: string }
> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!isAdminTier(session.user.role)) {
    const has = await userHasModuleAccess(session.user, "ledger");
    if (!has) return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
  }
  return { ok: true, session };
}

// ---- shared expense patch shape (mirrors ExpenseDraft in ExpenseReviewPane) ----
const itemSchema = z.object({
  description: z.string().trim().max(300),
  qty: z.coerce.number(),
  unitPrice: z.coerce.number(),
  amount: z.coerce.number(),
  vatRate: z.coerce.number().nullable().optional(),
});
const patchSchema = z.object({
  vendor: z.string().trim().max(200),
  vendorTaxId: z.string().trim().max(20),
  docDate: z.string().trim().max(10),
  categoryId: z.string().trim().max(40),
  branchId: z.string().trim().max(40),
  paymentMethod: z.string().trim().max(40),
  subtotal: z.coerce.number().min(0),
  vat: z.coerce.number().min(0),
  wht: z.coerce.number().min(0),
  total: z.coerce.number().min(0),
  note: z.string().trim().max(1000),
  // — Bainy-parity fields (optional so older callers still validate) —
  // MUST mirror ExpenseDocType in lib/ledger/types.ts — "quotation" was added for
  // D1 (ใบเสนอราคา) and the OCR classifies into it; omitting it here made every
  // quotation draft fail save/confirm with a generic "ข้อมูลไม่ถูกต้อง".
  docType: z.enum(["tax_invoice", "receipt", "cash_bill", "delivery_note", "quotation", "other"]).optional(),
  vendorDocNumber: z.string().trim().max(60).optional(),
  vendorAddress: z.string().trim().max(300).optional(),
  vendorBranchCode: z.string().trim().max(20).optional(),
  discount: z.coerce.number().min(0).optional(),
  paymentStatus: z.enum(["paid", "unpaid", "partial"]).optional(),
  claimantName: z.string().trim().max(120).optional(),
  bankDetail: z.string().trim().max(120).optional(),
  isRecurring: z.boolean().optional(),
  // NOTE: input-VAT claimability (inputVatClaimable / inputVatBlockReason) is
  // DELIBERATELY NOT in this edit schema. การตัดสิน "ขอคืนได้?" เขียนได้ทางเดียว =
  // overrideClaimability() ที่ gate ด้วย expense.confirm (นักบัญชี/แอดมิน) เท่านั้น.
  // ถ้ารับผ่าน save/LIFF จะเป็นช่องให้ staff ยัดค่า + ทับ override นักบัญชีเงียบ ๆ.
  items: z.array(itemSchema).max(100).optional(),
});
export type ExpensePatch = z.infer<typeof patchSchema>;

/** Thai field labels for patchSchema keys — so a validation error names the field. */
const FIELD_LABEL_TH: Record<string, string> = {
  vendor: "ชื่อร้านค้า",
  vendorTaxId: "เลขผู้เสียภาษี",
  docDate: "วันที่เอกสาร",
  categoryId: "หมวด",
  branchId: "สาขา",
  paymentMethod: "วิธีชำระเงิน",
  subtotal: "ยอดก่อน VAT",
  vat: "VAT",
  wht: "หัก ณ ที่จ่าย",
  total: "ยอดรวม",
  note: "หมายเหตุ",
  docType: "ประเภทเอกสาร",
  vendorDocNumber: "เลขที่เอกสาร",
  vendorAddress: "ที่อยู่ผู้ขาย",
  vendorBranchCode: "รหัสสาขาผู้ขาย",
  discount: "ส่วนลด",
  paymentStatus: "สถานะการชำระเงิน",
  claimantName: "ผู้จ่าย/เบิก",
  bankDetail: "ธนาคาร/รายละเอียด",
  items: "รายการสินค้า",
};

/**
 * Turn a Zod failure into a Thai message that NAMES the offending field, instead
 * of a blanket "ข้อมูลไม่ถูกต้อง" the user can't act on. CEO 2026-06-07: "บอกด้วยสิ
 * ว่าอะไรไม่ถูกต้อง". Logs the raw issue for engineers.
 */
function zodErrorMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "ข้อมูลไม่ถูกต้อง";
  const key = issue.path[0];
  const label = typeof key === "string" ? FIELD_LABEL_TH[key] ?? key : "ข้อมูล";
  console.warn("[ledger:validation]", JSON.stringify(err.issues.slice(0, 5)));
  return `ช่อง "${label}" ไม่ถูกต้อง — ${issue.message}`;
}

function toData(p: ExpensePatch) {
  return {
    vendor: p.vendor || null,
    vendorTaxId: p.vendorTaxId || null,
    docDate: p.docDate ? new Date(p.docDate) : null,
    categoryId: p.categoryId || null,
    branchId: p.branchId || null,
    paymentMethod: p.paymentMethod || null,
    subtotal: p.subtotal,
    vat: p.vat,
    wht: p.wht,
    total: p.total,
    note: p.note || null,
    docType: p.docType ?? undefined,
    vendorDocNumber: p.vendorDocNumber === undefined ? undefined : p.vendorDocNumber || null,
    vendorAddress: p.vendorAddress === undefined ? undefined : p.vendorAddress || null,
    vendorBranchCode: p.vendorBranchCode === undefined ? undefined : p.vendorBranchCode || null,
    discount: p.discount ?? undefined,
    paymentStatus: p.paymentStatus ?? undefined,
    claimantName: p.claimantName === undefined ? undefined : p.claimantName || null,
    bankDetail: p.bankDetail === undefined ? undefined : p.bankDetail || null,
    isRecurring: p.isRecurring ?? undefined,
    // ภาษีซื้อ (inputVatClaimable / inputVatBlockReason) ไม่อยู่ที่นี่โดยตั้งใจ —
    // เขียนได้ทางเดียวผ่าน overrideClaimability() เท่านั้น (ดู patchSchema).
  };
}

/**
 * Re-grade an expense's input-VAT completeness from the patched values + the
 * row's OCR-derived buyer tax id (which the patch never carries). Returns the
 * columns to persist so save/confirm keep the สถานะสี in sync with edits.
 * The buyer SNAPSHOT is always re-stamped from master (เจพีซิ้งค์ OUR_BUYER).
 */
function gradeColumnsFromPatch(
  p: ExpensePatch,
  row: { buyerTaxIdOnDoc: string | null; vendorAddress: string | null; vendorBranchCode: string | null },
) {
  const grade = gradeCompleteness({
    docType: p.docType ?? "tax_invoice",
    vendor: p.vendor || null,
    vendorTaxId: p.vendorTaxId || null,
    vendorAddress: p.vendorAddress === undefined ? row.vendorAddress : p.vendorAddress || null,
    vendorBranchCode: p.vendorBranchCode === undefined ? row.vendorBranchCode : p.vendorBranchCode || null,
    subtotal: p.subtotal,
    vat: p.vat,
    total: p.total,
    buyerTaxIdOnDoc: row.buyerTaxIdOnDoc,
  });
  return {
    buyerTaxIdSnapshot: OUR_BUYER.taxId,
    buyerNameSnapshot: OUR_BUYER.name,
    buyerMatchStatus: grade.buyerMatch,
    completenessStatus: grade.status,
    completenessMissing: grade.missing as unknown as Prisma.InputJsonValue,
    completenessCheckedAt: new Date(),
    // re-grade อัปเดตเฉพาะ "สถานะสี" (derived) — ไม่แตะ inputVatClaimable/BlockReason
    // (การตัดสินของนักบัญชีผ่าน overrideClaimability) มิฉะนั้นการแก้ field อื่นจะรีเซ็ต
    // override เงียบ ๆ → ใบที่ block ไว้กลับมาขอคืนได้ (false-accept).
    grade,
  };
}

/** Replace an expense's line items (delete-all + recreate) inside a tx, scoped. */
async function replaceItems(
  tx: Prisma.TransactionClient,
  args: { expenseId: string; orgId: string; companyId: string; items: ExpensePatch["items"] },
) {
  if (args.items === undefined) return; // omitted → keep existing
  await tx.ledgerExpenseItem.deleteMany({ where: { expenseId: args.expenseId } });
  if (args.items.length > 0) {
    await tx.ledgerExpenseItem.createMany({
      data: args.items.map((it) => ({
        orgId: args.orgId,
        companyId: args.companyId,
        expenseId: args.expenseId,
        description: it.description,
        qty: it.qty,
        unitPrice: it.unitPrice,
        amount: it.amount,
        vatRate: it.vatRate ?? null,
      })),
    });
  }
}

/** Load the expense and assert it belongs to the caller's org+company.
 *  Caller has already passed requireLedgerAccess so `session` is authorized. */
async function loadScoped(
  session: Awaited<ReturnType<typeof requireSession>>,
  id: string,
) {
  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId: session.user.org_id },
    select: {
      id: true,
      companyId: true,
      status: true,
      // — แก้ไขได้จนกว่าจะ "ส่งเข้า TRCloud" (CEO: ยืนยันแล้วยังแก้ได้ · ล็อกเมื่อ push แล้ว) —
      trcloudPushedAt: true,
      // — supersede: ใบนี้มาแทนใบไหน (ใช้ void ใบเสนอราคาเดิมตอน confirm) —
      replacementOfId: true,
      // — for re-grading input-VAT completeness on save/confirm —
      buyerTaxIdOnDoc: true,
      vendorAddress: true,
      vendorBranchCode: true,
      // — P1#21: ownership check in saveExpense —
      createdBy: true,
    },
  });
  return { row };
}

/** P0 (bug-hunt C) — a bill sitting in an ACTIVE "ขอโอนเงิน" request must not be
 *  voided/deleted: it would leave the request's per-bill lock dangling AND the
 *  incoming slip would still flip the voided bill to paid. Cancel the request first. */
async function billInActiveRequest(
  orgId: string,
  companyId: string,
  expenseId: string,
): Promise<boolean> {
  const r = await prisma.ledgerPaymentRequestBill
    .findFirst({
      where: { expenseId, orgId, companyId, active: true },
      select: { id: true },
    })
    .catch(() => null);
  return r != null;
}
const IN_ACTIVE_REQUEST_MSG = "บิลนี้มีคำขอโอนค้างอยู่ — ยกเลิกคำขอโอนก่อนจึงจะลบ/ยกเลิกได้";

/** Save edits to a draft (stays draft). Any ledger member may edit a draft. */
export async function saveExpense(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodErrorMessage(parsed.error) };
  const { row } = await loadScoped(session, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก แก้ไม่ได้" };
  // CEO rule (2026-06-07): a CONFIRMED bill stays editable; it only locks AFTER it's
  // been pushed to TRCloud (the book of record) — editing past that would desync the
  // two systems. To change it, delete the AP in TRCloud first (re-opens editing).
  if (row.trcloudPushedAt)
    return { ok: false, error: "ส่งเข้า TRCloud แล้ว แก้ไขไม่ได้ — ถ้าต้องแก้ ให้ลบใบใน TRCloud ก่อน" };
  // P1 (bug-hunt E) — a bill inside an ACTIVE "ขอโอนเงิน" request must not be edited:
  // the request froze billsGross/expectedTransfer, so changing total here would make
  // the incoming slip pay a stale amount (evidence ≠ ledger). Cancel the request first.
  {
    const inActiveReq = await prisma.ledgerPaymentRequestBill.findFirst({
      where: { expenseId: id, orgId: session.user.org_id, companyId: row.companyId, active: true },
      select: { id: true },
    });
    if (inActiveReq)
      return { ok: false, error: "บิลนี้มีคำขอโอนค้างอยู่ — ยกเลิกคำขอก่อนจึงจะแก้ได้" };
  }

  // P1#21 ROLE CHECK — only the creator OR an admin/accountant may edit a draft.
  // Staff who didn't create the record cannot silently overwrite another user's entry.
  const canEditOthers =
    isAdminTier(session.user.role) ||
    (await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.confirm"));
  if (row.createdBy !== session.user.id && !canEditOthers) {
    return { ok: false, error: "ไม่มีสิทธิ์แก้ไขรายการของผู้อื่น" };
  }

  // Re-grade input-VAT completeness from the edited values (สถานะสีต้องตามการแก้ไข).
  const { grade: _g, ...gradeCols } = gradeColumnsFromPatch(parsed.data, row);
  void _g;
  await prisma.$transaction(async (tx) => {
    await tx.ledgerExpense.updateMany({
      // Scope by company too so an edit can't cross a company boundary in-org.
      where: { id, orgId: session.user.org_id, companyId: row.companyId },
      // gradeCols = derived สถานะสี (re-graded); toData = the edited fields. NEITHER
      // writes inputVatClaimable/BlockReason — that decision is owned solely by the
      // accountant-gated overrideClaimability(), so an edit never reopens a blocked claim.
      data: { ...gradeCols, ...toData(parsed.data), needsReview: true },
    });
    await replaceItems(tx, {
      expenseId: id,
      orgId: session.user.org_id,
      companyId: row.companyId,
      items: parsed.data.items,
    });
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_UPDATED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { new: { vendor: parsed.data.vendor, total: parsed.data.total, categoryId: parsed.data.categoryId } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Confirm a draft → status=confirmed. Accountant-tier only. Recheck must pass. */
export async function confirmExpense(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  // Confirm = the financial "post" event → governed by the expense.confirm
  // capability (admin tier always passes; accountant per the สิทธิ์ matrix).
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยืนยันได้" };
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodErrorMessage(parsed.error) };
  const p = parsed.data;

  // Golden rule: recheck math BEFORE allowing a human confirm.
  const rc = recheckReceipt({
    vendorTaxId: p.vendorTaxId || null,
    subtotal: p.subtotal,
    discount: p.discount,
    vat: p.vat,
    wht: p.wht,
    total: p.total,
    items: (p.items ?? []).map((it) => ({
      description: it.description,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
      vatRate: it.vatRate ?? null,
    })),
  });
  // Only the additive total-identity mismatch blocks confirm; soft warnings
  // (tax id / vat% / wht%) are advisory. Use the STRUCTURED flag, never a Thai
  // substring match (which would silently stop blocking if wording changed).
  if (rc.blockingMathError) {
    const detail = rc.warnings.find((w) => w.includes("ยอดรวม")) ?? "ยอดย่อย + VAT − หัก ณ ที่จ่าย ไม่เท่ายอดรวม";
    return { ok: false, error: `ยอดไม่ตรง: ${detail}` };
  }

  const { row } = await loadScoped(session, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก ยืนยันไม่ได้" };

  // D1 CONFIRM-GATE — check the FINAL value that WILL be persisted (toData coerces
  // ''→null), not the stale DB row: a confirm patch can blank branch/category in
  // the same call. Both must be present or the post is refused (Thai message names
  // the missing field). Kept separate from VAT completeness on purpose.
  const merged = toData(p);
  const gate = expenseConfirmability({
    branchId: merged.branchId,
    categoryId: merged.categoryId,
  });
  if (!gate.ok) return { ok: false, error: confirmabilityMessage(gate.missing) };

  // Re-grade input-VAT completeness from the confirmed values too (both paths must
  // grade — else the snapshot the accountant just confirmed keeps a stale color).
  const { grade: _gc, ...gradeColsC } = gradeColumnsFromPatch(p, row);
  void _gc;
  let supersededQuotationId: string | null = null;
  // P2#1 OPTIMISTIC LOCK — only update if status is still 'draft' at commit time.
  // Two concurrent confirm requests both pass the pre-check above, but only one
  // should win. The WHERE status='draft' condition makes the second a no-op (0 rows),
  // which we treat as "already confirmed" to prevent double-posting.
  let confirmedCount = 0;
  await prisma.$transaction(async (tx) => {
    const res = await tx.ledgerExpense.updateMany({
      where: { id, orgId: session.user.org_id, companyId: row.companyId, status: "draft" },
      data: {
        ...gradeColsC,
        ...toData(p),
        status: "confirmed",
        needsReview: false,
        confirmedBy: session.user.id,
        confirmedAt: new Date(),
      },
    });
    confirmedCount = res.count;
    await replaceItems(tx, {
      expenseId: id,
      orgId: session.user.org_id,
      companyId: row.companyId,
      items: p.items,
    });
    // กันนับซ้ำ (D1 · supersede): ถ้าใบที่เพิ่งยืนยันคือ "ใบกำกับจริง" ที่มาแทน
    // ใบเสนอราคา → void ใบเสนอราคาเดิมในธุรกรรมเดียวกัน เพื่อให้มีเพียงใบเดียวที่ถูก
    // นับใน totals เสมอ (ไม่มีช่องว่างที่หายทั้งคู่). gate ที่ docType=quotation
    // เท่านั้น → ใบทดแทน ม.86/4 ปกติไม่ถูกแตะ (no-op ถ้าใบเดิมไม่ใช่ใบเสนอราคา).
    if (row.replacementOfId) {
      const res = await tx.ledgerExpense.updateMany({
        where: {
          id: row.replacementOfId,
          orgId: session.user.org_id,
          companyId: row.companyId,
          docType: "quotation",
          status: { not: "void" },
        },
        data: { status: "void", needsReview: false },
      });
      if (res.count > 0) supersededQuotationId = row.replacementOfId;
    }
  });
  // P2#1 OPTIMISTIC LOCK result check — 0 rows means another request already
  // confirmed this expense while we were running our checks; treat as idempotent.
  if (confirmedCount === 0) {
    return { ok: false, error: "รายการถูกยืนยันไปแล้ว" };
  }
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_CONFIRMED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { old: { status: row.status }, new: { status: "confirmed", total: p.total } },
  });
  if (supersededQuotationId) {
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "LEDGER_QUOTATION_SUPERSEDED",
      resourceType: "ledger_expense",
      resourceId: supersededQuotationId,
      diff: { old: { status: "confirmed" }, new: { status: "void", supersededBy: id } },
    });
  }
  // Auto-archive the receipt original into Google Drive (no-op if not connected).
  after(() =>
    archiveExpenseToDrive({ orgId: session.user.org_id, companyId: row.companyId, id }).catch(() => {}),
  );
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true };
}

/** Void an expense (soft delete → status=void). Accountant-tier only. */
export async function voidExpense(id: string): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยกเลิกได้" };
  }

  const { row } = await loadScoped(session, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked")
    return { ok: false, error: "รายการถูกล็อก ยกเลิกไม่ได้" };
  if (await billInActiveRequest(session.user.org_id, row.companyId, id))
    return { ok: false, error: IN_ACTIVE_REQUEST_MSG };

  await prisma.ledgerExpense.updateMany({
    where: { id, orgId: session.user.org_id, companyId: row.companyId },
    data: { status: "void", needsReview: false },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_VOIDED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { old: { status: row.status }, new: { status: "void" } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Bulk-confirm draft rows that already pass recheck (used by the list toolbar).
 *  Accountant-tier only — each row is the financial "post" event.
 *  REQUIRES companyId: the id array is client-supplied, so without a company
 *  filter an accountant viewing Company A could pass draft ids belonging to
 *  Company B in the same org and confirm them (cross-company write). Every other
 *  confirm/void/save path scopes by companyId — this one must too. */
export async function bulkConfirm(
  ids: string[],
  companyId: string,
): Promise<
  ActionResult & {
    confirmed?: number;
    skipped?: number;
    /** typed breakdown of WHY rows were skipped (so the toolbar can explain). */
    skippedReasons?: { math: number; missingBranch: number; missingCategory: number };
  }
> {
  if (!Array.isArray(ids) || ids.length === 0)
    return { ok: false, error: "ไม่ได้เลือกรายการ" };
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยืนยันได้" };
  }

  // Confirm the company belongs to the caller's org before trusting it as a
  // scope filter (mirrors exportConfirmedCsv / upsertBudget company checks).
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  const rows = await prisma.ledgerExpense.findMany({
    // Scope by companyId too — never confirm rows outside the selected company.
    where: { id: { in: ids }, orgId: session.user.org_id, companyId, status: "draft" },
  });

  let confirmed = 0;
  let skipped = 0;
  // D1 CONFIRM-GATE for the blind batch: bulkConfirm has NO patch, so the gate
  // checks each PERSISTED row directly (branchId/categoryId as stored). This path
  // is the most exposed — it blind-confirms up to 50 rows at once — so a missing
  // posting field here MUST skip that row, not slip through. Track WHY per bucket.
  const skippedReasons = { math: 0, missingBranch: 0, missingCategory: 0 };
  const confirmedIds: string[] = [];
  for (const r of rows) {
    // Posting gate first — never confirm a row we can't classify (branch+category).
    const gate = expenseConfirmability({ branchId: r.branchId, categoryId: r.categoryId });
    if (!gate.ok) {
      skipped++;
      if (gate.missing.includes("branch")) skippedReasons.missingBranch++;
      if (gate.missing.includes("category")) skippedReasons.missingCategory++;
      continue;
    }
    const rc = recheckReceipt({
      vendorTaxId: r.vendorTaxId,
      subtotal: Number(r.subtotal),
      vat: Number(r.vat),
      wht: Number(r.wht),
      total: Number(r.total),
      items: [],
    });
    const blocking = rc.warnings.filter(
      (w) => w.includes("ยอดรวม") || w.toLowerCase().includes("total"),
    );
    if (blocking.length > 0) {
      skipped++;
      skippedReasons.math++;
      continue;
    }
    await prisma.ledgerExpense.update({
      where: { id: r.id },
      data: {
        status: "confirmed",
        needsReview: false,
        confirmedBy: session.user.id,
        confirmedAt: new Date(),
      },
    });
    confirmed++;
    confirmedIds.push(r.id);
  }
  if (confirmedIds.length > 0) {
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "LEDGER_EXPENSE_CONFIRMED",
      resourceType: "ledger_expense",
      diff: { new: { bulk: true, count: confirmed, ids: confirmedIds } },
    });
  }
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true, confirmed, skipped, skippedReasons };
}

/** Bulk-void rows from the list toolbar (the "ลบ (N)" button). Accountant-tier
 *  only — voiding removes a row from every total (status=void), so it carries the
 *  same weight as confirm. companyId-scoped for the same cross-company reason as
 *  bulkConfirm (client-supplied ids). Locked rows are skipped, never force-voided.
 *  The UI gates this behind a type-"ลบ" confirmation; the server re-checks the role. */
/** Quick-classify (audit P0) — set สาขา+หมวด on a batch of bills in ONE action so a
 *  backlog of unclassified bills can be classified-then-requested without opening each
 *  one. Validates branch+category belong to org+company; skips locked/void. Bills stay
 *  draft (classifying ≠ confirming). Accountant/admin-tier (same gate as bulkConfirm). */
export async function bulkClassify(
  ids: string[],
  branchId: string,
  categoryId: string,
  companyId: string,
): Promise<ActionResult & { updated?: number }> {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "ไม่ได้เลือกรายการ" };
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  if (!branchId && !categoryId)
    return { ok: false, error: "เลือกสาขาหรือหมวดอย่างน้อยหนึ่งอย่าง" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  const orgId = session.user.org_id;
  if (!(await ledgerWebCanForRole(orgId, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลตั้งสาขา/หมวดได้" };
  }
  const company = await prisma.company.findFirst({ where: { id: companyId, orgId }, select: { id: true } });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };
  // Validate the branch/category belong to this org+company (no cross-company smuggle).
  if (branchId) {
    const b = await prisma.branch.findFirst({ where: { id: branchId, orgId }, select: { id: true } });
    if (!b) return { ok: false, error: "ไม่พบสาขา" };
  }
  if (categoryId) {
    const c = await prisma.ledgerCategory.findFirst({
      where: { id: categoryId, orgId, companyId },
      select: { id: true },
    });
    if (!c) return { ok: false, error: "ไม่พบหมวดในบริษัทนี้" };
  }
  const data: { branchId?: string; categoryId?: string } = {};
  if (branchId) data.branchId = branchId;
  if (categoryId) data.categoryId = categoryId;
  const res = await prisma.ledgerExpense.updateMany({
    where: { id: { in: ids }, orgId, companyId, status: { notIn: ["locked", "void"] } },
    data,
  });
  await audit({
    orgId, userId: session.user.id,
    action: "LEDGER_EXPENSE_UPDATED",
    resourceType: "ledger_expense",
    diff: { new: { bulkClassify: true, branchId: branchId || null, categoryId: categoryId || null, count: res.count } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true, updated: res.count };
}

export async function bulkVoid(
  ids: string[],
  companyId: string,
): Promise<ActionResult & { voided?: number; skipped?: number }> {
  if (!Array.isArray(ids) || ids.length === 0)
    return { ok: false, error: "ไม่ได้เลือกรายการ" };
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลลบได้" };
  }
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  // Only void rows that are NOT locked (locked = posted/immutable). Scope by
  // org+company so a client-supplied id from another company can't be voided.
  const rows = await prisma.ledgerExpense.findMany({
    where: {
      id: { in: ids },
      orgId: session.user.org_id,
      companyId,
      status: { not: "locked" },
    },
    select: { id: true, status: true },
  });
  if (rows.length === 0) return { ok: false, error: "ไม่มีรายการที่ลบได้ (อาจถูกล็อกแล้ว)" };

  // P0 (bug-hunt C) — exclude bills sitting in an ACTIVE "ขอโอนเงิน" request; voiding
  // them would leave the request's per-bill lock dangling + let the slip pay a void bill.
  const voidableIds = rows.map((r) => r.id);
  const inReq = await prisma.ledgerPaymentRequestBill.findMany({
    where: { expenseId: { in: voidableIds }, orgId: session.user.org_id, companyId, active: true },
    select: { expenseId: true },
  });
  const blocked = new Set(inReq.map((r) => r.expenseId));
  const voidIds = voidableIds.filter((id) => !blocked.has(id));
  if (voidIds.length === 0)
    return {
      ok: false,
      error: blocked.size > 0 ? "บิลที่เลือกมีคำขอโอนค้างอยู่ — ยกเลิกคำขอโอนก่อน" : "ไม่มีรายการที่ลบได้ (อาจถูกล็อกแล้ว)",
    };
  await prisma.ledgerExpense.updateMany({
    where: { id: { in: voidIds }, orgId: session.user.org_id, companyId },
    data: { status: "void", needsReview: false },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_VOIDED",
    resourceType: "ledger_expense",
    diff: { new: { bulk: true, count: voidIds.length, ids: voidIds } },
  });
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true, voided: voidIds.length, skipped: ids.length - voidIds.length };
}

// ===================== Input-VAT claimability (ภาษีซื้อ) =====================
// Two accountant-only flows on top of the deterministic สถานะสี:
//   1. overrideClaimability — the accountant manually decides ขอคืนได้/ไม่ได้ + เหตุผล,
//      stamped with who/when/why (สรรพากร trail). Gated on expense.confirm.
//   2. attachReplacementInvoice — แนบใบกำกับเต็มรูปที่ขอจากร้าน เก็บทั้ง 2 ใบ (self-link),
//      re-parse + re-grade → flip เขียวถ้าผ่าน. The replacement is itself a draft
//      expense (never auto-posted — GOLDEN RULE). Gated on expense.confirm.

const overrideSchema = z.object({
  expenseId: zUUID(),
  claimable: z.boolean(),
  reason: z
    .enum([
      "abbreviated_86_6",
      "buyer_mismatch",
      "wrong_entity",
      "incomplete_invoice",
      "entertainment",
      "passenger_car",
      "other",
    ])
    .optional(),
});

/**
 * Accountant override of the claimable flag (CEO philosophy: "มี VAT ควรขอคืนได้
 * ทั้งหมด — ที่ขอไม่ได้มักเพราะคนออกผิด"). Stores who/when/why so the override is
 * auditable. Gated on expense.confirm. NEVER changes status/total — only the
 * input-VAT decision + its reason.
 */
export async function overrideClaimability(
  raw: unknown,
): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลปรับสิทธิ์ขอคืนภาษีได้" };
  }
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodErrorMessage(parsed.error) };
  const { expenseId, claimable, reason } = parsed.data;

  const { row } = await loadScoped(session, expenseId);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "void") return { ok: false, error: "รายการถูกยกเลิกแล้ว" };

  // เหตุผลจำเป็นเมื่อ "ขอคืนไม่ได้" (กันบันทึกบล็อกโดยไม่ระบุเหตุผล).
  const blockReason: InputVatBlockReason | null = claimable ? null : reason ?? "other";

  await prisma.ledgerExpense.updateMany({
    where: { id: expenseId, orgId: session.user.org_id, companyId: row.companyId },
    data: {
      inputVatClaimable: claimable,
      inputVatBlockReason: blockReason,
      overrideBy: session.user.id,
      overrideAt: new Date(),
      overrideReason: reason ?? (claimable ? "manual_allow" : "manual_block"),
    },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_VAT_OVERRIDDEN",
    resourceType: "ledger_expense",
    resourceId: expenseId,
    diff: { new: { claimable, reason: blockReason } },
  });
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true };
}

const attachReplacementSchema = z
  .object({
    expenseId: zUUID(),
    // either a base64 data-url/raw image OR an already-hosted url.
    imageBase64: z.string().trim().min(1).optional(),
    url: z.string().trim().url().optional(),
  })
  .refine((v) => !!v.imageBase64 || !!v.url, {
    message: "ต้องแนบรูปหรือ URL ของใบทดแทน",
  });

/**
 * แนบใบกำกับเต็มรูปทดแทนใบเหลือง/แดง. เก็บทั้ง 2 ใบ (self-relation):
 *   - upload via storage.ts (ถ้าส่ง base64) → R2
 *   - re-parse via parseReceipt (อ่านผู้ขาย/VAT/เลขผู้ซื้อบนใบใหม่)
 *   - create ใบใหม่ status=draft (GOLDEN RULE — never auto-post) ผูก replacementOfId
 *   - set replacedById บนใบเดิม
 *   - re-grade ใบใหม่ → flip เขียวถ้าผ่าน
 * Gated on expense.confirm. Returns the new draft id.
 */
export async function attachReplacementInvoice(
  raw: unknown,
): Promise<ActionResult & { replacementId?: string; completenessStatus?: string }> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลแนบใบทดแทนได้" };
  }
  const parsed = attachReplacementSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { expenseId, imageBase64, url } = parsed.data;
  const orgId = session.user.org_id;

  // Load the ORIGINAL (the yellow/red row being remediated) — full row for the link.
  const original = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId },
    select: { id: true, companyId: true, branchId: true, status: true, replacedById: true },
  });
  if (!original) return { ok: false, error: "ไม่พบรายการเดิม" };
  if (original.status === "void") return { ok: false, error: "รายการถูกยกเลิกแล้ว" };
  if (original.replacedById) return { ok: false, error: "ใบนี้มีใบทดแทนแล้ว" };

  // 1. Re-parse the replacement image (budget-guarded inside parseReceipt).
  let parsedReceipt;
  try {
    parsedReceipt = await parseReceipt(url ?? imageBase64!, session.user.id, orgId);
  } catch (e) {
    console.error("[ledger:attachReplacementInvoice] parse failed", e);
    return { ok: false, error: "อ่านใบทดแทนไม่สำเร็จ · ลองใหม่หรือถ่ายให้ชัดขึ้น" };
  }

  // 1b. Persist the image to R2 when we were handed raw bytes (a hosted url stays
  //     as-is). Best-effort: a storage hiccup must not block the draft/link.
  let originalUrl: string | null = url ?? null;
  let thumbUrl: string | null = url ?? null;
  let sha256: string | null = null;
  if (imageBase64) {
    try {
      const m = imageBase64.match(/^data:(.+?);base64,([\s\S]*)$/);
      const b64 = m ? m[2] : imageBase64;
      const contentType = m?.[1] ?? "image/jpeg";
      const buffer = Buffer.from(b64, "base64");
      const stored = await storeReceiptImage({
        orgId,
        companySlug: original.companyId,
        expenseId: `${expenseId}-repl`,
        buffer,
        contentType,
      });
      originalUrl = stored.originalUrl;
      thumbUrl = stored.thumbUrl;
      sha256 = stored.sha256;
    } catch (e) {
      console.error("[ledger:attachReplacementInvoice] store failed", e);
    }
  }

  // 2. Grade the replacement (deterministic).
  const grade = gradeCompleteness({
    docType: parsedReceipt.docType ?? "tax_invoice",
    vendor: parsedReceipt.vendor,
    vendorTaxId: parsedReceipt.vendorTaxId,
    vendorAddress: parsedReceipt.vendorAddress ?? null,
    vendorBranchCode: null,
    subtotal: parsedReceipt.subtotal,
    vat: parsedReceipt.vat,
    total: parsedReceipt.total,
    buyerTaxIdOnDoc: parsedReceipt.buyerTaxIdOnDoc,
    rawText: parsedReceipt.raw,
  });

  // 3. Create the replacement as a DRAFT (never auto-post) + link it ↔ original.
  const docCode = `${(await currentDocCodeFallback())}-R`;
  let replacementId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const repl = await tx.ledgerExpense.create({
        data: {
          orgId,
          companyId: original.companyId,
          branchId: original.branchId,
          docCode,
          status: "draft", // GOLDEN RULE — never auto-post
          source: "web",
          vendor: parsedReceipt.vendor ?? null,
          vendorTaxId: parsedReceipt.vendorTaxId ?? null,
          vendorDocNumber: parsedReceipt.vendorDocNumber ?? null,
          vendorAddress: parsedReceipt.vendorAddress ?? null,
          docType: parsedReceipt.docType ?? "tax_invoice",
          docDate: parsedReceipt.docDate ? new Date(parsedReceipt.docDate) : null,
          subtotal: parsedReceipt.subtotal ?? 0,
          discount: parsedReceipt.discount ?? 0,
          vat: parsedReceipt.vat ?? 0,
          wht: parsedReceipt.wht ?? 0,
          total: parsedReceipt.total ?? 0,
          paymentMethod: parsedReceipt.paymentMethod ?? null,
          originalUrl,
          thumbUrl,
          sha256,
          ocrModel: parsedReceipt.ocrModel,
          ocrConfidence: parsedReceipt.confidence as unknown as Prisma.InputJsonValue,
          needsReview: true,
          note: "ใบทดแทน (แนบเพื่อกู้ภาษีซื้อ)",
          createdBy: session.user.id,
          // link: this new row replaces the original
          replacementOfId: original.id,
          // — input-VAT grade of the replacement —
          buyerTaxIdSnapshot: OUR_BUYER.taxId,
          buyerNameSnapshot: OUR_BUYER.name,
          buyerTaxIdOnDoc: parsedReceipt.buyerTaxIdOnDoc,
          buyerMatchStatus: grade.buyerMatch,
          completenessStatus: grade.status,
          completenessMissing: grade.missing as unknown as Prisma.InputJsonValue,
          completenessCheckedAt: new Date(),
          inputVatBlockReason: grade.blockReason,
          inputVatClaimable: grade.suggestedClaimable ? true : null,
        },
        select: { id: true },
      });
      // back-link the original → flip its color to follow the (hopefully green) replacement
      await tx.ledgerExpense.update({
        where: { id: original.id },
        data: {
          replacedById: repl.id,
          completenessStatus: grade.status,
          completenessMissing: grade.missing as unknown as Prisma.InputJsonValue,
          completenessCheckedAt: new Date(),
          inputVatBlockReason: grade.blockReason,
          inputVatClaimable: grade.suggestedClaimable ? true : null,
        },
      });
      return repl;
    });
    replacementId = created.id;
  } catch (e) {
    console.error("[ledger:attachReplacementInvoice] create failed", e);
    return { ok: false, error: "บันทึกใบทดแทนไม่สำเร็จ" };
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_REPLACEMENT_ATTACHED",
    resourceType: "ledger_expense",
    resourceId: original.id,
    diff: { new: { replacementId, completenessStatus: grade.status } },
  });
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true, replacementId, completenessStatus: grade.status };
}

/** Month-prefixed doc-code stem for replacement rows (the real per-company counter
 *  lives in actions.ts; here we just need a unique-enough -R code, scoped by the
 *  @@unique(orgId,companyId,docCode) which appends the row id collision-free). */
async function currentDocCodeFallback(): Promise<string> {
  const ym = new Date().toISOString().slice(0, 7).replace("-", "");
  return `EXP-${ym}-${Date.now().toString().slice(-5)}`;
}

// ===================== Settings: categories =====================
// Keep VALID_SKUS before categorySchema so both schemas can reference it.
const CATEGORY_VALID_SKUS = ["JPS-100", "JPS-101", "JPS-103"] as const;

const categorySchema = z.object({
  // NOT .uuid(): seed company/category ids are synthetic uuids like
  // 00000000-0000-0000-0000-0000000000a2 — valid Postgres uuid SYNTAX (the
  // column stores them fine) but NOT RFC-4122 (version/variant nibbles are 0),
  // so zod v4's RFC-strict .uuid() rejects them → false "Invalid UUID". The real
  // gate is the prisma.company.findFirst({ id, orgId }) ownership check below.
  companyId: z.string().trim().min(1, "ไม่ได้ระบุบริษัท"),
  name: z.string().trim().min(1, "ต้องระบุชื่อหมวด").max(100),
  color: z.string().trim().max(20).optional().or(z.literal("")),
  trcloudAccCode: z.string().trim().max(40).optional().or(z.literal("")),
  trcloudProductCode: z
    .string()
    .trim()
    .refine((v) => !v || (CATEGORY_VALID_SKUS as readonly string[]).includes(v), {
      message: "SKU ต้องเป็น JPS-100, JPS-101 หรือ JPS-103 เท่านั้น",
    })
    .optional()
    .or(z.literal("")),
  vatClaimable: z.boolean().optional(),
});

export async function createCategory(raw: unknown): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  // Categories drive the chart of accounts + TRCloud mapping → admin tier only
  // (matches the settings page requireRole + the nav adminOnly flag).
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลตั้งค่าหมวดได้" };
  }
  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { companyId, name, color, trcloudAccCode, trcloudProductCode, vatClaimable } = parsed.data;
  // Confirm company belongs to org.
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  try {
    const max = await prisma.ledgerCategory.aggregate({
      where: { orgId: session.user.org_id, companyId },
      _max: { sort: true },
    });
    await prisma.ledgerCategory.create({
      data: {
        orgId: session.user.org_id,
        companyId,
        name,
        color: color || null,
        trcloudAccCode: trcloudAccCode || null,
        trcloudProductCode: trcloudProductCode || null,
        vatClaimable: vatClaimable ?? false,
        sort: (max._max.sort ?? 0) + 1,
      },
    });
  } catch {
    return { ok: false, error: "หมวดนี้มีอยู่แล้ว" };
  }
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

export async function toggleCategory(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลตั้งค่าหมวดได้" };
  }
  await prisma.ledgerCategory.updateMany({
    where: { id, orgId: session.user.org_id },
    data: { active },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

// D5/S4 — edit an existing category's name/color/TRCloud account code.
const categoryUpdateSchema = z.object({
  id: z.string().trim().min(1, "ไม่ได้ระบุหมวด"),
  name: z.string().trim().min(1, "ต้องระบุชื่อหมวด").max(100),
  color: z.string().trim().max(20).optional().or(z.literal("")),
  trcloudAccCode: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function updateCategory(raw: unknown): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลตั้งค่าหมวดได้" };
  }
  const parsed = categoryUpdateSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { id, name, color, trcloudAccCode } = parsed.data;

  try {
    const res = await prisma.ledgerCategory.updateMany({
      where: { id, orgId: session.user.org_id },
      data: {
        name,
        color: color || null,
        trcloudAccCode: trcloudAccCode || null,
      },
    });
    if (res.count === 0) return { ok: false, error: "ไม่พบหมวด" };
  } catch {
    return { ok: false, error: "ชื่อหมวดนี้มีอยู่แล้ว" };
  }
  revalidatePath("/ledger/settings");
  return { ok: true };
}

const updateCategoryTrcloudSchema = z.object({
  id: z.string().trim().min(1),
  trcloudAccCode: z.string().trim().max(40).optional().or(z.literal("")),
  trcloudProductCode: z
    .string()
    .trim()
    .refine((v) => !v || (CATEGORY_VALID_SKUS as readonly string[]).includes(v), {
      message: "SKU ต้องเป็น JPS-100, JPS-101 หรือ JPS-103 เท่านั้น",
    })
    .optional()
    .or(z.literal("")),
  vatClaimable: z.boolean().optional(),
});

export async function updateCategoryTrcloud(raw: unknown): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) return { ok: false, error: "เฉพาะผู้ดูแลตั้งค่าหมวดได้" };
  const parsed = updateCategoryTrcloudSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { id, trcloudAccCode, trcloudProductCode, vatClaimable } = parsed.data;
  await prisma.ledgerCategory.updateMany({
    where: { id, orgId: session.user.org_id },
    data: {
      trcloudAccCode: trcloudAccCode || null,
      trcloudProductCode: trcloudProductCode || null,
      ...(vatClaimable !== undefined ? { vatClaimable } : {}),
    },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_CATEGORY_UPDATED",
    resourceType: "ledger_category",
    resourceId: id,
    diff: { new: { trcloudAccCode: trcloudAccCode || null, trcloudProductCode: trcloudProductCode || null, vatClaimable } },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

const updateBranchTrcloudSchema = z.object({
  branchId: z.string().trim().min(1),
  companyId: z.string().trim().min(1, "ไม่ได้ระบุบริษัท"),
  trcloudProject: z.string().trim().max(100).optional().or(z.literal("")),
  trcloudDepartment: z.string().trim().max(100).optional().or(z.literal("")),
});

export async function updateBranchTrcloud(raw: unknown): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) return { ok: false, error: "เฉพาะผู้ดูแลตั้งค่าสาขาได้" };
  const parsed = updateBranchTrcloudSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { branchId, companyId, trcloudProject, trcloudDepartment } = parsed.data;

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId: session.user.org_id, companyId },
    select: { id: true, settings: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขา" };

  const currentSettings =
    branch.settings && typeof branch.settings === "object"
      ? (branch.settings as Record<string, unknown>)
      : {};
  await prisma.branch.updateMany({
    where: { id: branchId, orgId: session.user.org_id },
    data: {
      settings: {
        ...currentSettings,
        trcloudProject: trcloudProject || null,
        trcloudDepartment: trcloudDepartment || null,
      },
    },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_BRANCH_UPDATED",
    resourceType: "branch",
    resourceId: branchId,
    diff: { new: { trcloudProject: trcloudProject || null, trcloudDepartment: trcloudDepartment || null } },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

// ===================== Budgets =====================
const budgetSchema = z.object({
  // NOT .uuid(): seed company/category ids are synthetic uuids like
  // 00000000-0000-0000-0000-0000000000a2 — valid Postgres uuid SYNTAX (the
  // column stores them fine) but NOT RFC-4122 (version/variant nibbles are 0),
  // so zod v4's RFC-strict .uuid() rejects them → false "Invalid UUID". The real
  // gate is the prisma.company.findFirst({ id, orgId }) ownership check below.
  companyId: z.string().trim().min(1, "ไม่ได้ระบุบริษัท"),
  categoryId: z.string().trim().min(1),
  branchId: z.string().trim().optional().or(z.literal("")),
  period: z.string().regex(/^\d{4}-\d{2}$/, "งวดต้องเป็น YYYY-MM"),
  amount: z.coerce.number().min(0),
  alertPct: z.coerce.number().int().min(0).max(200).default(90),
});

/** Budget writes mirror the /ledger/budgets nav policy: admin tier + area_manager. */
function canEditBudget(role: DbUser["role"]): boolean {
  return isAdminTier(role) || role === "area_manager";
}

export async function upsertBudget(raw: unknown): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!canEditBudget(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแล/ผู้จัดการเขตตั้งงบได้" };
  }
  const parsed = budgetSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { companyId, categoryId, branchId, period, amount, alertPct } = parsed.data;

  // Scope check: company + category belong to org.
  const cat = await prisma.ledgerCategory.findFirst({
    where: { id: categoryId, orgId: session.user.org_id, companyId },
    select: { id: true },
  });
  if (!cat) return { ok: false, error: "ไม่พบหมวด" };

  const bId = branchId || null;
  const existing = await prisma.ledgerBudget.findFirst({
    where: {
      orgId: session.user.org_id,
      companyId,
      categoryId,
      branchId: bId,
      period,
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.ledgerBudget.update({
      where: { id: existing.id },
      data: { amount, alertPct },
    });
  } else {
    await prisma.ledgerBudget.create({
      data: {
        orgId: session.user.org_id,
        companyId,
        categoryId,
        branchId: bId,
        period,
        amount,
        alertPct,
      },
    });
  }
  revalidatePath("/ledger/budgets");
  return { ok: true };
}

export async function deleteBudget(id: string): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!canEditBudget(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแล/ผู้จัดการเขตตั้งงบได้" };
  }
  await prisma.ledgerBudget.deleteMany({
    where: { id, orgId: session.user.org_id },
  });
  revalidatePath("/ledger/budgets");
  return { ok: true };
}

// ===================== Export → TRCloud CSV =====================
// Real CSV export of CONFIRMED+LOCKED expenses for a company/period. Records a
// LedgerExportBatch + audit row, then returns the CSV body so the client can
// trigger a browser download. Column shape is provisional (buildTrcloudCsv) —
// see docs/LEDGER_SETUP.md. NEVER touches drafts (only "real" spend is exported).
const exportSchema = z.object({
  // NOT .uuid(): seed company/category ids are synthetic uuids like
  // 00000000-0000-0000-0000-0000000000a2 — valid Postgres uuid SYNTAX (the
  // column stores them fine) but NOT RFC-4122 (version/variant nibbles are 0),
  // so zod v4's RFC-strict .uuid() rejects them → false "Invalid UUID". The real
  // gate is the prisma.company.findFirst({ id, orgId }) ownership check below.
  companyId: z.string().trim().min(1, "ไม่ได้ระบุบริษัท"),
  period: z.string().regex(/^\d{4}-\d{2}$/, "งวดต้องเป็น YYYY-MM"),
});

export type ExportResult =
  | { ok: true; csv: string; filename: string; rows: number }
  | { ok: false; error: string };

export async function exportConfirmedCsv(raw: unknown): Promise<ExportResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const { session } = access;
  // Exporting confirmed P&L to CSV (feeds TRCloud) → expense.export capability.
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.export"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลส่งออกได้" };
  }
  const parsed = exportSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { companyId, period } = parsed.data;
  const orgId = session.user.org_id;

  // Scope check: company belongs to org.
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true, code: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  // Only confirmed/locked rows are real spend → exportable.
  const { expenses } = await listExpenses({
    orgId,
    companyId,
    status: ["confirmed", "locked"],
    period,
    take: 5000,
  });
  if (expenses.length === 0) {
    return { ok: false, error: `งวด ${period} ยังไม่มีรายการที่ยืนยันแล้ว` };
  }

  // Resolve TRCloud account codes per category for the CSV mapping.
  const categories = await prisma.ledgerCategory.findMany({
    where: { orgId, companyId },
    select: { id: true, trcloudAccCode: true },
  });
  const accCodeByCategory: Record<string, string | null> = {};
  for (const c of categories) accCodeByCategory[c.id] = c.trcloudAccCode;

  const { csv, rows } = buildTrcloudCsv(expenses, accCodeByCategory);

  // Record the batch (audit trail of what left the system, when, by whom).
  try {
    const batch = await prisma.ledgerExportBatch.create({
      data: {
        orgId,
        companyId,
        period,
        format: "csv",
        status: "done",
        rows,
        exportedAt: new Date(),
        createdBy: session.user.id,
      },
      select: { id: true },
    });
    await audit({
      orgId,
      userId: session.user.id,
      action: "LEDGER_EXPENSE_EXPORTED",
      resourceType: "ledger_export_batch",
      resourceId: batch.id,
      diff: { new: { period, rows, format: "csv" } },
    });
  } catch (err) {
    // The CSV is still useful even if batch logging hiccups — don't block it.
    console.error("[ledger:exportConfirmedCsv] batch log failed", err);
  }

  const filename = `ledger-${company.code}-${period}.csv`;
  return { ok: true, csv, filename, rows };
}

// ===================== TRCloud API push (ส่ง AP เข้า TRCloud) =====================
// Push a CONFIRMED expense INTO TRCloud as an AP via api-connector2. The heavy
// lifting (search-before-create vendor + SKUs, then ap/create) lives in
// lib/ledger/trcloud-push.ts. These actions enforce the security bar: accountant
// tier, org+company scope, NEVER a draft (golden rule), idempotent (a row with a
// trcloudDocId can't be pushed twice), audit trail, and per-row error capture.

/** Load the full expense (items + category GL) → the shape the pusher needs.
 *  companyId is REQUIRED — never omit it, as one org can own multiple legal
 *  entities (e.g. Pooil + JP Sync with separate VAT books). A query without
 *  companyId would let an accountant push an expense belonging to a different
 *  company in the same org (cross-company VAT leak). */
async function loadPushable(
  orgId: string,
  id: string,
  companyId: string,
): Promise<
  | {
      pushable: PushableExpense;
      status: string;
      docType: string;
      companyId: string;
      alreadyPushed: boolean;
    }
  | null
> {
  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId, companyId },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      category: {
        select: {
          name: true,
          trcloudAccCode: true,
          trcloudProductCode: true,
          vatClaimable: true,
        },
      },
      branch: { select: { settings: true } },
    },
  });
  if (!row) return null;

  // Branch.settings stores TRCloud branch config: { trcloudProject, trcloudDepartment }
  const branchSettings =
    row.branch?.settings && typeof row.branch.settings === "object"
      ? (row.branch.settings as Record<string, unknown>)
      : {};

  return {
    status: row.status,
    docType: row.docType,
    companyId: row.companyId,
    alreadyPushed: !!row.trcloudDocId,
    pushable: {
      id: row.id,
      orgId: row.orgId,
      companyId: row.companyId,
      docCode: row.docCode,
      vendor: row.vendor,
      vendorTaxId: row.vendorTaxId,
      vendorAddress: row.vendorAddress,
      docDate: row.docDate,
      subtotal: Number(row.subtotal),
      vat: Number(row.vat),
      wht: Number(row.wht),
      discount: Number(row.discount),
      total: Number(row.total),
      paymentStatus: row.paymentStatus,
      note: row.note,
      categoryName: row.category?.name ?? null,
      categoryAccCode: row.category?.trcloudAccCode ?? null,
      trcloudProductCode:
        (row.category?.trcloudProductCode as string | null) ?? null,
      inputVatClaimable: row.category?.vatClaimable ?? false,
      branchTrcloudProject:
        typeof branchSettings.trcloudProject === "string"
          ? branchSettings.trcloudProject
          : null,
      branchTrcloudDepartment:
        typeof branchSettings.trcloudDepartment === "string"
          ? branchSettings.trcloudDepartment
          : null,
      items: row.items.map((it) => ({
        description: it.description,
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
        vatRate: it.vatRate == null ? null : Number(it.vatRate),
      })),
    },
  };
}

type PushMeta = { vendor?: string | null; total?: number; vendorTaxId?: string | null; docCode?: string | null };

/** Stamp the push result back on the expense (success or error) + audit.
 *  meta is optional enrichment for the audit diff (vendor, amount, taxId). */
async function recordPushResult(
  orgId: string,
  companyId: string,
  id: string,
  userId: string,
  res: { ok: true; docId: string | null; docNo: string | null } | { ok: false; error: string },
  meta?: PushMeta,
): Promise<void> {
  // DB write + audit are independent — run them in parallel to save ~20-50ms per push.
  if (res.ok) {
    await Promise.all([
      prisma.ledgerExpense.updateMany({
        where: { id, orgId, companyId },
        data: {
          trcloudDocId: res.docId ?? "sent",
          trcloudDocNo: res.docNo,
          trcloudPushedAt: new Date(),
          trcloudError: null,
        },
      }),
      audit({
        orgId,
        userId,
        action: "LEDGER_EXPENSE_PUSHED_TRCLOUD",
        resourceType: "ledger_expense",
        resourceId: id,
        diff: {
          new: {
            trcloudDocNo: res.docNo,
            trcloudDocId: res.docId,
            // Revenue Dept required fields for input-VAT audit trail
            ...(meta?.vendor !== undefined && { vendor: meta.vendor }),
            ...(meta?.total !== undefined && { total: meta.total }),
            ...(meta?.vendorTaxId !== undefined && { vendorTaxId: meta.vendorTaxId }),
            ...(meta?.docCode !== undefined && { docCode: meta.docCode }),
          },
        },
      }),
    ]);
  } else {
    await Promise.all([
      prisma.ledgerExpense.updateMany({
        where: { id, orgId, companyId },
        // P0#8 TRCLOUD NULL→ERROR: set trcloudDocId='error' instead of null so the
        // row cannot be claimed again by a concurrent push (alreadyPushed check =
        // !!trcloudDocId stays true). The accountant must explicitly call
        // deleteTrcloudApAction to clear 'error' and allow a clean retry.
        // Previously null here = race window where a concurrent push would see
        // trcloudDocId=null and create a second AP in TRCloud.
        data: { trcloudDocId: "error", trcloudError: res.error.slice(0, 500) },
      }),
      audit({
        orgId,
        userId,
        action: "LEDGER_EXPENSE_PUSH_FAILED",
        resourceType: "ledger_expense",
        resourceId: id,
        diff: {
          new: {
            error: res.error.slice(0, 500),
            trcloudDocId: "error",
            ...(meta?.vendor !== undefined && { vendor: meta.vendor }),
            ...(meta?.total !== undefined && { total: meta.total }),
            ...(meta?.docCode !== undefined && { docCode: meta.docCode }),
          },
        },
      }),
    ]);
  }
}

/** Delete a TRCloud AP — accountant/admin only, with full audit trail. */
export async function deleteTrcloudApAction(
  expenseId: string,
  trcloudDocId: string,
): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  // Only accountant-tier may remove AP documents (Thai maker/checker principle).
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยกเลิก AP ใน TRCloud ได้" };
  }
  const orgId = session.user.org_id;
  const lightRow = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId, trcloudDocId },
    select: { companyId: true, vendor: true, total: true, docCode: true },
  });
  if (!lightRow) return { ok: false, error: "ไม่พบรายการหรือ AP ไม่ตรงกัน" };

  // Intent audit before the TRCloud HTTP call.
  await audit({
    orgId,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_TRCLOUD_AP_DELETE_STARTED",
    resourceType: "ledger_expense",
    resourceId: expenseId,
    diff: { old: { trcloudDocId, vendor: lightRow.vendor, total: Number(lightRow.total) } },
  });

  const res = await deleteTrcloudAp(trcloudDocId);
  if (!res.ok) {
    await audit({
      orgId,
      userId: session.user.id,
      action: "LEDGER_EXPENSE_TRCLOUD_AP_DELETE_FAILED",
      resourceType: "ledger_expense",
      resourceId: expenseId,
      diff: { new: { error: res.error } },
    });
    return { ok: false, error: res.error ?? "ลบ AP ไม่สำเร็จ" };
  }

  // Clear the docId so the expense can be re-pushed.
  await prisma.ledgerExpense.updateMany({
    where: { id: expenseId, orgId, companyId: lightRow.companyId },
    data: { trcloudDocId: null, trcloudDocNo: null, trcloudError: null },
  });
  await audit({
    orgId,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_TRCLOUD_AP_DELETED",
    resourceType: "ledger_expense",
    resourceId: expenseId,
    diff: { old: { trcloudDocId }, new: { trcloudDocId: null } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Push ONE confirmed expense → TRCloud AP. Idempotent + accountant-tier. */
export async function sendExpenseToTrcloud(
  id: string,
): Promise<ActionResult & { docNo?: string | null; alreadySent?: boolean; warning?: string }> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.export"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลส่งเข้า TRCloud ได้" };
  }
  if (!trcloudPushConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่าการเชื่อม TRCloud (ผู้ดูแลตั้ง env TRCLOUD_* ใน Vercel)" };
  }
  const orgId = session.user.org_id;
  // Lightweight load first — establishes the company boundary before the heavy
  // include. Without this, loadPushable would have to accept an optional companyId,
  // allowing a cross-company fetch when the caller doesn't know the company upfront.
  const lightRow = await prisma.ledgerExpense.findFirst({
    where: { id, orgId },
    select: { companyId: true },
  });
  if (!lightRow) return { ok: false, error: "ไม่พบรายการ" };
  const loaded = await loadPushable(orgId, id, lightRow.companyId);
  if (!loaded) return { ok: false, error: "ไม่พบรายการ" };
  // Golden rule: only confirmed/locked spend leaves the building — never a draft.
  if (loaded.status !== "confirmed" && loaded.status !== "locked") {
    return { ok: false, error: "ส่งได้เฉพาะรายการที่ยืนยันแล้ว" };
  }
  // CEO decision 2026-06-09: ใบเสนอราคา (quotation) "ส่งเข้า TRCloud ได้ แต่เตือน".
  // เดิมบล็อกเด็ดขาด (กัน double-doc + ใบเสนอราคาไม่ใช่เอกสารภาษี) — เปลี่ยนเป็น
  // เตือนแทน: ปุ่มฝั่ง client เด้ง confirm ก่อนส่ง + แนบหมายเหตุนี้กลับให้ผู้ใช้รู้ว่า
  // ภาษีซื้อขอคืนไม่ได้จนกว่าจะมีใบกำกับ/ใบเสร็จตัวจริงมาแทนที่ (supersede).
  const quotationWarning =
    loaded.docType === "quotation"
      ? "ส่งแล้ว — แต่เอกสารนี้เป็นใบเสนอราคา ภาษีซื้อ (VAT) ขอคืนไม่ได้จนกว่าจะมีใบกำกับ/ใบเสร็จตัวจริงมาแทนที่"
      : undefined;
  if (loaded.alreadyPushed) return { ok: true, alreadySent: true, warning: quotationWarning };

  // Atomically claim the row before calling TRCloud — prevents a duplicate AP if
  // two concurrent requests both pass the alreadyPushed check (race condition),
  // and prevents orphaned APs if the serverless function dies after TRCloud responds
  // but before recordPushResult writes to the DB.
  // P1#9 PENDING STUCK NOTE: 'pending' is a transient sentinel set here and resolved
  // to a real docId (success) or 'error' (failure) by recordPushResult below. If the
  // serverless function is killed mid-flight (cold timeout, OOM, SIGTERM), the row
  // stays stuck at trcloudDocId='pending' forever and blocks all future pushes.
  // TODO: a background cron (e.g. /api/cron/ledger-trcloud-reset) should run every
  // 5 minutes and reset rows where trcloudDocId='pending' AND trcloudPushedAt IS NULL
  // AND updatedAt < NOW() - INTERVAL '5 minutes' back to trcloudDocId=NULL so they
  // can be re-claimed. The 5-minute window exceeds the Vercel serverless max duration.
  const claimed = await prisma.ledgerExpense.updateMany({
    where: { id, orgId, companyId: loaded.companyId, trcloudDocId: null },
    data: { trcloudDocId: "pending" },
  });
  if (claimed.count === 0) return { ok: true, alreadySent: true }; // another request won the race

  // Intent audit — written BEFORE the HTTP call so that if the function dies
  // mid-push, an auditor can see the push was started (and check TRCloud).
  await audit({
    orgId,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_PUSH_STARTED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { new: { vendor: loaded.pushable.vendor, total: loaded.pushable.total, docCode: loaded.pushable.docCode } },
  });

  const res = await pushExpenseToTrcloud(loaded.pushable);
  await recordPushResult(orgId, loaded.companyId, id, session.user.id, res, {
    vendor: loaded.pushable.vendor,
    total: loaded.pushable.total,
    vendorTaxId: loaded.pushable.vendorTaxId,
    docCode: loaded.pushable.docCode,
  });
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, docNo: res.docNo, warning: quotationWarning };
}

/** Push MANY confirmed expenses (multi-select). Company-scoped like bulkConfirm:
 *  the id array is client-supplied, so a companyId filter stops a cross-company push. */
export async function sendExpensesToTrcloud(
  ids: string[],
  companyId: string,
): Promise<ActionResult & { sent?: number; skipped?: number; failed?: number; firstError?: string; quotationsSent?: number }> {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "ไม่ได้เลือกรายการ" };
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!(await ledgerWebCanForRole(session.user.org_id, session.user.role, "expense.export"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลส่งเข้า TRCloud ได้" };
  }
  if (!trcloudPushConfigured()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่าการเชื่อม TRCloud (ผู้ดูแลตั้ง env TRCLOUD_* ใน Vercel)" };
  }
  const orgId = session.user.org_id;
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  let sent = 0,
    skipped = 0,
    failed = 0,
    quotationsSent = 0;
  let firstError: string | undefined;
  // Sequential on purpose: each push creates/looks-up shared TRCloud masters; serial
  // avoids racing two new-vendor creates into duplicates within one batch.
  for (const id of ids) {
    const loaded = await loadPushable(orgId, id, companyId);
    if (!loaded || loaded.companyId !== companyId) {
      skipped++;
      continue;
    }
    if (loaded.status !== "confirmed" && loaded.status !== "locked") {
      skipped++;
      continue;
    }
    // CEO decision 2026-06-09: ใบเสนอราคาส่งได้ (เดิม skip) — นับแยกไว้รายงานกลับ
    // ให้ผู้ใช้รู้ว่ามีใบเสนอราคารวมอยู่ (ภาษีซื้อขอคืนไม่ได้จนกว่าจะมีใบจริง).
    if (loaded.docType === "quotation") quotationsSent++;
    if (loaded.alreadyPushed) {
      skipped++;
      continue;
    }
    // Atomic claim — prevents duplicate AP if bulk is retried concurrently.
    const bulkClaimed = await prisma.ledgerExpense.updateMany({
      where: { id, orgId, companyId, trcloudDocId: null },
      data: { trcloudDocId: "pending" },
    });
    if (bulkClaimed.count === 0) {
      skipped++;
      continue;
    }
    // Intent audit before HTTP call (AUD P0 requirement).
    await audit({
      orgId,
      userId: session.user.id,
      action: "LEDGER_EXPENSE_PUSH_STARTED",
      resourceType: "ledger_expense",
      resourceId: id,
      diff: { new: { vendor: loaded.pushable.vendor, total: loaded.pushable.total, docCode: loaded.pushable.docCode } },
    });
    const res = await pushExpenseToTrcloud(loaded.pushable);
    await recordPushResult(orgId, companyId, id, session.user.id, res, {
      vendor: loaded.pushable.vendor,
      total: loaded.pushable.total,
      vendorTaxId: loaded.pushable.vendorTaxId ?? undefined,
      docCode: loaded.pushable.docCode,
    });
    if (res.ok) sent++;
    else {
      failed++;
      firstError ??= res.error;
    }
  }
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  if (sent === 0 && failed > 0) {
    return { ok: false, error: firstError ?? "ส่งไม่สำเร็จ", sent, skipped, failed, firstError, quotationsSent };
  }
  return { ok: true, sent, skipped, failed, firstError, quotationsSent };
}

// ===================== LIFF member actions (แก้ไข/ยืนยันจาก LINE) =====================
// Field staff capture receipts in LINE and edit them in the LIFF — but they are
// `ledger_line_member` rows, NOT Pool-module users, so the back-office actions
// (saveExpense/confirmExpense) reject them with "ไม่มีสิทธิ์ใช้งานโมดูลนี้". These
// member-aware variants authorize via resolveLedgerActor() (Pool admin OR active
// LINE member) + the money-capability matrix: ANY active member may edit a draft
// (scoped to their branch); only an actor with can(expense.confirm) may confirm/
// void. GOLDEN RULE preserved — never auto-post; confirm stays an explicit action.

/** Load an expense scoped to an org (the actor's org) — used by LIFF actions. */
async function loadScopedByOrg(orgId: string, id: string) {
  return prisma.ledgerExpense.findFirst({
    where: { id, orgId },
    select: {
      id: true, companyId: true, branchId: true, status: true,
      // needed by gradeColumnsFromPatch so a LIFF edit re-grades สถานะสี too.
      buyerTaxIdOnDoc: true, vendorAddress: true, vendorBranchCode: true,
    },
  });
}

/** Edit a draft from the LIFF. Any active member (in branch scope) may save. */
export async function liffSaveExpense(id: string, raw: unknown): Promise<ActionResult> {
  const actor = await resolveLedgerActor();
  if (!actor) return { ok: false, error: "บัญชียังไม่เปิดใช้งานสำหรับคุณ · ติดต่อออฟฟิศ" };
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodErrorMessage(parsed.error) };
  const row = await loadScopedByOrg(actor.orgId, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (!actorCanReachBranch(actor, row.branchId)) return { ok: false, error: "ไม่มีสิทธิ์ในสาขานี้" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก แก้ไม่ได้" };

  // Re-grade สถานะสี (ภาษีซื้อ) from the edited values — same as web saveExpense,
  // so a LIFF member's edit doesn't leave a stale green/red verdict on the row.
  const { grade: _gl, ...gradeColsLiff } = gradeColumnsFromPatch(parsed.data, row);
  void _gl;
  await prisma.$transaction(async (tx) => {
    await tx.ledgerExpense.updateMany({
      where: { id, orgId: actor.orgId, companyId: row.companyId },
      data: { ...gradeColsLiff, ...toData(parsed.data), needsReview: true },
    });
    await replaceItems(tx, {
      expenseId: id,
      orgId: actor.orgId,
      companyId: row.companyId,
      items: parsed.data.items,
    });
  });
  await audit({
    orgId: actor.orgId,
    userId: actor.userId,
    action: "LEDGER_EXPENSE_UPDATED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { new: { via: "liff", total: parsed.data.total } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Confirm a draft from the LIFF — only an actor with the expense.confirm capability. */
export async function liffConfirmExpense(id: string, raw: unknown): Promise<ActionResult> {
  const actor = await resolveLedgerActor();
  if (!actor) return { ok: false, error: "บัญชียังไม่เปิดใช้งานสำหรับคุณ · ติดต่อออฟฟิศ" };
  if (!actor.canConfirm) return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยืนยันได้ — กดบันทึกร่างได้" };
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodErrorMessage(parsed.error) };
  const p = parsed.data;

  // Same recheck gate as the web confirm — only hard total mismatches block.
  const rc = recheckReceipt({
    vendorTaxId: p.vendorTaxId || null,
    subtotal: p.subtotal,
    discount: p.discount,
    vat: p.vat,
    wht: p.wht,
    total: p.total,
    items: (p.items ?? []).map((it) => ({
      description: it.description,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
      vatRate: it.vatRate ?? null,
    })),
  });
  if (rc.blockingMathError) {
    const detail = rc.warnings.find((w) => w.includes("ยอดรวม")) ?? "ยอดย่อย + VAT − หัก ณ ที่จ่าย ไม่เท่ายอดรวม";
    return { ok: false, error: `ยอดไม่ตรง: ${detail}` };
  }

  const row = await loadScopedByOrg(actor.orgId, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (!actorCanReachBranch(actor, row.branchId)) return { ok: false, error: "ไม่มีสิทธิ์ในสาขานี้" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก ยืนยันไม่ได้" };

  // D1 CONFIRM-GATE (LIFF) — same posting gate as the web confirm, on the FINAL
  // merged values (toData coerces ''→null). actor.canConfirm is already re-verified
  // above via resolveLedgerActor (re-checks the LINE id_token per action).
  const mergedLiff = toData(p);
  const gateLiff = expenseConfirmability({
    branchId: mergedLiff.branchId,
    categoryId: mergedLiff.categoryId,
  });
  if (!gateLiff.ok) return { ok: false, error: confirmabilityMessage(gateLiff.missing) };

  await prisma.$transaction(async (tx) => {
    await tx.ledgerExpense.updateMany({
      where: { id, orgId: actor.orgId, companyId: row.companyId },
      data: { ...toData(p), status: "confirmed", needsReview: false, confirmedBy: actor.userId, confirmedAt: new Date() },
    });
    await replaceItems(tx, { expenseId: id, orgId: actor.orgId, companyId: row.companyId, items: p.items });
  });
  await audit({
    orgId: actor.orgId,
    userId: actor.userId,
    action: "LEDGER_EXPENSE_CONFIRMED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { new: { via: "liff", status: "confirmed", total: p.total } },
  });
  // Auto-archive the receipt original into Google Drive (no-op if not connected).
  after(() =>
    archiveExpenseToDrive({ orgId: actor.orgId, companyId: row.companyId, id }).catch(() => {}),
  );
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Void from the LIFF — only an actor with the expense.confirm capability. */
export async function liffVoidExpense(id: string): Promise<ActionResult> {
  const actor = await resolveLedgerActor();
  if (!actor) return { ok: false, error: "บัญชียังไม่เปิดใช้งานสำหรับคุณ · ติดต่อออฟฟิศ" };
  if (!actor.canConfirm) return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยกเลิกได้" };
  const row = await loadScopedByOrg(actor.orgId, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (!actorCanReachBranch(actor, row.branchId)) return { ok: false, error: "ไม่มีสิทธิ์ในสาขานี้" };
  if (row.status === "locked") return { ok: false, error: "รายการถูกล็อก ยกเลิกไม่ได้" };
  if (await billInActiveRequest(actor.orgId, row.companyId, id))
    return { ok: false, error: IN_ACTIVE_REQUEST_MSG };

  await prisma.ledgerExpense.updateMany({
    where: { id, orgId: actor.orgId, companyId: row.companyId },
    data: { status: "void", needsReview: false },
  });
  await audit({
    orgId: actor.orgId,
    userId: actor.userId,
    action: "LEDGER_EXPENSE_VOIDED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { new: { via: "liff", status: "void" } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

// ── LIFF (LINE-auth) delete variants (D2) ───────────────────────────────────
// Mirror the WEB selfDeleteExpense / requestDeleteExpense rules, but authenticate
// via resolveLedgerActor() (the LINE id_token) instead of the web session — so the
// same self-delete window + request-delete LINE ping work from inside the LIFF.
// companyId is filtered on EVERY query/mutation (orgId-only = cross-company leak,
// P0). NEVER hard-delete — soft void only. Reuses SELF_DELETE_WINDOW_MS (the web
// constant) so the two paths can never drift apart.

/** Soft-void a fresh draft you created yourself, from the LIFF. companyId-scoped. */
export async function liffSelfDeleteExpense(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ไม่ได้ระบุรายการ" };
  const actor = await resolveLedgerActor();
  if (!actor) return { ok: false, error: "บัญชียังไม่เปิดใช้งานสำหรับคุณ · ติดต่อออฟฟิศ" };

  // Need createdBy/createdAt/trcloudDocId for the self-delete gate — fields the
  // shared loadScopedByOrg() does NOT select — so query directly (orgId-scoped read,
  // then the void below is locked to the row's own companyId).
  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId: actor.orgId },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      status: true,
      createdBy: true,
      createdAt: true,
      trcloudDocId: true,
    },
  });
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (!actorCanReachBranch(actor, row.branchId))
    return { ok: false, error: "ไม่มีสิทธิ์ในสาขานี้" };

  // ALL conditions must hold — each failure steers the user to "ขอลบ".
  if (row.createdBy !== actor.userId)
    return { ok: false, error: "ลบได้เฉพาะรายการที่คุณสร้างเอง · กดขอลบให้บัญชีลบแทน" };
  if (row.status !== "draft")
    return { ok: false, error: "ยืนยันแล้วลบเองไม่ได้ · กดขอลบให้บัญชียกเลิกแทน" };
  if (row.trcloudDocId)
    return { ok: false, error: "ส่งเข้าระบบบัญชีแล้วลบเองไม่ได้ · กดขอลบ" };
  // Server-side clock — never trust a client timestamp for the window.
  if (Date.now() - row.createdAt.getTime() >= SELF_DELETE_WINDOW_MS)
    return { ok: false, error: "เกิน 5 นาทีแล้ว ลบเองไม่ได้ · กดขอลบให้บัญชีลบแทน" };
  if (await billInActiveRequest(actor.orgId, row.companyId, id))
    return { ok: false, error: IN_ACTIVE_REQUEST_MSG };

  // Soft delete = void (same semantics as web). companyId-scoped, never hard-delete.
  await prisma.ledgerExpense.updateMany({
    where: { id, orgId: actor.orgId, companyId: row.companyId },
    data: { status: "void", needsReview: false },
  });
  await audit({
    orgId: actor.orgId,
    userId: actor.userId,
    action: "LEDGER_EXPENSE_VOIDED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { old: { status: row.status }, new: { status: "void", via: "liff_self_delete" } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Ask the office (via LINE) to delete a row you CAN'T self-void, from the LIFF.
 *  Mirrors the web requestDeleteExpense ping — does NOT delete. companyId-scoped. */
export async function liffRequestDeleteExpense(
  id: string,
  reason?: string,
): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ไม่ได้ระบุรายการ" };
  const actor = await resolveLedgerActor();
  if (!actor) return { ok: false, error: "บัญชียังไม่เปิดใช้งานสำหรับคุณ · ติดต่อออฟฟิศ" };

  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId: actor.orgId },
    select: { id: true, companyId: true, branchId: true, docCode: true, vendor: true, status: true },
  });
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (!actorCanReachBranch(actor, row.branchId))
    return { ok: false, error: "ไม่มีสิทธิ์ในสาขานี้" };

  const cleanReason = (reason ?? "").trim().slice(0, 300);
  const text =
    `🗑️ ขอให้ลบรายจ่าย\n` +
    `เอกสาร: ${row.docCode}${row.vendor ? ` · ${row.vendor}` : ""}\n` +
    `ผู้ขอ: ${actor.userId} (ผ่าน LINE)\n` +
    (cleanReason ? `เหตุผล: ${cleanReason}` : `เหตุผล: (ไม่ได้ระบุ)`) +
    `\nกรุณาตรวจและกดยกเลิกให้ในเมนู “รายจ่าย”`;

  // Best-effort LINE ping → the company's ledger admins/accountants. companyId-scoped.
  let notified = 0;
  try {
    const channel = await prisma.ledgerLineChannel.findFirst({
      where: { orgId: actor.orgId, companyId: row.companyId, active: true },
      select: { accessTokenEnc: true },
    });
    const accessToken = channel?.accessTokenEnc ? decryptToken(channel.accessTokenEnc) : null;
    if (accessToken) {
      const recipients = await prisma.ledgerLineMember.findMany({
        where: {
          orgId: actor.orgId,
          companyId: row.companyId,
          active: true,
          role: { in: ["admin", "accountant"] },
        },
        select: { lineUserId: true },
      });
      const seen = new Set<string>();
      for (const r of recipients) {
        if (!r.lineUserId || seen.has(r.lineUserId)) continue;
        seen.add(r.lineUserId);
        const ok = await pushLedgerLineText(accessToken, r.lineUserId, text);
        if (ok) notified++;
      }
    }
  } catch {
    // Swallow — the request is informal; never fail the user's click on a push error.
  }

  await audit({
    orgId: actor.orgId,
    userId: actor.userId,
    action: "LEDGER_EXPENSE_UPDATED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { new: { deleteRequested: true, via: "liff", notified, reason: cleanReason || null } },
  });

  // Always ok from the user's side — they've asked; the office will action it.
  return notified > 0
    ? { ok: true }
    : { ok: true, error: "ส่งคำขอแล้ว แต่ยังไม่ได้เชื่อม LINE บัญชี — แจ้งออฟฟิศโดยตรงด้วยนะ" };
}

// ===================== Settings: LINE channel =====================
// Connect the company's LINE Official Account so staff can photo receipts into
// a LINE group → AI draft (the webhook lives at /api/webhooks/ledger/line/<id>).
// ONE channel per company (upsert on orgId+companyId). Admin-tier only (matches
// the settings page requireRole + the nav adminOnly flag — same gate as
// categories). Secrets (Channel Secret / Access Token) are stored ENCRYPTED via
// channel-crypto (same wrapping key as inbox/recruit) and NEVER returned to the
// client; on edit, a blank field keeps the existing encrypted value.
const lineChannelSchema = z.object({
  // NOT .uuid(): seed company/category ids are synthetic uuids like
  // 00000000-0000-0000-0000-0000000000a2 — valid Postgres uuid SYNTAX (the
  // column stores them fine) but NOT RFC-4122 (version/variant nibbles are 0),
  // so zod v4's RFC-strict .uuid() rejects them → false "Invalid UUID". The real
  // gate is the prisma.company.findFirst({ id, orgId }) ownership check below.
  companyId: z.string().trim().min(1, "ไม่ได้ระบุบริษัท"),
  lineChannelId: z.string().trim().min(1, "ใส่ Channel ID").max(64),
  channelSecret: z.string().trim().max(200).optional().or(z.literal("")),
  accessToken: z.string().trim().max(8000).optional().or(z.literal("")),
  groupId: z.string().trim().max(100).optional().or(z.literal("")),
});

export async function connectLineChannel(raw: unknown): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลเชื่อมต่อ LINE ได้" };
  }
  const parsed = lineChannelSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { companyId, lineChannelId, channelSecret, accessToken, groupId } = parsed.data;
  const orgId = session.user.org_id;

  // Confirm company belongs to org before binding a channel to it.
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  // One channel per company. On edit, keep the stored secret/token when the
  // field is left blank (so the accountant can update just the Group ID without
  // re-pasting the long Access Token).
  const existing = await prisma.ledgerLineChannel.findFirst({
    where: { orgId, companyId },
    select: { id: true, webhookSecretEnc: true, accessTokenEnc: true },
  });
  const gId = groupId || null;

  let channelRowId: string;
  let secretEnc: string | null;
  let tokenEnc: string | null;
  try {
    // Encrypt INSIDE the try: encryptToken → getKey() throws if neither
    // RECRUIT_CHANNEL_KEY nor a NEXTAUTH_SECRET/AUTH_SECRET fallback is set, so
    // keeping it here returns a clean ActionResult instead of a 500.
    secretEnc = channelSecret
      ? encryptToken(channelSecret)
      : existing?.webhookSecretEnc ?? null;
    tokenEnc = accessToken
      ? encryptToken(accessToken)
      : existing?.accessTokenEnc ?? null;
    if (existing) {
      await prisma.ledgerLineChannel.update({
        where: { id: existing.id },
        data: {
          lineChannelId,
          webhookSecretEnc: secretEnc,
          accessTokenEnc: tokenEnc,
          groupId: gId,
          active: true,
        },
      });
      channelRowId = existing.id;
    } else {
      const created = await prisma.ledgerLineChannel.create({
        data: {
          orgId,
          companyId,
          lineChannelId,
          webhookSecretEnc: secretEnc,
          accessTokenEnc: tokenEnc,
          groupId: gId,
          active: true,
        },
        select: { id: true },
      });
      channelRowId = created.id;
    }
  } catch (e) {
    // Two distinct failure modes — don't mislabel one as the other:
    //  (a) encryptToken threw → no encryption key env configured.
    //  (b) unique(orgId, lineChannelId) → this Channel ID is bound elsewhere.
    const msg = e instanceof Error ? e.message : "";
    if (/CHANNEL_KEY|NEXTAUTH_SECRET|32 bytes/i.test(msg)) {
      return {
        ok: false,
        error: "ระบบเข้ารหัสยังไม่พร้อม — ผู้ดูแลต้องตั้งค่า RECRUIT_CHANNEL_KEY ใน env",
      };
    }
    return { ok: false, error: "Channel ID นี้ถูกใช้ไปแล้ว (ผูกกับบริษัทอื่น)" };
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "LEDGER_LINE_CHANNEL_CONNECTED",
    resourceType: "ledger_line_channel",
    resourceId: channelRowId,
    // NEVER log the secrets — only whether they are now set.
    diff: {
      new: {
        lineChannelId,
        hasSecret: !!secretEnc,
        hasAccessToken: !!tokenEnc,
        groupSet: !!gId,
      },
    },
  });
  revalidatePath("/ledger/settings");
  return { ok: true };
}

/** Remove the company's LINE channel (stops the webhook accepting events). */
export async function disconnectLineChannel(
  companyId: string,
): Promise<ActionResult> {
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลจัดการ LINE ได้" };
  }
  const res = await prisma.ledgerLineChannel.deleteMany({
    where: { orgId: session.user.org_id, companyId },
  });
  if (res.count > 0) {
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "LEDGER_LINE_CHANNEL_DISCONNECTED",
      resourceType: "ledger_line_channel",
      diff: { old: { companyId } },
    });
  }
  revalidatePath("/ledger/settings");
  return { ok: true };
}

/** Pause/resume the channel without deleting its secrets (webhook 404s when
 *  inactive — see the route's `!channel.active` guard). */
export async function toggleLineChannel(
  companyId: string,
  active: boolean,
): Promise<ActionResult> {
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลจัดการ LINE ได้" };
  }
  await prisma.ledgerLineChannel.updateMany({
    where: { orgId: session.user.org_id, companyId },
    data: { active },
  });
  revalidatePath("/ledger/settings");
  return { ok: true };
}

/**
 * Bind the company's LINE group ↔ a branch FROM THE WEB (admin tier). Receipts
 * dropped in that group then auto-tag this branch. This is the back-office
 * equivalent of the in-LINE `/setting สาขา <code>` command — but it does NOT
 * need the sender's LINE id to be pre-linked to a Pool admin (the web session
 * IS the admin gate). Pass branchId="" to clear (back to central group).
 */
export async function setChannelBranch(
  companyId: string,
  branchId: string,
): Promise<ActionResult> {
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลตั้งค่าสาขาได้" };
  }
  const orgId = session.user.org_id;

  // Validate the branch belongs to this org+company before binding (don't trust
  // a client id — same defence as the category/budget company checks).
  let bId: string | null = null;
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, orgId, companyId },
      select: { id: true },
    });
    if (!branch) return { ok: false, error: "ไม่พบสาขาในบริษัทนี้" };
    bId = branch.id;
  }

  const res = await prisma.ledgerLineChannel.updateMany({
    where: { orgId, companyId },
    data: { branchId: bId, kind: bId ? "branch" : "central" },
  });
  if (res.count === 0) {
    return { ok: false, error: "ยังไม่ได้เชื่อมกลุ่ม LINE — เชื่อมต่อก่อน" };
  }
  await audit({
    orgId,
    userId: session.user.id,
    action: "LEDGER_LINE_CHANNEL_CONNECTED",
    resourceType: "ledger_line_channel",
    diff: { new: { branchBound: !!bId } },
  });
  revalidatePath("/ledger/settings");
  return { ok: true };
}

// ── Scoped LINE invites (M7) ────────────────────────────────────────────────
// CEO model: invite a person with a link that pins WHICH branches/categories
// they oversee. Opening the link (inside the LedgerLine LIFF) verifies their
// LINE id and creates a scoped ledger_line_member. Admin-tier creates/revokes.

const inviteSchema = z.object({
  companyId: z.string().trim().min(1),
  role: z.enum(["staff", "accountant", "admin", "external_accountant"]).default("staff"),
  scopeBranchIds: z.array(z.string().trim().min(1)).max(200).optional(),
  scopeCategoryIds: z.array(z.string().trim().min(1)).max(200).optional(),
  note: z.string().trim().max(200).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

/** Build the shareable invite link. LINE LIFF "Concatenate" rule (official docs): the
 *  path after the LIFF id is appended to the FULL Endpoint URL. Ledger's endpoint is
 *  /liff/ledger, so any "/ledger…" path DUPLICATES it → /liff/ledger/ledger… → 404
 *  (the bug we hit). Correct = append ONLY the part beyond the endpoint; for the
 *  endpoint page itself, NO path. So `{id}?invite=TOKEN` lands on /liff/ledger and the
 *  bootstrap reads `invite` (direct query) → binds INLINE (JoinClient). */
function inviteUrl(token: string): string {
  const liffId = liffIdForModule("ledger");
  const path = `/liff/ledger/join?invite=${token}`; // web fallback (no LIFF)
  return liffId
    ? `https://liff.line.me/${liffId}?invite=${encodeURIComponent(token)}`
    : path;
}

export async function createLedgerInvite(
  raw: unknown,
): Promise<ActionResult & { token?: string; url?: string }> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลสร้างคำเชิญได้" };
  }
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลคำเชิญไม่ถูกต้อง" };
  const p = parsed.data;

  // Company must belong to the org (don't trust the client id).
  const company = await prisma.company.findFirst({
    where: { id: p.companyId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  const token = randomBytes(18).toString("base64url");
  const expiresAt = p.expiresInDays
    ? new Date(Date.now() + p.expiresInDays * 86400_000)
    : null;

  await prisma.ledgerLineInvite.create({
    data: {
      orgId: session.user.org_id,
      companyId: p.companyId,
      token,
      role: p.role,
      scopeBranchIds: p.scopeBranchIds ?? [],
      scopeCategoryIds: p.scopeCategoryIds ?? [],
      note: p.note || null,
      expiresAt,
      createdBy: session.user.id,
    },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_INVITE_CREATED",
    resourceType: "ledger_line_invite",
    diff: { new: { role: p.role, branches: p.scopeBranchIds?.length ?? 0 } },
  });
  revalidatePath("/ledger/settings");
  return { ok: true, token, url: inviteUrl(token) };
}

/**
 * Owner/admin SELF-CLAIM link (identity fix 2026-06-05). The admin is already a
 * Pool user but the LIFF authenticates via the LINE *Login* channel sub, which can
 * differ from the messaging userId (different providers) — so the admin gets blocked
 * in the LIFF even though the bot knows them. This mints a one-tap admin_claim invite
 * targeting THE CALLER's own Pool user; opening it in LINE binds their verified login
 * sub (users.line_login_sub) so every channel resolves them. No id guessing, no dance.
 */
export async function createLedgerSelfClaimLink(): Promise<
  ActionResult & { url?: string }
> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลผูกบัญชีของตัวเองได้" };
  }
  const company = await prisma.company.findFirst({
    where: { orgId: session.user.org_id },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!company) return { ok: false, error: "ยังไม่มีบริษัทในระบบ" };
  // Clear prior unused self-claim tokens for this user (avoid pile-up).
  await prisma.ledgerLineInvite.deleteMany({
    where: { orgId: session.user.org_id, targetPoolUserId: session.user.id, usedAt: null },
  });
  const token = randomBytes(18).toString("base64url");
  await prisma.ledgerLineInvite.create({
    data: {
      orgId: session.user.org_id,
      companyId: company.id,
      token,
      role: "admin",
      kind: "admin_claim",
      targetPoolUserId: session.user.id, // bind to ME
      scopeBranchIds: [],
      scopeCategoryIds: [],
      expiresAt: new Date(Date.now() + 86400_000), // 24h
      createdBy: session.user.id,
    },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_ADMIN_LINE_LINKED",
    resourceType: "user",
    resourceId: session.user.id,
    diff: { new: { kind: "admin_claim", self: true, via: "self_claim_link" } },
  });
  revalidatePath("/ledger/settings");
  return { ok: true, url: inviteUrl(token) };
}

/**
 * TOP-DOWN admin invite (CEO req 2). The owner/admin generates a link and hands it
 * to a new admin; opening it in LINE mints a FRESH ledger-only Pool user (isolated
 * from ChairOps) + binds their login sub + makes them a ledger admin. Role-rank: only
 * admin-tier may create it, and it only grants LEDGER admin (never a Pool super_admin).
 */
const adminInviteSchema = z.object({
  companyId: z.string().trim().min(1),
  scopeBranchIds: z.array(z.string().trim().min(1)).max(200).optional(),
  note: z.string().trim().max(200).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(30).optional(),
});

export async function createLedgerAdminInvite(
  raw: unknown,
): Promise<ActionResult & { token?: string; url?: string }> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลตั้งแอดมินได้" };
  }
  const parsed = adminInviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลคำเชิญไม่ถูกต้อง" };
  const p = parsed.data;
  const company = await prisma.company.findFirst({
    where: { id: p.companyId, orgId: session.user.org_id },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };
  const token = randomBytes(18).toString("base64url");
  await prisma.ledgerLineInvite.create({
    data: {
      orgId: session.user.org_id,
      companyId: p.companyId,
      token,
      role: "admin",
      kind: "admin_claim",
      targetPoolUserId: null, // mints a fresh ledger-only Pool user on accept
      scopeBranchIds: p.scopeBranchIds ?? [],
      scopeCategoryIds: [],
      note: p.note || null,
      expiresAt: new Date(Date.now() + (p.expiresInDays ?? 7) * 86400_000),
      createdBy: session.user.id,
    },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_INVITE_CREATED",
    resourceType: "ledger_line_invite",
    diff: { new: { kind: "admin_claim", role: "admin", branches: p.scopeBranchIds?.length ?? 0 } },
  });
  revalidatePath("/ledger/settings");
  return { ok: true, token, url: inviteUrl(token) };
}

export async function revokeLedgerInvite(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ไม่ได้ระบุคำเชิญ" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลจัดการคำเชิญได้" };
  }
  // Soft-revoke = delete the unused token (scoped to org).
  await prisma.ledgerLineInvite.deleteMany({
    where: { id, orgId: session.user.org_id, usedAt: null },
  });
  revalidatePath("/ledger/settings");
  return { ok: true };
}

// ── Member ↔ branch back-office (GAP 4) ─────────────────────────────────────
// "ใครดูแลสาขาไหน": members appear here (auto-seeded from group activity OR via
// invite). Admin assigns/changes the branches each oversees, sets role, and
// approves a member's self-requested branch (pendingBranchId from /สาขา in LINE).
// Admin-tier only — same gate as channel/category settings.

/** Load a member scoped to the caller's org (returns null if not theirs). */
async function loadMemberScoped(orgId: string, memberId: string) {
  return prisma.ledgerLineMember.findFirst({
    where: { id: memberId, orgId },
    select: { id: true, companyId: true, scopeBranchIds: true, pendingBranchId: true },
  });
}

/** Keep only the branchIds that actually belong to this org+company. */
async function validBranchIds(
  orgId: string,
  companyId: string,
  branchIds: string[],
): Promise<string[]> {
  if (branchIds.length === 0) return [];
  const found = await prisma.branch.findMany({
    where: { id: { in: branchIds }, orgId, companyId },
    select: { id: true },
  });
  return found.map((b) => b.id);
}

/** Admin sets the branches a member oversees (replaces the whole scope list). */
export async function updateMemberBranches(
  memberId: string,
  branchIds: string[],
): Promise<ActionResult> {
  if (!memberId) return { ok: false, error: "ไม่ได้ระบุสมาชิก" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลกำหนดสาขาได้" };
  }
  const member = await loadMemberScoped(session.user.org_id, memberId);
  if (!member) return { ok: false, error: "ไม่พบสมาชิก" };

  const scope = await validBranchIds(
    session.user.org_id,
    member.companyId,
    Array.isArray(branchIds) ? branchIds.slice(0, 200) : [],
  );
  await prisma.ledgerLineMember.update({
    where: { id: member.id },
    data: { scopeBranchIds: scope },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_MEMBER_SCOPE_UPDATED",
    resourceType: "ledger_line_member",
    resourceId: member.id,
    diff: { new: { branches: scope.length } },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

/** Admin changes a member's role (staff | accountant | admin | external_accountant). */
export async function setMemberRole(
  memberId: string,
  role: string,
): Promise<ActionResult> {
  if (!memberId) return { ok: false, error: "ไม่ได้ระบุสมาชิก" };
  if (!["staff", "accountant", "admin", "external_accountant"].includes(role)) {
    return { ok: false, error: "สิทธิ์ไม่ถูกต้อง" };
  }
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลตั้งสิทธิ์ได้" };
  }
  const r = await prisma.ledgerLineMember.updateMany({
    where: { id: memberId, orgId: session.user.org_id },
    data: { role },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบสมาชิก" };
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_MEMBER_SCOPE_UPDATED",
    resourceType: "ledger_line_member",
    resourceId: memberId,
    diff: { new: { role } },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

/** Admin enables/disables a member (disabled = no auto-tag / hidden from list use). */
export async function toggleMemberActive(
  memberId: string,
  active: boolean,
): Promise<ActionResult> {
  if (!memberId) return { ok: false, error: "ไม่ได้ระบุสมาชิก" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลจัดการสมาชิกได้" };
  }
  const r = await prisma.ledgerLineMember.updateMany({
    where: { id: memberId, orgId: session.user.org_id },
    data: { active },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบสมาชิก" };
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

/** Approve a member's self-requested branch → add it to their scope, clear pending. */
export async function approveMemberPending(
  memberId: string,
): Promise<ActionResult> {
  if (!memberId) return { ok: false, error: "ไม่ได้ระบุสมาชิก" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลอนุมัติได้" };
  }
  const member = await loadMemberScoped(session.user.org_id, memberId);
  if (!member) return { ok: false, error: "ไม่พบสมาชิก" };
  if (!member.pendingBranchId) return { ok: false, error: "ไม่มีคำขอที่รออนุมัติ" };

  // Re-validate the requested branch still belongs to the company, then merge.
  const valid = await validBranchIds(session.user.org_id, member.companyId, [
    member.pendingBranchId,
  ]);
  const nextScope = Array.from(new Set([...member.scopeBranchIds, ...valid]));
  await prisma.ledgerLineMember.update({
    where: { id: member.id },
    data: { scopeBranchIds: nextScope, pendingBranchId: null },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_MEMBER_SCOPE_UPDATED",
    resourceType: "ledger_line_member",
    resourceId: member.id,
    diff: { new: { approvedRequest: true, branches: nextScope.length } },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

/** Reject a member's self-requested branch → just clear the pending request. */
export async function rejectMemberPending(
  memberId: string,
): Promise<ActionResult> {
  if (!memberId) return { ok: false, error: "ไม่ได้ระบุสมาชิก" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลจัดการคำขอได้" };
  }
  await prisma.ledgerLineMember.updateMany({
    where: { id: memberId, orgId: session.user.org_id },
    data: { pendingBranchId: null },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

// ── LINE ↔ Pool admin linking ────────────────────────────────────────────────
// The LINE command gate (lib/ledger/line-commands.ts · isAdminSender) recognises
// an admin by looking up the sender's LINE userId on a Pool `user` row with an
// admin-tier role. Until a user.lineUserId is set, EVERY admin command in LINE
// is rejected ("เฉพาะแอดมิน..."). These actions bind a LINE member's VERIFIED
// messaging-API userId (auto-seeded into ledger_line_member the moment they
// message the bot) to a Pool account — so that LINE account inherits the Pool
// user's powers in chat. Binding the id the WEBHOOK actually sees (not an OAuth
// id) guarantees the gate matches, regardless of how the LINE channels are set up.

/** The signed-in admin claims a LINE member as THEIR OWN account → their LINE can
 *  now run every admin command (super_admin → full powers in chat). Admin-tier. */
export async function linkLineMemberToMe(memberId: string): Promise<ActionResult> {
  if (!memberId) return { ok: false, error: "ไม่ได้ระบุสมาชิก" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลผูกบัญชี LINE ได้" };
  }
  const member = await prisma.ledgerLineMember.findFirst({
    where: { id: memberId, orgId: session.user.org_id },
    select: { id: true, lineUserId: true, displayName: true },
  });
  if (!member) return { ok: false, error: "ไม่พบสมาชิก" };

  // Refuse if this LINE id is already bound to a DIFFERENT Pool account (the
  // user.lineUserId column is @unique — and we never silently steal an identity).
  const clash = await prisma.user.findFirst({
    where: { lineUserId: member.lineUserId },
    select: { id: true, name: true },
  });
  if (clash && clash.id !== session.user.id) {
    return { ok: false, error: `LINE นี้ผูกกับบัญชี "${clash.name}" อยู่แล้ว` };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { lineUserId: member.lineUserId },
  });
  // Mark the member as linked to this Pool user + bump to admin role so the LIFF
  // console + money capabilities line up with their web powers.
  await prisma.ledgerLineMember.update({
    where: { id: member.id },
    data: { poolUserId: session.user.id, role: "admin" },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_ADMIN_LINE_LINKED",
    resourceType: "user",
    resourceId: session.user.id,
    diff: { new: { memberId: member.id, lineUserId: member.lineUserId } },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

/** Unbind a LINE member from its Pool account (revoke in-LINE admin). Admin-tier. */
export async function unlinkLineMember(memberId: string): Promise<ActionResult> {
  if (!memberId) return { ok: false, error: "ไม่ได้ระบุสมาชิก" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลจัดการได้" };
  }
  const member = await prisma.ledgerLineMember.findFirst({
    where: { id: memberId, orgId: session.user.org_id },
    select: { id: true, lineUserId: true, poolUserId: true },
  });
  if (!member || !member.poolUserId) return { ok: false, error: "สมาชิกนี้ยังไม่ได้ผูกบัญชี" };

  // Clear the Pool user's lineUserId only if it still points at THIS member's id.
  await prisma.user.updateMany({
    where: { id: member.poolUserId, lineUserId: member.lineUserId },
    data: { lineUserId: null },
  });
  await prisma.ledgerLineMember.update({
    where: { id: member.id },
    data: { poolUserId: null },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_ADMIN_LINE_LINKED",
    resourceType: "user",
    resourceId: member.poolUserId,
    diff: { old: { memberId: member.id, lineUserId: member.lineUserId }, new: { unlinked: true } },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

// ── Group → branch overrides (B3 multi-group → multi-branch) ─────────────────
// One LINE OA can serve many branch groups, each pinned to its own branch. Rows
// usually self-register via "/setting สาขา" inside a group; these let an admin
// view + re-point + pause the bindings from the web. Admin-tier.

/** Re-point a group binding to a (different) branch. */
export async function setLedgerGroupBranch(
  groupRowId: string,
  branchId: string,
): Promise<ActionResult> {
  if (!groupRowId) return { ok: false, error: "ไม่ได้ระบุกลุ่ม" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลกำหนดสาขาได้" };
  }
  const row = await prisma.ledgerLineGroup.findFirst({
    where: { id: groupRowId, orgId: session.user.org_id },
    select: { id: true, companyId: true },
  });
  if (!row) return { ok: false, error: "ไม่พบกลุ่ม" };
  // null/"" → clear (group falls back to the channel's default branch).
  const valid = branchId
    ? await validBranchIds(session.user.org_id, row.companyId, [branchId])
    : [];
  await prisma.ledgerLineGroup.update({
    where: { id: row.id },
    data: { branchId: valid[0] ?? null },
  });
  revalidatePath("/ledger/settings");
  return { ok: true };
}

/** Pause/resume a group binding (paused → group falls back to the channel branch). */
export async function toggleLedgerGroup(
  groupRowId: string,
  active: boolean,
): Promise<ActionResult> {
  if (!groupRowId) return { ok: false, error: "ไม่ได้ระบุกลุ่ม" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลจัดการได้" };
  }
  const r = await prisma.ledgerLineGroup.updateMany({
    where: { id: groupRowId, orgId: session.user.org_id },
    data: { active },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบกลุ่ม" };
  revalidatePath("/ledger/settings");
  return { ok: true };
}

// ── PR4/D4 · สลิปจ่ายเงิน ─────────────────────────────────────────────────────

/** Mark/clear a LINE group as the dedicated "ส่งสลิป" intake group (images=slips).
 *  Admin-tier. Only ONE makes sense per company but we don't force it — many
 *  could relay to the same intake (the auto-match is company-scoped, not group). */
export async function toggleLedgerGroupSlipIntake(
  groupRowId: string,
  on: boolean,
): Promise<ActionResult> {
  if (!groupRowId) return { ok: false, error: "ไม่ได้ระบุกลุ่ม" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลตั้งกลุ่มส่งสลิปได้" };
  }
  const r = await prisma.ledgerLineGroup.updateMany({
    where: { id: groupRowId, orgId: session.user.org_id },
    data: { isSlipIntake: on },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบกลุ่ม" };
  revalidatePath("/ledger/settings");
  return { ok: true };
}

/** จับคู่ "สลิปลอย" (ยังไม่รู้ว่าจ่ายบิลไหน) กับบิล → mark บิลนั้นจ่ายแล้ว.
 *  Accountant/admin-tier (เดียวกับ confirm). บันทึก audit. กันข้ามบริษัท. */
export async function matchFloatingSlip(
  paymentId: string,
  expenseId: string,
): Promise<ActionResult> {
  if (!paymentId || !expenseId) return { ok: false, error: "ข้อมูลไม่ครบ" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  const orgId = session.user.org_id;
  if (!(await ledgerWebCanForRole(orgId, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลจับคู่สลิปได้" };
  }

  const payment = await prisma.ledgerPayment.findFirst({
    where: { id: paymentId, orgId },
    select: { id: true, companyId: true, matchedExpenseId: true, amount: true },
  });
  if (!payment) return { ok: false, error: "ไม่พบสลิป" };
  if (payment.matchedExpenseId) return { ok: false, error: "สลิปนี้จับคู่แล้ว" };

  const bill = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId, companyId: payment.companyId },
    select: { id: true, status: true, total: true, paymentStatus: true },
  });
  if (!bill) return { ok: false, error: "ไม่พบบิล (หรือคนละบริษัทกับสลิป)" };
  if (bill.status === "void") return { ok: false, error: "บิลถูกยกเลิกแล้ว" };

  await prisma.$transaction(async (tx) => {
    await tx.ledgerPayment.update({
      where: { id: payment.id },
      data: { matchedExpenseId: bill.id, markedBy: session.user.id },
    });
    await tx.ledgerExpense.updateMany({
      where: { id: bill.id, orgId, companyId: payment.companyId },
      data: { paymentStatus: "paid" },
    });
  });
  await audit({
    orgId,
    userId: session.user.id,
    action: "LEDGER_SLIP_MATCHED",
    resourceType: "ledger_payment",
    resourceId: payment.id,
    diff: { old: { matchedExpenseId: null }, new: { matchedExpenseId: bill.id, paymentStatus: "paid" } },
  });
  revalidatePath("/ledger/reconcile");
  revalidatePath("/ledger/payments");
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Mark a bill paid by CASH (no slip) — accountant action on the web. Records a
 *  cash ledger_payment for the audit trail + flips the bill to paid. */
export async function markBillPaidCash(expenseId: string): Promise<ActionResult> {
  if (!expenseId) return { ok: false, error: "ไม่ได้ระบุบิล" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  const orgId = session.user.org_id;
  if (!(await ledgerWebCanForRole(orgId, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลทำรายการจ่ายได้" };
  }
  const bill = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId },
    select: { id: true, companyId: true, status: true, total: true, paymentStatus: true },
  });
  if (!bill) return { ok: false, error: "ไม่พบบิล" };
  if (bill.status === "void") return { ok: false, error: "บิลถูกยกเลิกแล้ว" };
  if (bill.paymentStatus === "paid") return { ok: true }; // idempotent

  const rec = await recordSlipPayment({
    orgId,
    companyId: bill.companyId,
    matchedExpenseId: bill.id,
    amount: Number(bill.total),
    method: "cash",
    sendingBank: null,
    transRef: null,
    slipSha256: null,
    slipUrl: null,
    qrRaw: null,
    qrDecoded: false,
    markedBy: session.user.id,
  });
  if (!rec.ok) return { ok: false, error: rec.error ?? "บันทึกการจ่ายไม่สำเร็จ" };
  await audit({
    orgId,
    userId: session.user.id,
    action: "LEDGER_BILL_PAID_CASH",
    resourceType: "ledger_expense",
    resourceId: bill.id,
    diff: { old: { paymentStatus: bill.paymentStatus }, new: { paymentStatus: "paid", method: "cash" } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

// ── ดูราคา/ประวัติผู้ขาย (popup ในใบ) — read-only price lookup ────────────────
// กดชิป "ดูราคา" รายสินค้า หรือ "ประวัติผู้ขาย" → ค้นการซื้อย้อนหลัง (ชื่อสินค้า/ผู้ขาย)
// reuse searchPurchases (engine เดียวกับ "สมุดค่าใช้จ่าย"). companyId verify ใน org.
export async function lookupPurchaseHistoryAction(
  term: string,
  companyId: string,
): Promise<{
  ok: boolean;
  hits: Awaited<ReturnType<typeof searchPurchases>>["hits"];
  trend: Awaited<ReturnType<typeof searchPurchases>>["trend"];
  vendorCompare: Awaited<ReturnType<typeof searchPurchases>>["vendorCompare"];
}> {
  const access = await requireLedgerAccess();
  if (!access.ok) return { ok: false, hits: [], trend: [], vendorCompare: [] };
  const orgId = access.session.user.org_id;
  const co = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true },
  });
  if (!co || !term.trim()) return { ok: false, hits: [], trend: [], vendorCompare: [] };
  const actor = await resolveLedgerActor();
  const res = await searchPurchases({
    orgId,
    companyId,
    actorScope: {
      allBranches: actor?.allBranches ?? true,
      scopeBranchIds: actor?.scopeBranchIds ?? [],
    },
    term: term.trim(),
    basis: "net",
    limit: 20,
  });
  return { ok: true, hits: res.hits, trend: res.trend, vendorCompare: res.vendorCompare };
}

// ── ขอโอนเงิน (payment request) — LEDGER_PAYREQ_V1 ───────────────────────────
const zPayee = z.object({
  acctName: z.string().trim().max(120).optional(),
  bankCode: z.string().trim().max(8).optional(),
  acctNo: z.string().trim().max(40).optional(),
  promptpay: z.string().trim().max(40).optional(),
  qrPayload: z.string().trim().max(1024).optional(),
  qrImageUrl: z.string().trim().max(2048).optional(),
});

/** Operation selects bills → "ขอโอนเงิน" → create the request + push the card to
 *  the executive (slip-intake) group. Single-company / classifiable bills only. */
export async function createPaymentRequestAction(
  billIds: string[],
  payeeRaw: unknown,
): Promise<ActionResult & { requestId?: string }> {
  if (!ledgerPayreqV1()) return { ok: false, error: "ระบบขอโอนเงินยังไม่เปิดใช้" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  const orgId = session.user.org_id;
  if (!(await ledgerWebCanForRole(orgId, session.user.role, "payment.request"))) {
    return { ok: false, error: "ไม่มีสิทธิ์ขอโอนเงิน" };
  }
  const ids = Array.isArray(billIds) ? billIds.filter((x) => typeof x === "string") : [];
  const payee = zPayee.safeParse(payeeRaw ?? {});
  if (!payee.success) return { ok: false, error: "ข้อมูลบัญชีผู้รับไม่ถูกต้อง" };

  const res = await createPaymentRequest({
    orgId, billIds: ids, payee: payee.data, requestedBy: session.user.id,
  });
  if (!res.ok || !res.requestId || !res.companyId) {
    return { ok: false, error: res.error ?? "สร้างคำขอโอนไม่สำเร็จ" };
  }

  // Push the request card to the executive (slip-intake) group — best-effort:
  // a LINE outage must not undo the request that's already in the DB.
  try {
    const billRows = await prisma.ledgerExpense.findMany({
      where: { id: { in: ids }, orgId, companyId: res.companyId },
      select: { docCode: true, total: true, originalUrl: true, thumbUrl: true },
    });
    // First bill with an attached image → "ดูรูปที่แนบ" button (a plain R2 https URL that
    // opens in LINE's in-app browser; the full detail page lists every bill's image).
    const receiptUrl =
      billRows.map((b) => b.originalUrl ?? b.thumbUrl).find((u): u is string => !!u) ?? null;
    // LIFF deep-link to the SPECIFIC request detail. The ledger LIFF endpoint is a
    // sub-path (/liff/ledger), so the concatenation form liff.line.me/{id}/payreq/X
    // does NOT work — LINE buries the sub-path in ?liff.state and the bootstrap drops
    // the exec on the capture page (CEO 2026-06-08 "กดแล้วไปหน้าแนบใบเสร็จมั่ว"). Use the
    // proven ?next= pattern (same as the edit button) so LiffBootstrap navigates after
    // login → lands on the matching bill. See [[line-liff-deeplink-concatenate-rule]].
    const liffId = process.env.NEXT_PUBLIC_LEDGER_LIFF_ID;
    const detailPath = `/liff/ledger/payreq/${encodeURIComponent(res.requestId)}`;
    const detailUrl = liffId
      ? `https://liff.line.me/${liffId}?next=${encodeURIComponent(detailPath)}`
      : null;
    const card = buildPaymentRequestCard({
      vendor: res.vendor ?? null,
      billsGross: res.billsGross ?? 0,
      whtTotal: res.whtTotal ?? 0,
      expectedTransfer: res.expectedTransfer ?? 0,
      payee: payee.data,
      bills: billRows.map((b) => ({ docCode: b.docCode, amount: Number(b.total) })),
      detailUrl,
      receiptUrl,
    });
    const push = await pushFlexToSlipGroup(orgId, res.companyId, card);
    if (push.ok) {
      await prisma.ledgerPaymentRequest
        .update({
          where: { id: res.requestId },
          data: { pushedGroupId: push.groupId ?? null, pushedMessageId: push.messageId ?? null },
        })
        .catch(() => {});
    }
  } catch (e) {
    console.error("[ledger:createPaymentRequestAction] push failed", e);
  }

  await audit({
    orgId, userId: session.user.id,
    action: "LEDGER_PAYMENT_REQUESTED",
    resourceType: "ledger_payment_request",
    resourceId: res.requestId,
    diff: { new: { vendor: res.vendor, expectedTransfer: res.expectedTransfer, billCount: res.billCount } },
  });
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger/reconcile");
  return { ok: true, requestId: res.requestId };
}

/** Cancel a request before pay (releases the per-bill guard). Requester or accountant. */
export async function cancelPaymentRequestAction(requestId: string): Promise<ActionResult> {
  if (!requestId) return { ok: false, error: "ไม่ได้ระบุคำขอ" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  const orgId = session.user.org_id;
  const req = await prisma.ledgerPaymentRequest.findFirst({
    where: { id: requestId, orgId },
    select: { id: true, companyId: true, requestedBy: true, vendor: true },
  });
  if (!req) return { ok: false, error: "ไม่พบคำขอโอน" };
  const isOwner = req.requestedBy === session.user.id;
  if (!isOwner && !(await ledgerWebCanForRole(orgId, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะผู้ขอ หรือบัญชี/ผู้ดูแล ยกเลิกได้" };
  }
  const res = await cancelPaymentRequest({
    orgId, companyId: req.companyId, requestId, cancelledBy: session.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };
  await pushTextToSlipGroup(
    orgId, req.companyId,
    `🚫 ยกเลิกคำขอโอน${req.vendor ? ` ${req.vendor}` : ""} แล้ว — ยังไม่ต้องโอนนะครับ`,
  ).catch(() => {});
  await audit({
    orgId, userId: session.user.id,
    action: "LEDGER_PAYMENT_REQ_CANCELLED",
    resourceType: "ledger_payment_request", resourceId: requestId,
  });
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger/reconcile");
  return { ok: true };
}

/** Accountant manually pairs a floating slip to an open request (reconcile safety net). */
export async function assignSlipToRequestAction(
  paymentId: string,
  requestId: string,
): Promise<ActionResult> {
  if (!paymentId || !requestId) return { ok: false, error: "ข้อมูลไม่ครบ" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  const orgId = session.user.org_id;
  if (!(await ledgerWebCanForRole(orgId, session.user.role, "expense.confirm"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลจับคู่สลิปได้" };
  }
  const payment = await prisma.ledgerPayment.findFirst({
    where: { id: paymentId, orgId },
    select: { companyId: true },
  });
  if (!payment) return { ok: false, error: "ไม่พบสลิป" };
  const res = await assignSlipToRequest({
    orgId, companyId: payment.companyId, paymentId, requestId, markedBy: session.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };
  await audit({
    orgId, userId: session.user.id,
    action: "LEDGER_SLIP_ASSIGNED_REQUEST",
    resourceType: "ledger_payment", resourceId: paymentId,
    diff: { new: { paymentRequestId: requestId } },
  });
  revalidatePath("/ledger/reconcile");
  return { ok: true };
}

/** Autofill (audit P1) — the payee last used for this vendor (so ops/exec don't
 *  re-type the account number every time → fewer wrong-account transfers). Reads the
 *  most-recent request's payee snapshot; falls back to the bill's free-text bankDetail. */
export async function lastPayeeForVendor(
  vendor: string,
  companyId: string,
): Promise<{ acctName?: string | null; bankCode?: string | null; acctNo?: string | null; promptpay?: string | null } | null> {
  const access = await requireLedgerAccess();
  if (!access.ok) return null;
  const { session } = access;
  const orgId = session.user.org_id;
  const v = (vendor ?? "").trim();
  if (!v || !companyId) return null;
  const last = await prisma.ledgerPaymentRequest.findFirst({
    where: { orgId, companyId, vendor: v, payeeAcctNo: { not: null } },
    orderBy: { requestedAt: "desc" },
    select: { payeeAcctName: true, payeeBankCode: true, payeeAcctNo: true, payeePromptpay: true },
  });
  if (last) {
    return {
      acctName: last.payeeAcctName,
      bankCode: last.payeeBankCode,
      acctNo: last.payeeAcctNo,
      promptpay: last.payeePromptpay,
    };
  }
  // Fallback — the most recent bill's bankDetail free-text (surface as an acctNo hint).
  const bill = await prisma.ledgerExpense.findFirst({
    where: { orgId, companyId, vendor: v, bankDetail: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { bankDetail: true },
  });
  if (bill?.bankDetail) return { acctNo: bill.bankDetail };
  return null;
}

// ── Permission matrix (GAP 5 · LIFF "สิทธิ์" tab) ────────────────────────────
/** Admin toggles one money-capability for a role. Single source of truth via
 *  lib/ledger/permissions.can(); every money action consults it. Admin-tier. */
export async function setLedgerPermission(
  role: string,
  capability: string,
  allowed: boolean,
): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลตั้งสิทธิ์ได้" };
  }
  if (!isLedgerRole(role) || !isLedgerCapability(capability)) {
    return { ok: false, error: "สิทธิ์ไม่ถูกต้อง" };
  }
  // ผู้ดูแลห้ามปิดสิทธิ์ของตัวเอง (กันล็อกตัวเองออก) — admin คงเปิดเสมอ
  if (role === "admin" && !allowed) {
    return { ok: false, error: "ปิดสิทธิ์ของผู้ดูแลไม่ได้" };
  }
  await setPermission({
    orgId: session.user.org_id,
    role,
    capability,
    allowed,
    updatedBy: session.user.id,
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_PERMISSION_UPDATED",
    resourceType: "ledger_permission",
    diff: { new: { role, capability, allowed } },
  });
  revalidatePath("/ledger/settings");
  revalidatePath("/liff/ledger/admin");
  return { ok: true };
}

// ── Branch CRUD (GAP 5 · LIFF "สาขา" tab) ───────────────────────────────────
// NOTE: Branch is a SHARED Pool core entity (chairops/clawfleet/fuel use it too).
// Adding/editing here touches all modules — the UI shows a clear warning. Admin-tier.
const branchCreateSchema = z.object({
  companyId: z.string().trim().min(1, "ไม่ได้ระบุบริษัท"),
  code: z.string().trim().min(1, "ใส่รหัสสาขา").max(40),
  name: z.string().trim().min(1, "ใส่ชื่อสาขา").max(120),
  province: z.string().trim().max(80).optional().or(z.literal("")),
  // Branch is a shared Pool entity → it needs a business type (drives module nav).
  businessType: z.enum([
    "fuel_station", "lpg_station", "lpg_retail", "bottling_plant", "hotel",
    "convenience_store", "ev_station", "cafe", "cafe_punthai", "massage_chair",
    "claw_machine", "training_center", "transport", "gas_fleet",
  ]),
});

export async function createLedgerBranch(raw: unknown): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลเพิ่มสาขาได้" };
  }
  const parsed = branchCreateSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { companyId, code, name, province, businessType } = parsed.data;
  const orgId = session.user.org_id;

  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  try {
    const branch = await prisma.branch.create({
      data: { orgId, companyId, code, name, province: province || null, businessType },
      select: { id: true },
    });
    await audit({
      orgId,
      userId: session.user.id,
      action: "LEDGER_BRANCH_UPDATED",
      resourceType: "branch",
      resourceId: branch.id,
      diff: { new: { created: true, code, name } },
    });
  } catch {
    // @@unique([orgId, code]) → duplicate code anywhere in the org.
    return { ok: false, error: `รหัสสาขา "${code}" ถูกใช้แล้วในองค์กรนี้` };
  }
  revalidatePath("/liff/ledger/admin");
  revalidatePath("/ledger/settings");
  return { ok: true };
}

const branchUpdateSchema = z.object({
  name: z.string().trim().min(1, "ใส่ชื่อสาขา").max(120),
  province: z.string().trim().max(80).optional().or(z.literal("")),
  isActive: z.boolean(),
});

export async function updateLedgerBranch(
  branchId: string,
  raw: unknown,
): Promise<ActionResult> {
  if (!branchId) return { ok: false, error: "ไม่ได้ระบุสาขา" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลแก้สาขาได้" };
  }
  const parsed = branchUpdateSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { name, province, isActive } = parsed.data;

  const res = await prisma.branch.updateMany({
    where: { id: branchId, orgId: session.user.org_id },
    data: { name, province: province || null, isActive },
  });
  if (res.count === 0) return { ok: false, error: "ไม่พบสาขา" };
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_BRANCH_UPDATED",
    resourceType: "branch",
    resourceId: branchId,
    diff: { new: { name, isActive } },
  });
  revalidatePath("/liff/ledger/admin");
  revalidatePath("/ledger/settings");
  return { ok: true };
}

// ── Central "office" branch (D1 fallback) ───────────────────────────────────
// CEO: "ถ้าไม่รู้สาขา ก็ต้องระบุเป็นค่าใช้จ่ายสำนักงาน". The confirm-gate refuses a
// blank branch, so the UI offers a deliberate "สำนักงาน (ส่วนกลาง)" option that
// resolves to THIS branch. find-or-create is idempotent + ADDITIVE (never renames
// or deletes — Branch is a SHARED Pool entity read by ChairOps/ClawFleet/Fuel).
// Matched by the stable code OFFICE-CENTRAL (unique per org via @@unique(orgId,code)).
const CENTRAL_BRANCH_CODE = "OFFICE-CENTRAL";
const CENTRAL_BRANCH_NAME = "สำนักงาน (ส่วนกลาง)";

/**
 * Idempotently return the company's central-office branchId, creating an isActive
 * Branch named "สำนักงาน (ส่วนกลาง)" the first time. Invoked ONLY when the user
 * deliberately picks the central option (NOT silently auto-filled). Caller must
 * have already established org+company scope; companyId is validated as belonging
 * to the actor's org. businessType=training_center = the least-operational generic
 * type (not a kiosk/station, so it stays out of fuel/chair/claw module nav).
 */
export async function ensureCentralBranch(companyId: string): Promise<ActionResult & { branchId?: string }> {
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  const orgId = session.user.org_id;

  // Validate the company belongs to the caller's org before touching shared Branch.
  const company = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true },
  });
  if (!company) return { ok: false, error: "ไม่พบบริษัท" };

  // Branch code is org-UNIQUE (@@unique([orgId, code])), but each company in the org
  // needs its OWN central office. So suffix the code with a company fragment — two
  // companies never collide on "OFFICE-CENTRAL" and the race-recovery lookup below
  // resolves to the RIGHT company's row.
  const centralCode = `${CENTRAL_BRANCH_CODE}-${companyId.slice(0, 8)}`;

  // Already exists? (match by company-scoped name OR the per-company code).
  const existing = await prisma.branch.findFirst({
    where: {
      orgId,
      companyId,
      OR: [{ code: centralCode }, { name: CENTRAL_BRANCH_NAME }],
    },
    select: { id: true, isActive: true },
  });
  if (existing) {
    // Additive only — re-activate if someone deactivated it, never rename/delete.
    if (!existing.isActive) {
      await prisma.branch.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return { ok: true, branchId: existing.id };
  }

  try {
    const branch = await prisma.branch.create({
      data: {
        orgId,
        companyId,
        code: centralCode,
        name: CENTRAL_BRANCH_NAME,
        businessType: "training_center",
        isActive: true,
      },
      select: { id: true },
    });
    await audit({
      orgId,
      userId: session.user.id,
      action: "LEDGER_BRANCH_UPDATED",
      resourceType: "branch",
      resourceId: branch.id,
      diff: { new: { created: true, central: true, code: centralCode } },
    });
    revalidatePath("/ledger/expenses");
    revalidatePath("/ledger/settings");
    return { ok: true, branchId: branch.id };
  } catch {
    // Race: a concurrent call created it between our read and create (@@unique).
    // Look up by the per-company code so we never hand back another company's branch.
    const raced = await prisma.branch.findFirst({
      where: { orgId, companyId, code: centralCode },
      select: { id: true },
    });
    if (raced) return { ok: true, branchId: raced.id };
    return { ok: false, error: "สร้างสาขาสำนักงานไม่สำเร็จ" };
  }
}

// ── Delete a draft (D2) ─────────────────────────────────────────────────────
// NEVER hard-delete an expense (soft void only). Two paths:
//   selfDeleteExpense    — the creator pulls back their OWN fresh draft (<5 min,
//                          not yet pushed to TRCloud) → soft void. Self-service.
//   requestDeleteExpense — anything else (>5 min · not owner · not draft) → does
//                          NOT delete; pings the office accountants/admins on LINE
//                          to do it. Informal — no approval queue, no new table.

const SELF_DELETE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Soft-void a fresh draft you created yourself (D2 self-delete). companyId-scoped. */
export async function selfDeleteExpense(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ไม่ได้ระบุรายการ" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;

  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId: session.user.org_id },
    select: {
      id: true,
      companyId: true,
      status: true,
      createdBy: true,
      createdAt: true,
      trcloudDocId: true,
    },
  });
  if (!row) return { ok: false, error: "ไม่พบรายการ" };

  // ALL conditions must hold — else route the user to requestDeleteExpense.
  if (row.createdBy !== session.user.id)
    return { ok: false, error: "ลบได้เฉพาะรายการที่คุณสร้างเอง · แจ้งบัญชีให้ลบแทน" };
  if (row.status !== "draft")
    return { ok: false, error: "ยืนยันแล้วลบเองไม่ได้ · แจ้งบัญชีให้ยกเลิกแทน" };
  if (row.trcloudDocId)
    return { ok: false, error: "ส่งเข้าระบบบัญชีแล้วลบเองไม่ได้ · แจ้งบัญชี" };
  // Server-side clock — never trust a client timestamp for the window.
  if (Date.now() - row.createdAt.getTime() >= SELF_DELETE_WINDOW_MS)
    return { ok: false, error: "เกิน 5 นาทีแล้ว ลบเองไม่ได้ · แจ้งบัญชีให้ลบแทน" };
  if (await billInActiveRequest(session.user.org_id, row.companyId, id))
    return { ok: false, error: IN_ACTIVE_REQUEST_MSG };

  // Soft delete = void (reuse the same void semantics; the row stays visible).
  await prisma.ledgerExpense.updateMany({
    where: { id, orgId: session.user.org_id, companyId: row.companyId },
    data: { status: "void", needsReview: false },
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_VOIDED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { old: { status: row.status }, new: { status: "void", via: "self_delete" } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Ask the office to delete a row you CAN'T self-void (D2). Sends a LINE ping to
 *  the company's ledger admins/accountants — NO approval queue, NO new table. */
export async function requestDeleteExpense(
  id: string,
  reason?: string,
): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ไม่ได้ระบุรายการ" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;

  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId: session.user.org_id },
    select: { id: true, companyId: true, docCode: true, vendor: true, status: true },
  });
  if (!row) return { ok: false, error: "ไม่พบรายการ" };

  const cleanReason = (reason ?? "").trim().slice(0, 300);
  const who = session.user.name || session.user.email || "ผู้ใช้";
  const text =
    `🗑️ ขอให้ลบรายจ่าย\n` +
    `เอกสาร: ${row.docCode}${row.vendor ? ` · ${row.vendor}` : ""}\n` +
    `ผู้ขอ: ${who}\n` +
    (cleanReason ? `เหตุผล: ${cleanReason}` : `เหตุผล: (ไม่ได้ระบุ)`) +
    `\nกรุณาตรวจและกดยกเลิกให้ในเมนู “รายจ่าย”`;

  // Best-effort LINE ping → the company's ledger admins/accountants (verified
  // LINE members). Decrypt the channel token; push to each admin/accountant userId.
  let notified = 0;
  try {
    const channel = await prisma.ledgerLineChannel.findFirst({
      where: { orgId: session.user.org_id, companyId: row.companyId, active: true },
      select: { accessTokenEnc: true },
    });
    const accessToken = channel?.accessTokenEnc ? decryptToken(channel.accessTokenEnc) : null;
    if (accessToken) {
      const recipients = await prisma.ledgerLineMember.findMany({
        where: {
          orgId: session.user.org_id,
          companyId: row.companyId,
          active: true,
          role: { in: ["admin", "accountant"] },
        },
        select: { lineUserId: true },
      });
      const seen = new Set<string>();
      for (const r of recipients) {
        if (!r.lineUserId || seen.has(r.lineUserId)) continue;
        seen.add(r.lineUserId);
        const ok = await pushLedgerLineText(accessToken, r.lineUserId, text);
        if (ok) notified++;
      }
    }
  } catch {
    // Swallow — the request is informal; never fail the user's click on a push error.
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_UPDATED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { new: { deleteRequested: true, notified, reason: cleanReason || null } },
  });

  // Always ok from the user's side — they've asked; the office will action it.
  return notified > 0
    ? { ok: true }
    : { ok: true, error: "ส่งคำขอแล้ว แต่ยังไม่ได้เชื่อม LINE บัญชี — แจ้งออฟฟิศโดยตรงด้วยนะ" };
}

/** Best-effort plain-text LINE push to one userId. Returns true on 2xx. */
async function pushLedgerLineText(
  accessToken: string,
  to: string,
  text: string,
): Promise<boolean> {
  const safe = text.length > 4900 ? text.slice(0, 4900) + "…" : text;
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text: safe }] }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Org/Company info (GAP 5 · LIFF "องค์กร" tab) ─────────────────────────────
const orgInfoSchema = z.object({
  companyId: z.string().trim().min(1, "ไม่ได้ระบุบริษัท"),
  name: z.string().trim().min(1, "ใส่ชื่อบริษัท").max(200),
  taxId: z.string().trim().max(20).optional().or(z.literal("")),
  address: z.string().trim().max(400).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function updateLedgerOrgInfo(raw: unknown): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAdminTier(session.user.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลแก้ข้อมูลบริษัทได้" };
  }
  const parsed = orgInfoSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { companyId, name, taxId, address, phone } = parsed.data;

  const res = await prisma.company.updateMany({
    where: { id: companyId, orgId: session.user.org_id },
    data: {
      name,
      taxId: taxId || null,
      address: address || null,
      phone: phone || null,
    },
  });
  if (res.count === 0) return { ok: false, error: "ไม่พบบริษัท" };
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_ORG_UPDATED",
    resourceType: "company",
    resourceId: companyId,
    diff: { new: { name, taxIdSet: !!taxId } },
  });
  revalidatePath("/liff/ledger/admin");
  revalidatePath("/ledger/settings");
  return { ok: true };
}

/**
 * ปุ่มเดียว "เพิ่มค่าใช้จ่ายไม่มีใบเสร็จ" — สร้างใบร่างแบบไม่มีรูป + เก็บเหตุผลไว้ใน note
 * (ใช้ pre-fill ตอนออกใบรับรองแทนใบเสร็จ/SUB หลังบัญชียืนยัน). ใช้ createDraftExpense
 * (session-bound + module-grant gate เดิม ไม่แตะ); ทุกใบเป็น draft (golden rule).
 */
export async function createNoReceiptExpense(input: {
  companyId: string;
  vendor: string;
  total: number;
  reason: string;
  categoryId?: string | null;
  branchId?: string | null;
  docDate?: string | null;
}): Promise<{ ok: true; id: string; docCode: string } | { ok: false; error: string }> {
  const vendor = input.vendor?.trim();
  const reason = input.reason?.trim();
  if (!vendor) return { ok: false, error: "กรุณาระบุชื่อร้าน/ผู้รับเงิน" };
  if (!(input.total > 0)) return { ok: false, error: "กรุณาระบุยอดเงินมากกว่า 0" };
  if (!reason || reason.length < 3) {
    return { ok: false, error: "กรุณาระบุเหตุผลที่ไม่มีใบเสร็จ (อย่างน้อย 3 ตัวอักษร)" };
  }

  const res = await createDraftExpense({
    companyId: input.companyId,
    source: "web",
    vendor,
    total: input.total,
    subtotal: input.total,
    vat: 0,
    categoryId: input.categoryId ?? null,
    branchId: input.branchId ?? null,
    docDate: input.docDate ?? null,
    docType: "other",
    paymentStatus: "paid",
    note: `[ไม่มีใบเสร็จ] ${reason}`,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/ledger/expenses");
  return { ok: true, id: res.data.id, docCode: res.data.docCode };
}
