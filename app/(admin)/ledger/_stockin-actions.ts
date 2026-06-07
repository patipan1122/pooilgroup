"use server";

// LedgerLine — Inventory STOCK-IN server actions (LEDGER_STOCKIN_V1).
//
// Config (sync / toggle stock-tracked / pack factor) = ADMIN-tier. Alias mapping +
// the stock-IN send = ACCOUNTANT-tier (expense.export) — both route/move REAL stock
// in the live TRCloud book, so they need the money gate, not just module access.
// Every mutation is org+company scoped (one org = many legal entities) + audited.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import {
  syncSkuCache,
  resolveSku,
  normalizeAlias,
  pushStockIn,
  deleteStockIn,
  type StockInLine,
} from "@/lib/ledger/trcloud-inventory";

type Result = { ok: true } | { ok: false; error: string };
type Session = Awaited<ReturnType<typeof requireSession>>;

/** Base gate: a session with ledger access. */
async function base(): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  let session: Session;
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

/** Config writes (sync / toggle / pack) — admin-tier only. */
async function adminGate(): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  const g = await base();
  if (!g.ok) return g;
  if (!isAdminTier(g.session.user.role)) return { ok: false, error: "เฉพาะผู้ดูแลตั้งค่าคลังสินค้าได้" };
  return g;
}

