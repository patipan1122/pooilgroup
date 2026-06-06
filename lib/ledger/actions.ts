"use server";

// LedgerLine — server actions (mutations).
//
// GOLDEN RULE: NEVER auto-post. Every expense is created status="draft".
// Only an explicit human confirm (accountant) flips it to "confirmed", which
// stamps confirmed_by / confirmed_at and writes a LEDGER_EXPENSE_CONFIRMED
// audit row. confirmed/locked rows are immutable except by accountants.
//
// Every action:
//   - resolves the session (org scope from session.user.org_id),
//   - scopes writes by org_id + company_id (RLS is the backstop),
//   - records an audit() entry.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { audit } from "@/lib/audit/log";
import type { DbUser } from "@/lib/auth/session";
import { recheckReceipt, gradeCompleteness } from "./recheck";
import { OUR_BUYER } from "./group-identity";
import { serializeExpense } from "./queries";
import type {
  ExpenseAttachment,
  ExpenseDocType,
  ExpenseItem,
  ExpenseSource,
  FieldConfidence,
  PaymentStatus,
} from "./types";
import type { Prisma } from "@/lib/generated/prisma/client";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

/** Accountant tier = admin tiers + viewer (UserRole "viewer" = accountant/HR). */
function isAccountant(role: DbUser["role"]): boolean {
  return isAdminTier(role) || role === "viewer";
}

async function assertCompanyInOrg(orgId: string, companyId: string): Promise<boolean> {
  const c = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true },
  });
  return !!c;
}

async function nextDocCode(orgId: string, companyId: string): Promise<string> {
  // RPC (SECURITY DEFINER) does the per-company monthly counter atomically.
  const admin = adminClient();
  const { data, error } = await admin.rpc("ledger_next_doc_code", {
    p_org: orgId,
    p_company: companyId,
  });
  if (error || !data) {
    // Fallback: timestamp-based code so a draft is never blocked by RPC issues.
    const ym = new Date().toISOString().slice(0, 7).replace("-", "");
    return `EXP-${ym}-${Date.now().toString().slice(-4)}`;
  }
  return data as string;
}

export interface CreateDraftInput {
  companyId: string;
  branchId?: string | null;
  source?: ExpenseSource;
  vendor?: string | null;
  vendorTaxId?: string | null;
  /** เลขภาษีผู้ซื้อที่ OCR อ่านได้บนใบ (13 หลัก หรือ null) — ส่งต่อจาก parsed. */
  buyerTaxIdOnDoc?: string | null;
  /** OCR raw text (optional) — ใช้ heuristic ใบกำกับอย่างย่อ ม.86/6. */
  rawText?: string | null;
  docDate?: string | null; // YYYY-MM-DD
  subtotal?: number;
  vat?: number;
  wht?: number;
  total?: number;
  categoryId?: string | null;
  paymentMethod?: string | null;
  originalUrl?: string | null;
  thumbUrl?: string | null;
  sha256?: string | null;
  ocrModel?: string | null;
  ocrConfidence?: FieldConfidence | null;
  note?: string | null;
  items?: ExpenseItem[];
  // — Bainy-parity fields —
  docType?: ExpenseDocType;
  vendorDocNumber?: string | null;
  vendorAddress?: string | null;
  vendorBranchCode?: string | null;
  discount?: number;
  paymentStatus?: PaymentStatus;
  claimantName?: string | null;
  bankDetail?: string | null;
  isRecurring?: boolean;
  attachments?: ExpenseAttachment[] | null;
  /** groups several receipts sent together → ONE LINE summary carousel. */
  captureBatchId?: string | null;
  /** override the created_by user (e.g. LINE webhook ingest on behalf of staff). */
  createdById?: string | null;
}

/**
 * Create a DRAFT expense (status=draft, never posted). Runs recheck() to set
 * needs_review. Dedups by sha256 within the tenant — a repeated image returns
 * the existing draft instead of creating a duplicate.
 *
 * Session-bound: org scope comes from the caller's session; non-admin callers
 * must hold the `ledger` module grant. For server-to-server ingest (LINE
 * webhook) use createDraftExpenseSystem, which takes a trusted orgId instead.
 */
export async function createDraftExpense(
  input: CreateDraftInput,
): Promise<Result<{ id: string; docCode: string; duplicate: boolean }>> {
  let orgId: string;
  let userId: string | null;
  try {
    const session = await requireSession();
    orgId = session.user.org_id;
    userId = input.createdById ?? session.user.id;
    if (!isAdminTier(session.user.role)) {
      const ok = await userHasModuleAccess(session.user, "ledger");
      if (!ok) return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
    }
  } catch {
    return { ok: false, error: "unauthorized" };
  }

  return createDraftExpenseCore(orgId, userId, input);
}

