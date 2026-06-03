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

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, type DbUser } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { recheckReceipt } from "@/lib/ledger/recheck";
import { listExpenses } from "@/lib/ledger/queries";
import { buildTrcloudCsv } from "@/lib/ledger/trcloud-export";
import { audit } from "@/lib/audit/log";

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

  await prisma.ledgerExpense.updateMany({
    // Scope by company too so an edit can't cross a company boundary in-org.
    where: { id, orgId: session.user.org_id, companyId: row.companyId },
    data: { ...toData(parsed.data), needsReview: true },
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

  const { row } = await loadScoped(session, id);
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  if (row.status === "locked" || row.status === "void")
    return { ok: false, error: "รายการถูกล็อก/ยกเลิก ยืนยันไม่ได้" };

  await prisma.ledgerExpense.updateMany({
    where: { id, orgId: session.user.org_id, companyId: row.companyId },
    data: {
      ...toData(p),
      status: "confirmed",
      needsReview: false,
      confirmedBy: session.user.id,
      confirmedAt: new Date(),
    },
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
  companyId: z.string().uuid(),
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
  companyId: z.string().uuid(),
  categoryId: z.string().uuid(),
  branchId: z.string().uuid().optional().or(z.literal("")),
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
  companyId: z.string().uuid(),
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
