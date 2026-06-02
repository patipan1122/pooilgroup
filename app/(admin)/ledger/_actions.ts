"use server";

// Ledger UI server actions — Partition C local fallback.
//
// NOTE[ledger-partition-B]: The canonical mutation layer is meant to live at
// `lib/ledger/actions.ts` (Partition B). It is not present yet, so the UI ships
// these minimal, correct actions so the review flow actually works (acceptance
// #3). When B's actions land, the parent should re-point the pages to them and
// delete this file. These actions DO enforce the two golden rules:
//   1. NEVER auto-post — confirm is an explicit human action; recheck must pass.
//   2. Multi-tenant — every write is scoped by org_id + company_id.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { recheckReceipt } from "@/lib/ledger/recheck";

export type ActionResult = { ok: boolean; error?: string };

// ---- shared expense patch shape (mirrors ExpenseDraft in ExpenseReviewPane) ----
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
});
export type ExpensePatch = z.infer<typeof patchSchema>;

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
  };
}

/** Load the expense and assert it belongs to the caller's org+company. */
async function loadScoped(id: string) {
  const session = await requireSession();
  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId: session.user.org_id },
    select: { id: true, companyId: true, status: true },
  });
  return { session, row };
}

/** Save edits to a draft (stays draft). */
export async function saveExpense(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { session, row } = await loadScoped(id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก แก้ไม่ได้" };

  await prisma.ledgerExpense.updateMany({
    where: { id, orgId: session.user.org_id },
    data: { ...toData(parsed.data), needsReview: true },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Confirm a draft → status=confirmed. Recheck (server-side) must pass. */
export async function confirmExpense(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const p = parsed.data;

  // Golden rule: recheck math BEFORE allowing a human confirm.
  const rc = recheckReceipt({
    vendorTaxId: p.vendorTaxId || null,
    subtotal: p.subtotal,
    vat: p.vat,
    wht: p.wht,
    total: p.total,
    items: [],
  });
  // Only hard math errors block; soft warnings (tax id / vat%) are advisory.
  const blocking = rc.warnings.filter((w) => w.includes("ยอดรวม") || w.toLowerCase().includes("total"));
  if (blocking.length > 0) {
    return { ok: false, error: `ยอดไม่ตรง: ${blocking.join(" · ")}` };
  }

  const { session, row } = await loadScoped(id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก ยืนยันไม่ได้" };

  await prisma.ledgerExpense.updateMany({
    where: { id, orgId: session.user.org_id },
    data: {
      ...toData(p),
      status: "confirmed",
      needsReview: false,
      confirmedBy: session.user.id,
      confirmedAt: new Date(),
    },
  });
  // TODO[ledger-partition-B]: write audit log (AuditAction union needs ledger
  // entries added in lib/audit/log.ts — owned by schema/backend partitions).
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true };
}

/** Void an expense (soft delete → status=void). */
export async function voidExpense(id: string): Promise<ActionResult> {
  const { session, row } = await loadScoped(id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked")
    return { ok: false, error: "รายการถูกล็อก ยกเลิกไม่ได้" };

  await prisma.ledgerExpense.updateMany({
    where: { id, orgId: session.user.org_id },
    data: { status: "void", needsReview: false },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}

/** Bulk-confirm draft rows that already pass recheck (used by the list toolbar). */
export async function bulkConfirm(ids: string[]): Promise<ActionResult & { confirmed?: number; skipped?: number }> {
  if (!Array.isArray(ids) || ids.length === 0)
    return { ok: false, error: "ไม่ได้เลือกรายการ" };
  const session = await requireSession();
  const rows = await prisma.ledgerExpense.findMany({
    where: { id: { in: ids }, orgId: session.user.org_id, status: "draft" },
  });

  let confirmed = 0;
  let skipped = 0;
  for (const r of rows) {
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
  }
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true, confirmed, skipped };
}

// ===================== Settings: categories =====================
const categorySchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1, "ต้องระบุชื่อหมวด").max(100),
  color: z.string().trim().max(20).optional().or(z.literal("")),
  trcloudAccCode: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function createCategory(raw: unknown): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();
  const { companyId, name, color, trcloudAccCode } = parsed.data;
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
        sort: (max._max.sort ?? 0) + 1,
      },
    });
  } catch {
    return { ok: false, error: "หมวดนี้มีอยู่แล้ว" };
  }
  revalidatePath("/ledger/settings");
  return { ok: true };
}

export async function toggleCategory(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  await prisma.ledgerCategory.updateMany({
    where: { id, orgId: session.user.org_id },
    data: { active },
  });
  revalidatePath("/ledger/settings");
  return { ok: true };
}

// ===================== Budgets =====================
const budgetSchema = z.object({
  companyId: z.string().uuid(),
  categoryId: z.string().uuid(),
  branchId: z.string().uuid().optional().or(z.literal("")),
  period: z.string().regex(/^\d{4}-\d{2}$/, "งวดต้องเป็น YYYY-MM"),
  amount: z.coerce.number().min(0),
  alertPct: z.coerce.number().int().min(0).max(200).default(90),
});

export async function upsertBudget(raw: unknown): Promise<ActionResult> {
  const parsed = budgetSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();
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
  const session = await requireSession();
  await prisma.ledgerBudget.deleteMany({
    where: { id, orgId: session.user.org_id },
  });
  revalidatePath("/ledger/budgets");
  return { ok: true };
}