/**
 * Session-less ingest path for system/webhook callers (e.g. the LedgerLine LINE
 * webhook, which has no Pool session cookie). The caller MUST pass an orgId that
 * was derived from a TRUSTED row (the ledger_line_channel record), never from
 * user input. We still:
 *   - verify the company belongs to that org (assertCompanyInOrg),
 *   - force status=draft (GOLDEN RULE — never auto-post),
 *   - dedup by sha256 within the tenant,
 *   - write a LEDGER_EXPENSE_CREATED audit row (userId=null → "system").
 * createdById defaults to null (system) so the draft shows as machine-ingested
 * until an accountant confirms it in the web review pane.
 */
export async function createDraftExpenseSystem(
  orgId: string,
  input: CreateDraftInput,
): Promise<Result<{ id: string; docCode: string; duplicate: boolean }>> {
  if (!orgId) return { ok: false, error: "missing-org" };
  return createDraftExpenseCore(orgId, input.createdById ?? null, input);
}

/**
 * Shared insert core. orgId is the ALREADY-AUTHORIZED tenant scope (from a
 * session OR a trusted channel row); this function never reads the session, so
 * every write is bound to the org passed in. Company is re-checked against that
 * org so a caller can't smuggle a foreign company id.
 */
async function createDraftExpenseCore(
  orgId: string,
  userId: string | null,
  input: CreateDraftInput,
): Promise<Result<{ id: string; docCode: string; duplicate: boolean }>> {
  if (!(await assertCompanyInOrg(orgId, input.companyId))) {
    return { ok: false, error: "ไม่พบบริษัทใน org นี้" };
  }

  // Dedup by image hash.
  if (input.sha256) {
    const existing = await prisma.ledgerExpense.findFirst({
      where: { orgId, companyId: input.companyId, sha256: input.sha256 },
      select: { id: true, docCode: true },
    });
    if (existing) {
      return {
        ok: true,
        data: { id: existing.id, docCode: existing.docCode, duplicate: true },
      };
    }
  }

  const recheck = recheckReceipt({
    vendorTaxId: input.vendorTaxId,
    subtotal: input.subtotal,
    discount: input.discount,
    vat: input.vat,
    wht: input.wht,
    total: input.total,
    items: input.items,
  });

  // — Input-VAT completeness (ภาษีซื้อ) — deterministic grade beside recheck.
  //   buyer snapshot = master (เจพีซิ้งค์ OUR_BUYER), ตัดสินด้วยเลขภาษี 13 หลัก.
  const grade = gradeCompleteness({
    docType: input.docType,
    vendor: input.vendor,
    vendorTaxId: input.vendorTaxId,
    vendorAddress: input.vendorAddress,
    vendorBranchCode: input.vendorBranchCode,
    subtotal: input.subtotal,
    vat: input.vat,
    total: input.total,
    buyerTaxIdOnDoc: input.buyerTaxIdOnDoc,
    rawText: input.rawText,
  });

  const docCode = await nextDocCode(orgId, input.companyId);

  try {
    const created = await prisma.ledgerExpense.create({
      data: {
        orgId,
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        docCode,
        status: "draft", // GOLDEN RULE — never auto-post
        source: input.source ?? "web",
        vendor: input.vendor ?? null,
        vendorTaxId: input.vendorTaxId ?? null,
        docDate: input.docDate ? new Date(input.docDate) : null,
        subtotal: input.subtotal ?? 0,
        vat: input.vat ?? 0,
        wht: input.wht ?? 0,
        total: input.total ?? 0,
        categoryId: input.categoryId ?? null,
        paymentMethod: input.paymentMethod ?? null,
        docType: input.docType ?? "tax_invoice",
        vendorDocNumber: input.vendorDocNumber ?? null,
        vendorAddress: input.vendorAddress ?? null,
        vendorBranchCode: input.vendorBranchCode ?? null,
        discount: input.discount ?? 0,
        // D-NEW-1: ใบเสนอราคา/บิลที่ยังไม่จ่าย → "unpaid" (รอสลิป); ใบเสร็จ/ใบกำกับ = จ่ายแล้ว
        paymentStatus: input.paymentStatus ?? (input.docType === "quotation" ? "unpaid" : "paid"),
        claimantName: input.claimantName ?? null,
        bankDetail: input.bankDetail ?? null,
        isRecurring: input.isRecurring ?? false,
        attachments: (input.attachments ?? undefined) as Prisma.InputJsonValue | undefined,
        captureBatchId: input.captureBatchId ?? null,
        originalUrl: input.originalUrl ?? null,
        thumbUrl: input.thumbUrl ?? null,
        sha256: input.sha256 ?? null,
        ocrModel: input.ocrModel ?? null,
        ocrConfidence: input.ocrConfidence ?? undefined,
        needsReview: !recheck.ok,
        note: input.note ?? null,
        createdBy: userId,
        // — Input-VAT claimability (ภาษีซื้อ) — สถานะสี + buyer snapshot + ผลตรวจ —
        buyerTaxIdSnapshot: OUR_BUYER.taxId,
        buyerNameSnapshot: OUR_BUYER.name,
        buyerTaxIdOnDoc: input.buyerTaxIdOnDoc ?? null,
        buyerMatchStatus: grade.buyerMatch,
        completenessStatus: grade.status,
        completenessMissing: grade.missing as unknown as Prisma.InputJsonValue,
        completenessCheckedAt: new Date(),
        inputVatBlockReason: grade.blockReason,
        // claimable: เขียว → true · อื่น → null (ยังไม่ตัดสิน · นักบัญชี override ได้)
        inputVatClaimable: grade.suggestedClaimable ? true : null,
        items:
          input.items && input.items.length > 0
            ? {
                create: input.items.map((it) => ({
                  orgId,
                  companyId: input.companyId,
                  description: it.description,
                  qty: it.qty,
                  unitPrice: it.unitPrice,
                  amount: it.amount,
                  vatRate: it.vatRate ?? null,
                })),
              }
            : undefined,
      },
      select: { id: true, docCode: true },
    });

    await audit({
      orgId,
      userId,
      action: "LEDGER_EXPENSE_CREATED",
      resourceType: "ledger_expense",
      resourceId: created.id,
      diff: { new: { docCode: created.docCode, status: "draft", source: input.source ?? "web", needsReview: !recheck.ok } },
    });

    revalidatePath("/ledger/expenses");
    return { ok: true, data: { id: created.id, docCode: created.docCode, duplicate: false } };
  } catch (err) {
    // Concurrent-dedup guard: the findFirst above is best-effort; the DB partial
    // unique index (org_id, company_id, sha256) is the real backstop. If two
    // uploads of the SAME image race (double-click / LIFF + webhook), one create
    // wins and the loser hits P2002 here. Re-read the winning row and return it
    // as a duplicate — same shape as the findFirst path — so we never double-post.
    const code =
      typeof err === "object" && err !== null
        ? (err as { code?: string }).code
        : undefined;
    if (code === "P2002" && input.sha256) {
      const existing = await prisma.ledgerExpense.findFirst({
        where: { orgId, companyId: input.companyId, sha256: input.sha256 },
        select: { id: true, docCode: true },
      });
      if (existing) {
        return {
          ok: true,
          data: { id: existing.id, docCode: existing.docCode, duplicate: true },
        };
      }
    }
    console.error("[ledger:createDraftExpense] failed", err);
    return { ok: false, error: "บันทึกร่างไม่สำเร็จ" };
  }
}

