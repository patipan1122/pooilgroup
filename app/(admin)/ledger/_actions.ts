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
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { liffIdForModule } from "@/lib/line/channels";
import { requireSession, type DbUser } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { recheckReceipt } from "@/lib/ledger/recheck";
import { setPermission, isLedgerRole, isLedgerCapability } from "@/lib/ledger/permissions";
import { listExpenses } from "@/lib/ledger/queries";
import { buildTrcloudCsv } from "@/lib/ledger/trcloud-export";
import { audit } from "@/lib/audit/log";
import { encryptToken } from "@/lib/recruit/channel-crypto";

export type ActionResult = { ok: boolean; error?: string };

// ── Auth helpers (shared gate stack for every action) ───────────────────────

/** Accountant tier = admin tiers + `viewer` (UserRole "viewer" = accountant/HR).
 *  Mirrors isAccountant() in lib/ledger/actions.ts. */
function isAccountant(role: DbUser["role"]): boolean {
  return isAdminTier(role) || role === "viewer";
}

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
  docType: z.enum(["tax_invoice", "receipt", "cash_bill", "delivery_note", "other"]).optional(),
  vendorDocNumber: z.string().trim().max(60).optional(),
  vendorAddress: z.string().trim().max(300).optional(),
  vendorBranchCode: z.string().trim().max(20).optional(),
  discount: z.coerce.number().min(0).optional(),
  paymentStatus: z.enum(["paid", "unpaid", "partial"]).optional(),
  claimantName: z.string().trim().max(120).optional(),
  bankDetail: z.string().trim().max(120).optional(),
  isRecurring: z.boolean().optional(),
  items: z.array(itemSchema).max(100).optional(),
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
    docType: p.docType ?? undefined,
    vendorDocNumber: p.vendorDocNumber === undefined ? undefined : p.vendorDocNumber || null,
    vendorAddress: p.vendorAddress === undefined ? undefined : p.vendorAddress || null,
    vendorBranchCode: p.vendorBranchCode === undefined ? undefined : p.vendorBranchCode || null,
    discount: p.discount ?? undefined,
    paymentStatus: p.paymentStatus ?? undefined,
    claimantName: p.claimantName === undefined ? undefined : p.claimantName || null,
    bankDetail: p.bankDetail === undefined ? undefined : p.bankDetail || null,
    isRecurring: p.isRecurring ?? undefined,
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
    select: { id: true, companyId: true, status: true },
  });
  return { row };
}

/** Save edits to a draft (stays draft). Any ledger member may edit a draft. */
export async function saveExpense(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { row } = await loadScoped(session, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก แก้ไม่ได้" };

  await prisma.$transaction(async (tx) => {
    await tx.ledgerExpense.updateMany({
      // Scope by company too so an edit can't cross a company boundary in-org.
      where: { id, orgId: session.user.org_id, companyId: row.companyId },
      data: { ...toData(parsed.data), needsReview: true },
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
  // Confirm = the financial "post" event → accountant tier only.
  if (!isAccountant(session.user.role)) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยืนยันได้" };
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
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
  // Only hard math errors block; soft warnings (tax id / vat%) are advisory.
  const blocking = rc.warnings.filter((w) => w.includes("ยอดรวม") || w.toLowerCase().includes("total"));
  if (blocking.length > 0) {
    return { ok: false, error: `ยอดไม่ตรง: ${blocking.join(" · ")}` };
  }

  const { row } = await loadScoped(session, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก ยืนยันไม่ได้" };

  await prisma.$transaction(async (tx) => {
    await tx.ledgerExpense.updateMany({
      where: { id, orgId: session.user.org_id, companyId: row.companyId },
      data: {
        ...toData(p),
        status: "confirmed",
        needsReview: false,
        confirmedBy: session.user.id,
        confirmedAt: new Date(),
      },
    });
    await replaceItems(tx, {
      expenseId: id,
      orgId: session.user.org_id,
      companyId: row.companyId,
      items: p.items,
    });
  });
  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "LEDGER_EXPENSE_CONFIRMED",
    resourceType: "ledger_expense",
    resourceId: id,
    diff: { old: { status: row.status }, new: { status: "confirmed", total: p.total } },
  });
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true };
}

/** Void an expense (soft delete → status=void). Accountant-tier only. */
export async function voidExpense(id: string): Promise<ActionResult> {
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAccountant(session.user.role)) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลยกเลิกได้" };
  }

  const { row } = await loadScoped(session, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked")
    return { ok: false, error: "รายการถูกล็อก ยกเลิกไม่ได้" };

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
): Promise<ActionResult & { confirmed?: number; skipped?: number }> {
  if (!Array.isArray(ids) || ids.length === 0)
    return { ok: false, error: "ไม่ได้เลือกรายการ" };
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const access = await requireLedgerAccess();
  if (!access.ok) return access;
  const { session } = access;
  if (!isAccountant(session.user.role)) {
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
  const confirmedIds: string[] = [];
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
  return { ok: true, confirmed, skipped };
}

// ===================== Settings: categories =====================
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
  // Exporting confirmed P&L to CSV (feeds TRCloud) is an accountant action.
  if (!isAccountant(session.user.role)) {
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
  const expenses = await listExpenses({
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
  role: z.enum(["staff", "accountant", "admin"]).default("staff"),
  scopeBranchIds: z.array(z.string().trim().min(1)).max(200).optional(),
  scopeCategoryIds: z.array(z.string().trim().min(1)).max(200).optional(),
  note: z.string().trim().max(200).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

/** Build the shareable invite link (opens the LedgerLine LIFF → /liff/ledger/join). */
function inviteUrl(token: string): string {
  const liffId = liffIdForModule("ledger");
  const next = `/liff/ledger/join?invite=${token}`;
  return liffId
    ? `https://liff.line.me/${liffId}?next=${encodeURIComponent(next)}`
    : next;
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
  return { ok: true };
}

/** Admin changes a member's role (staff | accountant | admin). */
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
  revalidatePath("/ledger/settings");
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
  return { ok: true };
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
