"use server";

// ============================================================
// Vendor Bills server actions · ChairOps F2 · audit MISS-01 (2026-06-02)
// ============================================================
// Locked CEO decisions:
//   - 11 default categories seeded at migration time · users can CRUD.
//   - 3-state status: PENDING / PAID / OVERDUE (OVERDUE derived).
//   - Per-bill bankAccountTo (free text, NOT a per-template link).
//   - No auto cron · accountant enters from email. ±20% inline warning lives
//     in getAnomaly() — non-blocking, surfaced in detail page.
//   - Permissions: CEO + ADMIN do all · MANAGER + OFFICE view only · MAID no
//     access. ALL mutating actions here require CEO (rankOf ≥ CEO=4), which
//     admits both CEO (4) and ADMIN (5) via the rank table.
//
// Every action:
//   1. requireRole("CEO")
//   2. zod-parse the FormData
//   3. scope writes by session.user.orgId (no cross-tenant leak)
//   4. writeAudit() inside the same prisma.$transaction
//   5. revalidatePath("/chairops/bills") + the detail/categories page
// ============================================================

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { isAllowedPhotoUrl } from "@/lib/chairops/utils/url-guard";

// SEC-01 (2026-06-03) · slipPhotoUrl must come from the R2 CDN we control —
// z.string().url() accepts `javascript:` and `data:` URIs, which then render as
// <a href> / <img src> on the CEO/ADMIN audit surfaces. Use the canonical guard.
const slipPhotoSchema = z
  .string()
  .trim()
  .refine((s) => s === "" || isAllowedPhotoUrl(s), "ลิงก์รูปสลิปไม่ถูกต้อง")
  .optional()
  .or(z.literal(""));

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// ----- helpers --------------------------------------------------------------
function firstOfMonthUTC(iso: string): Date {
  // Accepts "YYYY-MM" or "YYYY-MM-DD". Returns UTC midnight of the 1st of the
  // referenced month. Throws via z.refine when input is malformed.
  const m = iso.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) throw new Error("invalid billPeriod");
  const y = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) throw new Error("invalid month");
  return new Date(Date.UTC(y, mm - 1, 1));
}

function isoDateUTC(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("invalid date");
  return new Date(`${iso}T00:00:00Z`);
}

// ----- zod schemas ----------------------------------------------------------

const createBillSchema = z.object({
  branchId: zUUID(),
  billPeriod: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "ต้องเป็น YYYY-MM"),
  categoryId: zUUID(),
  amount: z.coerce.number().positive().max(100_000_000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็น YYYY-MM-DD"),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  paidAmount: z.coerce.number().nonnegative().optional(),
  slipPhotoUrl: slipPhotoSchema,
  bankAccountTo: z.string().trim().max(200).optional().or(z.literal("")),
  paymentTerms: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

const updateBillSchema = createBillSchema.extend({
  id: zUUID(),
});

const markPaidSchema = z.object({
  id: zUUID(),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็น YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  paidAmount: z.coerce.number().positive().optional(),
  slipPhotoUrl: slipPhotoSchema,
});

const deleteBillSchema = z.object({ id: zUUID() });

const createCategorySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "อย่างน้อย 2 ตัวอักษร")
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, "ใช้ A-Z 0-9 _ เท่านั้น · เริ่มด้วยตัวอักษร"),
  label: z.string().trim().min(1, "ต้องระบุชื่อหมวด").max(80),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

const archiveCategorySchema = z.object({ id: zUUID() });

// ----- createBill -----------------------------------------------------------