export interface UpdateExpenseInput {
  id: string;
  companyId: string;
  vendor?: string | null;
  vendorTaxId?: string | null;
  docDate?: string | null;
  subtotal?: number;
  vat?: number;
  wht?: number;
  total?: number;
  categoryId?: string | null;
  paymentMethod?: string | null;
  note?: string | null;
  branchId?: string | null;
  items?: ExpenseItem[]; // when provided, replaces existing items
  // — Bainy-parity fields —
  docType?: ExpenseDocType;
  vendorDocNumber?: string | null;
  vendorAddress?: string | null;
  vendorBranchCode?: string | null;
  discount?: number;
  paymentStatus?: PaymentStatus;
  claimantName?: string | null;
  bankDetail?: string | null;
  isRecurring?: boolean;
  attachments?: ExpenseAttachment[] | null;
}

/**
 * Edit an expense's fields. Drafts are editable by any module member; once
 * confirmed/locked, only accountants may edit (and never a "void" row).
 */
export async function updateExpense(
  input: UpdateExpenseInput,
): Promise<Result> {
  let orgId: string;
  let user: DbUser;
  try {
    const session = await requireSession();
    orgId = session.user.org_id;
    user = session.user;
    if (!isAdminTier(user.role)) {
      const ok = await userHasModuleAccess(user, "ledger");
      if (!ok) return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
    }
  } catch {
    return { ok: false, error: "unauthorized" };
  }

  const existing = await prisma.ledgerExpense.findFirst({
    where: { id: input.id, orgId, companyId: input.companyId },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการ" };
  if (existing.status === "void") return { ok: false, error: "รายการถูกยกเลิกแล้ว แก้ไขไม่ได้" };
  if (existing.status !== "draft" && !isAccountant(user.role)) {
    return { ok: false, error: "รายการยืนยันแล้ว · เฉพาะบัญชีแก้ได้" };
  }
  if (existing.status === "locked") {
    return { ok: false, error: "ปิดงวด/export แล้ว แก้ไขไม่ได้" };
  }

  // Re-run recheck on the merged numbers to keep needs_review accurate.
  const recheck = recheckReceipt({
    vendorTaxId: input.vendorTaxId,
    subtotal: input.subtotal,
    discount: input.discount,
    vat: input.vat,
    wht: input.wht,
    total: input.total,
    items: input.items,
  });

  try {
    await prisma.$transaction(async (tx) => {
      if (input.items) {
        await tx.ledgerExpenseItem.deleteMany({ where: { expenseId: input.id } });
      }
      await tx.ledgerExpense.update({
        where: { id: input.id },
        data: {
          vendor: input.vendor ?? undefined,
          vendorTaxId: input.vendorTaxId ?? undefined,
          docDate: input.docDate ? new Date(input.docDate) : undefined,
          subtotal: input.subtotal ?? undefined,
          vat: input.vat ?? undefined,
          wht: input.wht ?? undefined,
          total: input.total ?? undefined,
          categoryId: input.categoryId === undefined ? undefined : input.categoryId,
          paymentMethod: input.paymentMethod ?? undefined,
          note: input.note ?? undefined,
          branchId: input.branchId === undefined ? undefined : input.branchId,
          docType: input.docType ?? undefined,
          vendorDocNumber: input.vendorDocNumber === undefined ? undefined : input.vendorDocNumber,
          vendorAddress: input.vendorAddress === undefined ? undefined : input.vendorAddress,
          vendorBranchCode: input.vendorBranchCode === undefined ? undefined : input.vendorBranchCode,
          discount: input.discount ?? undefined,
          paymentStatus: input.paymentStatus ?? undefined,
          claimantName: input.claimantName === undefined ? undefined : input.claimantName,
          bankDetail: input.bankDetail === undefined ? undefined : input.bankDetail,
          isRecurring: input.isRecurring ?? undefined,
          attachments:
            input.attachments === undefined
              ? undefined
              : ((input.attachments ?? []) as unknown as Prisma.InputJsonValue),
          needsReview: input.items || input.subtotal != null || input.total != null ? !recheck.ok : undefined,
          items:
            input.items && input.items.length > 0
              ? {
                  create: input.items.map((it) => ({
                    orgId,
                    companyId: input.companyId,
                    description: it.description,
                    qty: it.qty,
                    unitPrice: it.unitPrice,
                    amount: it.amount,
                    vatRate: it.vatRate ?? null,
                  })),
                }
              : undefined,
        },
      });
    });

    await audit({
      orgId,
      userId: user.id,
      action: "LEDGER_EXPENSE_UPDATED",
      resourceType: "ledger_expense",
      resourceId: input.id,
      diff: { new: { vendor: input.vendor, total: input.total, categoryId: input.categoryId } },
    });

    revalidatePath("/ledger/expenses");
    return { ok: true };
  } catch (err) {
    console.error("[ledger:updateExpense] failed", err);
    return { ok: false, error: "แก้ไขไม่สำเร็จ" };
  }
}

/**
 * Confirm a draft → status=confirmed (the ONLY way an expense becomes "real").
 * Accountant-only. Stamps confirmed_by/confirmed_at. Idempotent: confirming an
 * already-confirmed row is a no-op success.
 */
export async function confirmExpense(input: {
  id: string;
  companyId: string;
}): Promise<Result> {
  let orgId: string;
  let user: DbUser;
  try {
    const session = await requireSession();
    orgId = session.user.org_id;
    user = session.user;
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!isAccountant(user.role)) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยืนยันได้" };
  }
  // Module entitlement: server actions are directly-invokable POST endpoints, so
  // a viewer (accountant-tier) NOT granted the ledger module must still be blocked
  // — mirror updateExpense / _actions.ts. Admin tier bypasses.
  if (!isAdminTier(user.role) && !(await userHasModuleAccess(user, "ledger"))) {
    return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
  }

  const existing = await prisma.ledgerExpense.findFirst({
    where: { id: input.id, orgId, companyId: input.companyId },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการ" };
  if (existing.status === "void") return { ok: false, error: "รายการถูกยกเลิกแล้ว" };
  if (existing.status !== "draft") return { ok: true }; // already confirmed/locked

  try {
    await prisma.ledgerExpense.update({
      where: { id: input.id },
      data: {
        status: "confirmed",
        confirmedBy: user.id,
        confirmedAt: new Date(),
        needsReview: false,
      },
    });

    await audit({
      orgId,
      userId: user.id,
      action: "LEDGER_EXPENSE_CONFIRMED",
      resourceType: "ledger_expense",
      resourceId: input.id,
      diff: { old: { status: "draft" }, new: { status: "confirmed" } },
    });

    revalidatePath("/ledger/expenses");
    return { ok: true };
  } catch (err) {
    console.error("[ledger:confirmExpense] failed", err);
    return { ok: false, error: "ยืนยันไม่สำเร็จ" };
  }
}

/** Confirm many drafts at once (bulk-confirm in the review pane). Accountant-only. */
export async function confirmExpensesBulk(input: {
  ids: string[];
  companyId: string;
}): Promise<Result<{ confirmed: number }>> {
  let orgId: string;
  let user: DbUser;
  try {
    const session = await requireSession();
    orgId = session.user.org_id;
    user = session.user;
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!isAccountant(user.role)) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยืนยันได้" };
  }
  // Module entitlement: server actions are directly-invokable POST endpoints, so
  // a viewer (accountant-tier) NOT granted the ledger module must still be blocked
  // — mirror updateExpense / _actions.ts. Admin tier bypasses.
  if (!isAdminTier(user.role) && !(await userHasModuleAccess(user, "ledger"))) {
    return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
  }
  if (!input.ids.length) return { ok: true, data: { confirmed: 0 } };

  try {
    const res = await prisma.ledgerExpense.updateMany({
      where: {
        id: { in: input.ids },
        orgId,
        companyId: input.companyId,
        status: "draft",
      },
      data: {
        status: "confirmed",
        confirmedBy: user.id,
        confirmedAt: new Date(),
        needsReview: false,
      },
    });

    await audit({
      orgId,
      userId: user.id,
      action: "LEDGER_EXPENSE_CONFIRMED",
      resourceType: "ledger_expense",
      diff: { new: { bulk: true, count: res.count, ids: input.ids } },
    });

    revalidatePath("/ledger/expenses");
    return { ok: true, data: { confirmed: res.count } };
  } catch (err) {
    console.error("[ledger:confirmExpensesBulk] failed", err);
    return { ok: false, error: "ยืนยันหลายรายการไม่สำเร็จ" };
  }
}

/** Void an expense (soft-cancel). Accountant-only. Locked rows can't be voided. */
export async function voidExpense(input: {
  id: string;
  companyId: string;
  reason?: string;
}): Promise<Result> {
  let orgId: string;
  let user: DbUser;
  try {
    const session = await requireSession();
    orgId = session.user.org_id;
    user = session.user;
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!isAccountant(user.role)) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยกเลิกได้" };
  }

  const existing = await prisma.ledgerExpense.findFirst({
    where: { id: input.id, orgId, companyId: input.companyId },
    select: { id: true, status: true, note: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการ" };
  if (existing.status === "locked") {
    return { ok: false, error: "ปิดงวดแล้ว ยกเลิกไม่ได้" };
  }
  if (existing.status === "void") return { ok: true };

  try {
    await prisma.ledgerExpense.update({
      where: { id: input.id },
      data: {
        status: "void",
        note: input.reason
          ? `${existing.note ? existing.note + " · " : ""}ยกเลิก: ${input.reason}`
          : existing.note,
      },
    });

    await audit({
      orgId,
      userId: user.id,
      action: "LEDGER_EXPENSE_VOIDED",
      resourceType: "ledger_expense",
      resourceId: input.id,
      diff: { old: { status: existing.status }, new: { status: "void", reason: input.reason } },
    });

    revalidatePath("/ledger/expenses");
    return { ok: true };
  } catch (err) {
    console.error("[ledger:voidExpense] failed", err);
    return { ok: false, error: "ยกเลิกไม่สำเร็จ" };
  }
}

void serializeExpense; // re-exported for callers that need fresh row shaping