/** Stock-moving / stock-routing writes (alias map, send) — accountant-tier (expense.export). */
async function moneyGate(): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  const g = await base();
  if (!g.ok) return g;
  if (!(await ledgerWebCanForRole(g.session.user.org_id, g.session.user.role, "expense.export"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลทำรายการคลังสินค้าได้" };
  }
  return g;
}

/** Confirm a company belongs to the caller's org (companyId is client-supplied). */
async function companyInOrg(orgId: string, companyId: string): Promise<boolean> {
  if (!companyId) return false;
  const c = await prisma.company.findFirst({ where: { id: companyId, orgId }, select: { id: true } });
  return !!c;
}

/** Admin: pull SKUs from TRCloud into the local cache (optionally filter by business). */
export async function syncSkusAction(companyId: string, category?: string): Promise<Result & { synced?: number }> {
  const g = await adminGate();
  if (!g.ok) return g;
  if (!(await companyInOrg(g.session.user.org_id, companyId))) return { ok: false, error: "ไม่พบบริษัท" };
  const res = await syncSkuCache({ orgId: g.session.user.org_id, companyId, category });
  if (!res.ok) return res;
  revalidatePath("/ledger/settings/inventory");
  return { ok: true, synced: res.synced };
}

/** Admin: toggle whether a SKU is stock-tracked. company-scoped. */
export async function toggleSkuStockTracked(skuId: string, companyId: string, on: boolean): Promise<Result> {
  const g = await adminGate();
  if (!g.ok) return g;
  const r = await prisma.ledgerTrcloudSku.updateMany({
    where: { id: skuId, orgId: g.session.user.org_id, companyId },
    data: { stockTracked: on },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบสินค้านี้" };
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

/** Admin: set the pack→base-unit factor (1 ลัง = N ชิ้น). company-scoped. */
export async function setSkuPackFactor(skuId: string, companyId: string, factor: number): Promise<Result> {
  const g = await adminGate();
  if (!g.ok) return g;
  if (!(factor > 0) || !Number.isFinite(factor)) return { ok: false, error: "จำนวนต่อแพ็คต้องมากกว่า 0" };
  const r = await prisma.ledgerTrcloudSku.updateMany({
    where: { id: skuId, orgId: g.session.user.org_id, companyId },
    data: { packFactor: factor },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบสินค้านี้" };
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

/** Accountant: map a receipt line text → a SKU (drives where stock is received). */
export async function mapSkuAlias(companyId: string, aliasText: string, skuId: string): Promise<Result> {
  const g = await moneyGate();
  if (!g.ok) return g;
  const orgId = g.session.user.org_id;
  if (!(await companyInOrg(orgId, companyId))) return { ok: false, error: "ไม่พบบริษัท" };
  const key = normalizeAlias(aliasText);
  if (!key) return { ok: false, error: "ข้อความว่าง" };
  const sku = await prisma.ledgerTrcloudSku.findFirst({
    where: { id: skuId, orgId, companyId },
    select: { id: true },
  });
  if (!sku) return { ok: false, error: "ไม่พบสินค้านี้" };
  await prisma.ledgerSkuAlias.upsert({
    where: { orgId_companyId_aliasKey: { orgId, companyId, aliasKey: key } },
    update: { skuId, source: "admin", createdBy: g.session.user.id },
    create: { orgId, companyId, aliasKey: key, skuId, source: "admin", createdBy: g.session.user.id },
  });
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

export async function deleteSkuAlias(aliasId: string, companyId: string): Promise<Result> {
  const g = await moneyGate();
  if (!g.ok) return g;
  await prisma.ledgerSkuAlias.deleteMany({ where: { id: aliasId, orgId: g.session.user.org_id, companyId } });
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

const REAL_DOC = (v: string | null | undefined) => !!v && v !== "pending" && v !== "error";

/** Send a confirmed resale-goods expense into TRCloud as a STOCK-IN (รับเข้าคลัง). */
export async function sendExpenseStockIn(
  expenseId: string,
): Promise<Result & { docNo?: string | null; unmatched?: string[]; untracked?: string[]; alreadySent?: boolean }> {
  const g = await moneyGate();
  if (!g.ok) return g;
  const { session } = g;
  const orgId = session.user.org_id;

  const exp = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId },
    select: {
      id: true, companyId: true, branchId: true, status: true, docCode: true,
      vendor: true, vendorTaxId: true, vendorAddress: true, docDate: true,
      paymentStatus: true, note: true, vat: true,
      trcloudStockinDocId: true,
      category: { select: { vatClaimable: true } },
      items: { select: { description: true, qty: true, unitPrice: true, amount: true } },
    },
  });
  if (!exp) return { ok: false, error: "ไม่พบรายการ" };
  if (exp.status !== "confirmed" && exp.status !== "locked")
    return { ok: false, error: "รับเข้าคลังได้เฉพาะรายการที่ยืนยันแล้ว" };
  if (REAL_DOC(exp.trcloudStockinDocId)) return { ok: true, alreadySent: true };
  if (exp.items.length === 0) return { ok: false, error: "ใบนี้ไม่มีรายการสินค้า (line items) ให้รับเข้าคลัง" };

  // VAT: items are NET (sum→subtotal/pre-VAT). docHasVat from header. claimable input VAT
  // only when the doc has VAT + the category allows + a valid 13-digit vendor tax id.
  const docHasVat = Number(exp.vat) > 0;
  const vatRatePercent = docHasVat ? "7" : "0";
  const taxReport =
    docHasVat &&
    (exp.category?.vatClaimable ?? false) &&
    (exp.vendorTaxId ?? "").replace(/\D/g, "").length === 13;

  // Resolve every line. Distinguish: no-alias (unmatched, needs mapping) vs alias→SKU
  // that isn't stock-tracked (untracked, needs the toggle, NOT a re-map → avoids a loop).
  const lines: StockInLine[] = [];
  const unmatched: string[] = [];
  const untracked: string[] = [];
  for (const it of exp.items) {
    const m = await resolveSku(orgId, exp.companyId, it.description);
    if (!m) { unmatched.push(it.description); continue; }
    if (!m.stockTracked) { untracked.push(it.description); continue; }
    const pack = m.packFactor > 0 ? m.packFactor : 1;
    const baseQty = Number(it.qty) * pack;
    if (!(baseQty > 0) || !Number.isFinite(baseQty))
      return { ok: false, error: `จำนวนของ "${it.description}" ไม่ถูกต้อง (qty=${it.qty}) — แก้ใบก่อน` };
    // NET unit cost per base unit = net line total / base qty (preserves the line total).
    const netTotal = Number(it.amount) > 0 ? Number(it.amount) : Number(it.unitPrice) * Number(it.qty);
    const unitCost = netTotal / baseQty;
    if (!Number.isFinite(unitCost) || unitCost < 0)
      return { ok: false, error: `ต้นทุนของ "${it.description}" ไม่ถูกต้อง — แก้ใบก่อน` };
    lines.push({ productId: m.productId, productName: m.productName || it.description, quantity: baseQty, unitCost, vatRatePercent });
  }
  if (untracked.length > 0)
    return { ok: false, error: `มีสินค้าที่จับคู่ SKU แล้วแต่ยังไม่ได้เปิด "เก็บสต๊อก" ${untracked.length} รายการ — เปิดที่ ตั้งค่า → คลังสินค้า`, untracked };
  if (unmatched.length > 0)
    return { ok: false, error: `มีสินค้าที่ยังไม่ได้จับคู่ SKU ${unmatched.length} รายการ — จับคู่ก่อนรับเข้าคลัง`, unmatched };

  // Branch → TRCloud project (สาขา) + department (BU).
  let project: string | null = null;
  let department: string | null = null;
  if (exp.branchId) {
    const br = await prisma.branch.findFirst({
      where: { id: exp.branchId, orgId, companyId: exp.companyId },
      select: { settings: true },
    });
    const s = br?.settings && typeof br.settings === "object" && !Array.isArray(br.settings)
      ? (br.settings as Record<string, unknown>) : {};
    project = typeof s.trcloudProject === "string" ? s.trcloudProject : null;
    department = typeof s.trcloudDepartment === "string" ? s.trcloudDepartment : null;
  }
  if (!project)
    return { ok: false, error: exp.branchId ? "สาขาของใบนี้ยังไม่ได้ตั้งรหัสโครงการ TRCloud — ตั้งที่ ตั้งค่า → สาขา" : "ใบนี้ยังไม่ได้ระบุสาขา" };

  // Idempotency claim — also re-claimable from 'error' (a prior failed/ambiguous push).
  const claimed = await prisma.ledgerExpense.updateMany({
    where: {
      id: expenseId, orgId, companyId: exp.companyId,
      OR: [{ trcloudStockinDocId: null }, { trcloudStockinDocId: "error" }],
    },
    data: { trcloudStockinDocId: "pending", trcloudStockinError: null },
  });
  if (claimed.count === 0) return { ok: true, alreadySent: true };

  // Intent audit BEFORE the HTTP call (so a mid-flight crash leaves a trail — stock
  // moves on create, this is the irreversible boundary).
  await audit({
    orgId, userId: session.user.id, action: "LEDGER_EXPENSE_STOCKIN_PUSHED",
    resourceType: "ledger_expense", resourceId: expenseId,
    diff: { new: { stage: "started", reference: exp.docCode, lines: lines.map((l) => ({ sku: l.productId, qty: l.quantity, cost: l.unitCost })) } },
  });

  const res = await pushStockIn({
    vendor: exp.vendor, vendorTaxId: exp.vendorTaxId, vendorAddress: exp.vendorAddress,
    orgId, companyId: exp.companyId, docDate: exp.docDate, reference: exp.docCode ?? exp.id,
    note: exp.note, project, department, paymentStatus: exp.paymentStatus, taxReport, lines,
  });

  if (res.ok) {
    await prisma.ledgerExpense.updateMany({
      where: { id: expenseId, orgId, companyId: exp.companyId },
      data: { trcloudStockinDocId: res.docId ?? "sent", trcloudStockinNo: res.docNo, trcloudStockinAt: new Date(), trcloudStockinError: null },
    });
    await audit({
      orgId, userId: session.user.id, action: "LEDGER_EXPENSE_STOCKIN_PUSHED",
      resourceType: "ledger_expense", resourceId: expenseId,
      diff: { new: { stage: "done", docNo: res.docNo, docId: res.docId, lines: lines.length } },
    });
    revalidatePath("/ledger/expenses");
    return { ok: true, docNo: res.docNo };
  }
  await prisma.ledgerExpense.updateMany({
    where: { id: expenseId, orgId, companyId: exp.companyId },
    data: { trcloudStockinDocId: "error", trcloudStockinError: res.error.slice(0, 500) },
  });
  await audit({
    orgId, userId: session.user.id, action: "LEDGER_EXPENSE_STOCKIN_FAILED",
    resourceType: "ledger_expense", resourceId: expenseId, diff: { new: { error: res.error.slice(0, 300) } },
  });
  return { ok: false, error: res.error };
}

/** Reverse/clear a stock-IN: if a real doc exists, delete it in TRCloud (reverses the
 *  stock movement), then clear the expense fields so it can be re-received. Accountant-gated + audited. */
export async function resetExpenseStockIn(expenseId: string): Promise<Result> {
  const g = await moneyGate();
  if (!g.ok) return g;
  const { session } = g;
  const orgId = session.user.org_id;
  const exp = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId },
    select: { id: true, companyId: true, trcloudStockinDocId: true, trcloudStockinNo: true },
  });
  if (!exp) return { ok: false, error: "ไม่พบรายการ" };
  if (REAL_DOC(exp.trcloudStockinDocId)) {
    const del = await deleteStockIn(exp.trcloudStockinDocId!);
    if (!del.ok) return { ok: false, error: `ลบเอกสารใน TRCloud ไม่สำเร็จ: ${del.error ?? ""} (สต๊อกยังไม่ถูกถอน)` };
  }
  await prisma.ledgerExpense.updateMany({
    where: { id: expenseId, orgId, companyId: exp.companyId },
    data: { trcloudStockinDocId: null, trcloudStockinNo: null, trcloudStockinAt: null, trcloudStockinError: null },
  });
  await audit({
    orgId, userId: session.user.id, action: "LEDGER_EXPENSE_STOCKIN_FAILED",
    resourceType: "ledger_expense", resourceId: expenseId,
    diff: { old: { docNo: exp.trcloudStockinNo }, new: { reset: true } },
  });
  revalidatePath("/ledger/expenses");
  return { ok: true };
}