export async function createBill(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole("CEO");

  const parsed = createBillSchema.safeParse({
    branchId: formData.get("branchId"),
    billPeriod: formData.get("billPeriod"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    dueDate: formData.get("dueDate"),
    paidAt: formData.get("paidAt") || undefined,
    paidAmount: formData.get("paidAmount") || undefined,
    slipPhotoUrl: formData.get("slipPhotoUrl") || undefined,
    bankAccountTo: formData.get("bankAccountTo") || undefined,
    paymentTerms: formData.get("paymentTerms") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const v = parsed.data;

  // Verify branch + category are in the same org (no cross-tenant write).
  const [branch, category] = await Promise.all([
    prisma.chairopsBranch.findFirst({
      where: { id: v.branchId, orgId: session.user.orgId },
      select: { id: true },
    }),
    prisma.chairopsExpenseCategory.findFirst({
      where: { id: v.categoryId, orgId: session.user.orgId, archivedAt: null },
      select: { id: true },
    }),
  ]);
  if (!branch) return { ok: false, error: "ไม่พบสาขา" };
  if (!category) return { ok: false, error: "ไม่พบหมวดบิล (หรือถูกซ่อนแล้ว)" };

  const billPeriod = firstOfMonthUTC(v.billPeriod);
  const dueDate = isoDateUTC(v.dueDate);
  const paidAt = v.paidAt ? isoDateUTC(v.paidAt) : null;
  // BA-03 (2026-06-03) · same overpay guard as markPaid · createBill can also
  // be used to enter an already-paid bill, so the same ±5% slack applies.
  if (v.paidAmount != null && v.paidAmount > v.amount * 1.05) {
    return {
      ok: false,
      error: `ยอดที่จ่าย ฿${v.paidAmount.toLocaleString()} เกินยอดบิล ฿${v.amount.toLocaleString()} · ตรวจตัวเลขอีกครั้ง`,
    };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.chairopsVendorBill.create({
        data: {
          orgId: session.user.orgId,
          branchId: v.branchId,
          billPeriod,
          categoryId: v.categoryId,
          amount: v.amount,
          dueDate,
          paidAt,
          paidAmount: v.paidAmount ?? null,
          slipPhotoUrl: v.slipPhotoUrl || null,
          bankAccountTo: v.bankAccountTo || null,
          paymentTerms: v.paymentTerms || null,
          notes: v.notes || null,
          createdById: session.user.id,
          updatedById: session.user.id,
        },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "bill.create",
          entity: "ChairopsVendorBill",
          entityId: row.id,
          newValue: {
            branchId: v.branchId,
            billPeriod: v.billPeriod,
            categoryId: v.categoryId,
            amount: v.amount,
            dueDate: v.dueDate,
            paidAt: v.paidAt || null,
          },
        },
        tx,
      );
      return row;
    });
    revalidatePath("/chairops/bills");
    revalidatePath(`/chairops/bills/${created.id}`);
    // PERF-04 (2026-06-03) · tag-scoped invalidation instead of revalidatePath('/chairops')
    // which would re-execute 7 unrelated home-page queries per write.
    updateTag("chairops:pending-bills");
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    // Unique constraint on (orgId, branchId, billPeriod, categoryId).
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        error: "มีบิลเดือน+หมวดนี้ของสาขานี้แล้ว · แก้ไขรายการเดิมแทน",
      };
    }
    return { ok: false, error: "บันทึกบิลไม่สำเร็จ" };
  }
}

// ----- updateBill -----------------------------------------------------------

