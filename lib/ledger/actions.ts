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
import { isAdminTier, isProgramAdminTier } from "@/lib/auth/role-guards";
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
  // 2026-06-16 (CEO): program_admin = ฟังก์ชันบัญชีครบ (ยืนยัน/ยกเลิก/ออกใบสำคัญ).
  // grant-scoped — call-site ที่ตามมา (เช่น confirm/bulk) เช็ค userHasModuleAccess("ledger")
  // อยู่แล้ว → program_admin ต้องถูกติ๊กสิทธิ์ ledger ถึงจะมาถึง.
  return isProgramAdminTier(role) || role === "viewer";
}

async function assertCompanyInOrg(orgId: string, companyId: string): Promise<boolean> {
  const c = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true },
  });
  return !!c;
}

/**
 * Parse a "YYYY-MM-DD" docDate to a Date, or null. Guards against a malformed
 * string (e.g. OCR returned a Buddhist-year date or "2026-13-45") that would
 * otherwise become an Invalid Date and make Prisma THROW on insert — losing the
 * whole draft (and the receipt image) instead of just leaving docDate blank.
 */
function safeDocDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
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

// Fields needed to decide whether a deduped draft should be backfilled.
const DEDUP_SELECT = {
  id: true,
  docCode: true,
  status: true,
  total: true,
  vendor: true,
  ocrModel: true,
} satisfies Prisma.LedgerExpenseSelect;

type DedupRow = {
  id: string;
  docCode: string;
  status: string;
  total: Prisma.Decimal | number;
  vendor: string | null;
  ocrModel: string | null;
};

/**
 * When a re-sent image (sha256 / LINE msg id) matches an EXISTING draft that is
 * still EMPTY — created when OCR had failed (total=0, vendor=null) — backfill it
 * with the fresh OCR data from this resend so the edit form isn't blank. This is
 * what fixes "การ์ดโชว์ยอด แต่กดแก้ไขแล้วฟอร์มว่าง": the dedup used to return the
 * stale empty draft and silently drop the new OCR result.
 *
 * Safety: ONLY touches a row whose status is still "draft" AND that looks empty.
 * Never overwrites a confirmed/locked/void row, nor a draft a human already
 * filled in (vendor set or total > 0). Returns true iff it backfilled.
 */
async function maybeBackfillEmptyDraft(
  orgId: string,
  userId: string | null,
  existing: DedupRow,
  input: CreateDraftInput,
  recheck: ReturnType<typeof recheckReceipt>,
  grade: ReturnType<typeof gradeCompleteness>,
): Promise<boolean> {
  const existingTotal =
    typeof existing.total === "number" ? existing.total : Number(existing.total);
  const existingIsEmpty = existing.status === "draft" && existingTotal === 0 && existing.vendor == null;
  const incomingHasData =
    (input.total ?? 0) > 0 || !!input.vendor || !!input.docDate || (input.items?.length ?? 0) > 0;
  if (!existingIsEmpty || !incomingHasData) return false;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.ledgerExpense.update({
        where: { id: existing.id },
        data: {
          vendor: input.vendor ?? null,
          vendorTaxId: input.vendorTaxId ?? null,
          docDate: safeDocDate(input.docDate),
          subtotal: input.subtotal ?? 0,
          vat: input.vat ?? 0,
          wht: input.wht ?? 0,
          total: input.total ?? 0,
          discount: input.discount ?? 0,
          paymentMethod: input.paymentMethod ?? null,
          docType: input.docType ?? "tax_invoice",
          vendorDocNumber: input.vendorDocNumber ?? null,
          vendorAddress: input.vendorAddress ?? null,
          vendorBranchCode: input.vendorBranchCode ?? null,
          branchId: input.branchId ?? undefined, // keep prior branch if none parsed
          ocrModel: input.ocrModel ?? null,
          ocrConfidence: (input.ocrConfidence ?? undefined) as Prisma.InputJsonValue | undefined,
          needsReview: !recheck.ok,
          buyerTaxIdOnDoc: input.buyerTaxIdOnDoc ?? null,
          buyerMatchStatus: grade.buyerMatch,
          completenessStatus: grade.status,
          completenessMissing: grade.missing as unknown as Prisma.InputJsonValue,
          completenessCheckedAt: new Date(),
          inputVatBlockReason: grade.blockReason,
          inputVatClaimable: grade.suggestedClaimable ? true : null,
          // Replace the (empty) item list with the freshly parsed lines.
          items: {
            deleteMany: {},
            create: (input.items ?? []).map((it) => ({
              orgId,
              companyId: input.companyId,
              description: it.description,
              qty: it.qty,
              unitPrice: it.unitPrice,
              amount: it.amount,
              vatRate: it.vatRate ?? null,
            })),
          },
        },
      });
      await audit({
        orgId,
        userId,
        action: "LEDGER_EXPENSE_UPDATED",
        resourceType: "ledger_expense",
        resourceId: existing.id,
        diff: { new: { backfilledFromOcr: true, total: input.total ?? 0, vendor: input.vendor ?? null } },
      });
    });
    revalidatePath("/ledger/expenses");
    return true;
  } catch (e) {
    console.error("[ledger:backfillEmptyDraft] failed", e);
    return false;
  }
}