export async function updateBill(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("CEO");

  const parsed = updateBillSchema.safeParse({
    id: formData.get("id"),
    branchId: formData.get("branchId"),
    billPeriod: formData.get("billPeriod"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    dueDate: formData.get("dueDate"),
    paidAt: formData.get("paidAt") || undefined,
    paidAmount: formData.get("paidAmount") || undefined,
    slipPhotoUrl: formData.get("slipPhotoUrl") || undefined,
    bankAccountTo: formData.get("bankAccountTo") || undefined,
    paymentTerms: formData.get("paymentTerms") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const v = parsed.data;

  const existing = await prisma.chairopsVendorBill.findFirst({
    where: { id: v.id, orgId: session.user.orgId },
  });
  if (!existing) return { ok: false, error: "ไม่พบบิล" };

  const [branch, category] = await Promise.all([
    prisma.chairopsBranch.findFirst({
      where: { id: v.branchId, orgId: session.user.orgId },
      select: { id: true },
    }),
    prisma.chairopsExpenseCategory.findFirst({
      where: { id: v.categoryId, orgId: session.user.orgId },
      select: { id: true },
    }),
  ]);
  if (!branch) return { ok: false, error: "ไม่พบสาขา" };
  if (!category) return { ok: false, error: "ไม่พบหมวดบิล" };

  const billPeriod = firstOfMonthUTC(v.billPeriod);
  const dueDate = isoDateUTC(v.dueDate);

  // OWN-BILLS-03 (2026-06-03) · The edit form omits paidAt/paidAmount on the
  // wire when the CEO is fixing a typo. Earlier this set paidAt=null silently
  // and un-marked a PAID bill — caller had to call markPaid again. The new
  // contract: form must POST `clearPaid=true` to revert; otherwise paidAt
  // and paidAmount are LEFT UNCHANGED. Use `unmarkPaid` for explicit reverts.
  const wantClearPaid = formData.get("clearPaid") === "true";
  const paidAtUpdate = wantClearPaid
    ? null
    : v.paidAt
      ? isoDateUTC(v.paidAt)
      : undefined; // undefined = skip in Prisma
  const paidAmountUpdate = wantClearPaid
    ? null
    : v.paidAmount != null
      ? v.paidAmount
      : undefined;

  // BA-03 (2026-06-03) · overpay guard mirrors markPaid.
  if (v.paidAmount != null && v.paidAmount > v.amount * 1.05) {
    return {
      ok: false,
      error: `ยอดที่จ่าย ฿${v.paidAmount.toLocaleString()} เกินยอดบิล ฿${v.amount.toLocaleString()} · ตรวจตัวเลขอีกครั้ง`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.chairopsVendorBill.update({
        where: { id: v.id },
        data: {
          branchId: v.branchId,
          billPeriod,
          categoryId: v.categoryId,
          amount: v.amount,
          dueDate,
          paidAt: paidAtUpdate,
          paidAmount: paidAmountUpdate,
          slipPhotoUrl: v.slipPhotoUrl || null,
          bankAccountTo: v.bankAccountTo || null,
          paymentTerms: v.paymentTerms || null,
          notes: v.notes || null,
          updatedById: session.user.id,
        },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "bill.update",
          entity: "ChairopsVendorBill",
          entityId: v.id,
          oldValue: {
            amount: existing.amount.toString(),
            dueDate: existing.dueDate,
            paidAt: existing.paidAt,
          },
          newValue: {
            amount: v.amount,
            dueDate: v.dueDate,
            paidAt:
              paidAtUpdate === undefined
                ? "(unchanged)"
                : (paidAtUpdate?.toISOString() ?? null),
          },
        },
        tx,
      );
    });
    revalidatePath("/chairops/bills");
    revalidatePath(`/chairops/bills/${v.id}`);
    updateTag("chairops:pending-bills");
    return { ok: true };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        error: "เดือน+หมวดนี้ของสาขานี้ซ้ำกับบิลอื่น",
      };
    }
    return { ok: false, error: "แก้ไขบิลไม่สำเร็จ" };
  }
}

// ----- markPaid -------------------------------------------------------------