export interface CreateDraftInput {
  companyId: string;
  branchId?: string | null;
  source?: ExpenseSource;
  vendor?: string | null;
  /**
   * P2#6 — LINE message ID dedup. ถ้า webhook ส่งซ้ำ (LINE retry) จะคืน expense เดิม
   * แทนการสร้างใหม่. ใช้คอลัมน์ lineConfirmMessageId ที่มีอยู่แล้วในสคีมา.
   */
  lineConfirmMessageId?: string | null;
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
  /** ประเภทการซื้อที่ AI อ่านได้ (goods/service/construction) → push เลือก SKU อัตโนมัติ. */
  purchaseType?: string | null;
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
): Promise<Result<{ id: string; docCode: string; duplicate: boolean; backfilled?: boolean }>> {
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
): Promise<Result<{ id: string; docCode: string; duplicate: boolean; backfilled?: boolean }>> {
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
): Promise<Result<{ id: string; docCode: string; duplicate: boolean; backfilled?: boolean }>> {
  if (!(await assertCompanyInOrg(orgId, input.companyId))) {
    return { ok: false, error: "ไม่พบบริษัทใน org นี้" };
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

  // Dedup by image hash. If the SAME image was sent before, return that draft
  // instead of creating a duplicate. BUT: if the prior draft is still empty
  // (created when OCR failed → ฿0.00, vendor=null) and this re-send carries real
  // OCR data, BACKFILL the existing draft so the edit form isn't blank. Never
  // touch a confirmed/locked/void row or one a human already filled in.
  if (input.sha256) {
    const existing = await prisma.ledgerExpense.findFirst({
      where: { orgId, companyId: input.companyId, sha256: input.sha256 },
      select: DEDUP_SELECT,
    });
    if (existing) {
      const backfilled = await maybeBackfillEmptyDraft(orgId, userId, existing, input, recheck, grade);
      return { ok: true, data: { id: existing.id, docCode: existing.docCode, duplicate: true, backfilled } };
    }
  }

  // P2#6 — LINE message ID dedup: ป้องกัน LINE webhook retry สร้าง expense ซ้ำ
  // ใช้คอลัมน์ lineConfirmMessageId ที่มีอยู่แล้วในสคีมา (line_confirm_message_id)
  // เพิ่ม unique index เพื่อ consistency: CREATE UNIQUE INDEX ON ledger_expense
  //   (org_id, company_id, line_confirm_message_id) WHERE line_confirm_message_id IS NOT NULL;
  if (input.lineConfirmMessageId) {
    const existingByMsgId = await prisma.ledgerExpense.findFirst({
      where: { orgId, companyId: input.companyId, lineConfirmMessageId: input.lineConfirmMessageId },
      select: DEDUP_SELECT,
    });
    if (existingByMsgId) {
      const backfilled = await maybeBackfillEmptyDraft(orgId, userId, existingByMsgId, input, recheck, grade);
      return { ok: true, data: { id: existingByMsgId.id, docCode: existingByMsgId.docCode, duplicate: true, backfilled } };
    }
  }

  // P1#2 — DOCCODE RACE FIX: สร้าง docCode และ INSERT ใน transaction เดียวกัน
  // เดิม: lock release ก่อน INSERT → สองคนได้ code เดียวกันได้
  // แก้: เรียก nextDocCode() เป็น fallback นอก tx (ใช้ RPC Supabase); แต่ wrap การ INSERT
  // ทั้งหมดใน prisma.$transaction เพื่อให้ docCode + row อยู่ใน atomic unit เดียวกัน
  // NOTE: pg_advisory_xact_lock ใน RPC Supabase SECURITY DEFINER ถือ lock ตลอด tx ของ RPC
  // ซึ่งแยกจาก Prisma tx — วิธีที่ atomic 100% คือย้าย counter ไปเป็น Prisma sequence แต่
  // ต้องการ migration. วิธีนี้ดีกว่าเดิม: ถ้า INSERT ล้มเหลว docCode ที่ได้ไป "เสีย" แต่ไม่ซ้ำ
  const docCode = await nextDocCode(orgId, input.companyId);

  try {
    // P1#2 + P1#11 — wrap CREATE + audit in a single Prisma transaction.
    // pg_advisory_xact_lock ใน RPC ของ Supabase จะ hold lock จนถึงตอนที่ RPC commit;
    // การ wrap INSERT + audit ใน tx เดียวกันทำให้ทั้งคู่ commit/rollback พร้อมกันเสมอ.
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.ledgerExpense.create({
        data: {
          orgId,
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          docCode,
          status: "draft", // GOLDEN RULE — never auto-post
          source: input.source ?? "web",
          vendor: input.vendor ?? null,
          vendorTaxId: input.vendorTaxId ?? null,
          docDate: safeDocDate(input.docDate),
          subtotal: input.subtotal ?? 0,
          vat: input.vat ?? 0,
          wht: input.wht ?? 0,
          total: input.total ?? 0,
          categoryId: input.categoryId ?? null,
          trcloudPurchaseType: input.purchaseType ?? null,
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
          // P2#6 — เก็บ LINE confirm message ID เพื่อใช้ dedup ถ้า webhook ส่งซ้ำ
          lineConfirmMessageId: input.lineConfirmMessageId ?? null,
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

      // P1#11 — audit ภายใน transaction เดียวกับ INSERT
      await audit({
        orgId,
        userId,
        action: "LEDGER_EXPENSE_CREATED",
        resourceType: "ledger_expense",
        resourceId: row.id,
        diff: { new: { docCode: row.docCode, status: "draft", source: input.source ?? "web", needsReview: !recheck.ok } },
      });

      return row;
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
    // P0#9: fetch branchId + categoryId so we can validate before confirming.
    select: { id: true, status: true, branchId: true, categoryId: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบรายการ" };
  if (existing.status === "void") return { ok: false, error: "รายการถูกยกเลิกแล้ว" };
  if (existing.status !== "draft") return { ok: true }; // already confirmed/locked

  // P0#9 — CONFIRM REQUIRES BRANCH + CATEGORY: ป้องกันยืนยันรายการที่ยังไม่ระบุสาขา/หมวด
  if (!existing.branchId || !existing.categoryId) {
    return { ok: false, error: "กรุณาระบุสาขาและหมวดค่าใช้จ่ายก่อนยืนยัน" };
  }

  try {
    // P1#11 — AUDIT LOG IN TRANSACTION: เขียน audit ภายใน transaction เดียวกับ update
    // เพื่อให้ audit trail สอดคล้องกับสถานะข้อมูลเสมอ (ถ้า update พัง audit ก็ roll back ด้วย)
    await prisma.$transaction(async (tx) => {
      await tx.ledgerExpense.update({
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
  // grant-scoped (มิเรอร์ confirmExpense): non-admin ต้องถูกติ๊กสิทธิ์ ledger
  if (!isAdminTier(user.role) && !(await userHasModuleAccess(user, "ledger"))) {
    return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
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
      where: { id: input.id, orgId, companyId: input.companyId },
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