export async function markPaid(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("CEO");

  const parsed = markPaidSchema.safeParse({
    id: formData.get("id"),
    paidAt: formData.get("paidAt") || undefined,
    paidAmount: formData.get("paidAmount") || undefined,
    slipPhotoUrl: formData.get("slipPhotoUrl") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const v = parsed.data;

  const existing = await prisma.chairopsVendorBill.findFirst({
    where: { id: v.id, orgId: session.user.orgId },
    select: { id: true, amount: true, paidAt: true, paidAmount: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบบิล" };

  const paidAtDate = v.paidAt ? isoDateUTC(v.paidAt) : new Date();
  const billAmount = Number(existing.amount);
  const paidAmt =
    v.paidAmount !== undefined && v.paidAmount > 0
      ? v.paidAmount
      : billAmount;

  // BA-03 (2026-06-03) · guard against typo overpay > 5% of bill amount.
  // CEO locked 3-state PAID/PENDING/OVERDUE — partial pay is intentionally NOT
  // a 4th status, but we still flag it in the audit trail so PAID-with-shortfall
  // is forensically distinguishable from PAID-in-full.
  if (paidAmt > billAmount * 1.05) {
    return {
      ok: false,
      error: `ยอดที่จ่าย ฿${paidAmt.toLocaleString()} เกินยอดบิล ฿${billAmount.toLocaleString()} · ตรวจตัวเลขอีกครั้ง`,
    };
  }
  const isPartial = paidAmt > 0 && paidAmt < billAmount * 0.98;

  await prisma.$transaction(async (tx) => {
    await tx.chairopsVendorBill.update({
      where: { id: v.id },
      data: {
        paidAt: paidAtDate,
        paidAmount: paidAmt,
        slipPhotoUrl: v.slipPhotoUrl || undefined,
        updatedById: session.user.id,
      },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: isPartial ? "bill.mark_paid_partial" : "bill.mark_paid",
        entity: "ChairopsVendorBill",
        entityId: v.id,
        oldValue: { paidAt: existing.paidAt, paidAmount: existing.paidAmount },
        newValue: {
          paidAt: paidAtDate,
          paidAmount: paidAmt,
          billAmount,
          shortfall: isPartial ? billAmount - paidAmt : 0,
        },
      },
      tx,
    );
  });
  // PERF-04 (2026-06-03) · scoped tag instead of broad revalidatePath('/chairops')
  // which would invalidate 7 unrelated home-page queries on every bill mutation.
  revalidatePath("/chairops/bills");
  revalidatePath(`/chairops/bills/${v.id}`);
  updateTag("chairops:pending-bills");
  return { ok: true };
}

// ----- unmarkPaid (explicit "revert paid" verb) ----------------------------
// OWN-BILLS-03 (2026-06-03) · separated from updateBill so clearing paidAt
// can never happen silently · explicit confirm in the UI is wired to this.

export async function unmarkPaid(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("CEO");
  const parsed = deleteBillSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: "id ไม่ถูกต้อง" };

  const existing = await prisma.chairopsVendorBill.findFirst({
    where: { id: parsed.data.id, orgId: session.user.orgId },
    select: { id: true, paidAt: true, paidAmount: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบบิล" };
  if (!existing.paidAt) return { ok: true };

  await prisma.$transaction(async (tx) => {
    await tx.chairopsVendorBill.update({
      where: { id: parsed.data.id },
      data: {
        paidAt: null,
        paidAmount: null,
        updatedById: session.user.id,
      },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "bill.unmark_paid",
        entity: "ChairopsVendorBill",
        entityId: parsed.data.id,
        oldValue: { paidAt: existing.paidAt, paidAmount: existing.paidAmount },
        newValue: { paidAt: null, paidAmount: null },
      },
      tx,
    );
  });
  revalidatePath("/chairops/bills");
  revalidatePath(`/chairops/bills/${parsed.data.id}`);
  updateTag("chairops:pending-bills");
  return { ok: true };
}

// ----- deleteBill -----------------------------------------------------------

export async function deleteBill(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("CEO");
  const parsed = deleteBillSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: "id ไม่ถูกต้อง" };

  const existing = await prisma.chairopsVendorBill.findFirst({
    where: { id: parsed.data.id, orgId: session.user.orgId },
  });
  if (!existing) return { ok: false, error: "ไม่พบบิล" };

  await prisma.$transaction(async (tx) => {
    await tx.chairopsVendorBill.delete({ where: { id: parsed.data.id } });
    await writeAudit(
      {
        userId: session.user.id,
        action: "bill.delete",
        entity: "ChairopsVendorBill",
        entityId: parsed.data.id,
        oldValue: {
          branchId: existing.branchId,
          billPeriod: existing.billPeriod,
          amount: existing.amount.toString(),
        },
      },
      tx,
    );
  });
  revalidatePath("/chairops/bills");
  updateTag("chairops:pending-bills");
  return { ok: true };
}

// ----- createCategory -------------------------------------------------------

export async function createCategory(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole("CEO");

  const parsed = createCategorySchema.safeParse({
    code: formData.get("code"),
    label: formData.get("label"),
    sortOrder: formData.get("sortOrder") || 0,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const v = parsed.data;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.chairopsExpenseCategory.create({
        data: {
          orgId: session.user.orgId,
          code: v.code,
          label: v.label,
          sortOrder: v.sortOrder,
        },
      });
      await writeAudit(
        {
          userId: session.user.id,
          action: "bill_category.create",
          entity: "ChairopsExpenseCategory",
          entityId: row.id,
          newValue: { code: v.code, label: v.label, sortOrder: v.sortOrder },
        },
        tx,
      );
      return row;
    });
    revalidatePath("/chairops/bills/categories");
    revalidatePath("/chairops/bills");
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: "รหัสนี้มีอยู่แล้ว" };
    }
    return { ok: false, error: "สร้างหมวดไม่สำเร็จ" };
  }
}

// ----- archiveCategory / restoreCategory ------------------------------------

export async function archiveCategory(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireRole("CEO");
  const parsed = archiveCategorySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: "id ไม่ถูกต้อง" };

  const existing = await prisma.chairopsExpenseCategory.findFirst({
    where: { id: parsed.data.id, orgId: session.user.orgId },
  });
  if (!existing) return { ok: false, error: "ไม่พบหมวด" };
  if (existing.archivedAt) return { ok: true }; // idempotent

  // QA-03 (2026-06-03) · Prevent archive while unpaid bills still reference
  // this category — otherwise the matrix shows orphan rows but createBill
  // rejects "หมวดนี้ถูกซ่อนแล้ว" with no recovery path.
  const force = formData.get("confirm") === "true";
  if (!force) {
    const openCount = await prisma.chairopsVendorBill.count({
      where: {
        orgId: session.user.orgId,
        categoryId: parsed.data.id,
        paidAt: null,
      },
    });
    if (openCount > 0) {
      return {
        ok: false,
        error: `หมวดนี้ยังมีบิลค้างจ่าย ${openCount} รายการ · จ่ายให้ครบหรือยืนยันบังคับซ่อน`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.chairopsExpenseCategory.update({
      where: { id: parsed.data.id },
      data: { archivedAt: new Date() },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: force ? "bill_category.archive_forced" : "bill_category.archive",
        entity: "ChairopsExpenseCategory",
        entityId: parsed.data.id,
      },
      tx,
    );
  });
  revalidatePath("/chairops/bills/categories");
  revalidatePath("/chairops/bills");
  return { ok: true };
}

export async function restoreCategory(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireRole("CEO");
  const parsed = archiveCategorySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: "id ไม่ถูกต้อง" };

  const existing = await prisma.chairopsExpenseCategory.findFirst({
    where: { id: parsed.data.id, orgId: session.user.orgId },
  });
  if (!existing) return { ok: false, error: "ไม่พบหมวด" };
  if (!existing.archivedAt) return { ok: true };

  await prisma.$transaction(async (tx) => {
    await tx.chairopsExpenseCategory.update({
      where: { id: parsed.data.id },
      data: { archivedAt: null },
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "bill_category.restore",
        entity: "ChairopsExpenseCategory",
        entityId: parsed.data.id,
      },
      tx,
    );
  });
  revalidatePath("/chairops/bills/categories");
  revalidatePath("/chairops/bills");
  return { ok: true };
}

// ----- checkAnomaly (used by detail page · client form refetches) ----------

export async function checkAnomaly(args: {
  branchId: string;
  categoryId: string;
  billPeriod: string; // "YYYY-MM"
  amount: number;
}): Promise<
  ActionResult<{
    prev: number | null;
    deltaPct: number | null;
    isAnomalous: boolean;
    prevPeriodIso: string | null;
  }>
> {
  const session = await requireRole("MANAGER"); // read-only — managers may see
  const { getAnomaly } = await import("@/lib/chairops/queries/vendor-bills");
  try {
    const period = firstOfMonthUTC(args.billPeriod);
    const result = await getAnomaly({
      orgId: session.user.orgId,
      branchId: args.branchId,
      categoryId: args.categoryId,
      billPeriod: period,
      amount: args.amount,
    });
    return {
      ok: true,
      data: {
        prev: result.prev,
        deltaPct: result.deltaPct,
        isAnomalous: result.isAnomalous,
        prevPeriodIso: result.prevPeriod
          ? result.prevPeriod.toISOString().slice(0, 7)
          : null,
      },
    };
  } catch {
    return { ok: false, error: "ตรวจสอบไม่สำเร็จ" };
  }
}
