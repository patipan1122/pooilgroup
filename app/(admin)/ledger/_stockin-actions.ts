"use server";

// LedgerLine — Inventory STOCK-IN server actions (LEDGER_STOCKIN_V1).
//
// Config: sync SKUs from TRCloud, toggle which are stock-tracked, set pack factor,
// map receipt-text → SKU aliases. Action: send a confirmed resale-goods expense into
// TRCloud as a stock-IN AP (รับเข้าคลัง). All admin/accountant-gated + audited.

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
  type StockInLine,
} from "@/lib/ledger/trcloud-inventory";

type Result = { ok: true } | { ok: false; error: string };

async function gate(): Promise<
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

/** Admin: pull SKUs from TRCloud into the local cache (optionally filter by business). */
export async function syncSkusAction(
  companyId: string,
  category?: string,
): Promise<Result & { synced?: number }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!companyId) return { ok: false, error: "ไม่ได้ระบุบริษัท" };
  const res = await syncSkuCache({ orgId: g.session.user.org_id, companyId, category });
  if (!res.ok) return res;
  revalidatePath("/ledger/settings/inventory");
  return { ok: true, synced: res.synced };
}

/** Admin: toggle whether a SKU is stock-tracked (only these can receive stock). */
export async function toggleSkuStockTracked(skuId: string, on: boolean): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  const r = await prisma.ledgerTrcloudSku.updateMany({
    where: { id: skuId, orgId: g.session.user.org_id },
    data: { stockTracked: on },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบสินค้านี้" };
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

/** Admin: set the pack→base-unit factor (1 ลัง = N ขวด). */
export async function setSkuPackFactor(skuId: string, factor: number): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  if (!(factor > 0)) return { ok: false, error: "จำนวนต่อแพ็คต้องมากกว่า 0" };
  const r = await prisma.ledgerTrcloudSku.updateMany({
    where: { id: skuId, orgId: g.session.user.org_id },
    data: { packFactor: factor },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบสินค้านี้" };
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

/** Admin: map a receipt line text → a SKU (the learned alias). */
export async function mapSkuAlias(companyId: string, aliasText: string, skuId: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  const key = normalizeAlias(aliasText);
  if (!key) return { ok: false, error: "ข้อความว่าง" };
  // confirm the SKU belongs to this org+company
  const sku = await prisma.ledgerTrcloudSku.findFirst({
    where: { id: skuId, orgId: g.session.user.org_id, companyId },
    select: { id: true },
  });
  if (!sku) return { ok: false, error: "ไม่พบสินค้านี้" };
  await prisma.ledgerSkuAlias.upsert({
    where: { orgId_companyId_aliasKey: { orgId: g.session.user.org_id, companyId, aliasKey: key } },
    update: { skuId, source: "admin", createdBy: g.session.user.id },
    create: { orgId: g.session.user.org_id, companyId, aliasKey: key, skuId, source: "admin", createdBy: g.session.user.id },
  });
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

export async function deleteSkuAlias(aliasId: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  await prisma.ledgerSkuAlias.deleteMany({ where: { id: aliasId, orgId: g.session.user.org_id } });
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

/** Send a confirmed resale-goods expense into TRCloud as a STOCK-IN (รับเข้าคลัง).
 *  Resolves each line to a stock SKU via alias; if ANY line is unmatched → returns
 *  the unmatched texts (UI prompts the admin to map them) and pushes NOTHING. */
export async function sendExpenseStockIn(
  expenseId: string,
): Promise<Result & { docNo?: string | null; unmatched?: string[]; alreadySent?: boolean }> {
  const g = await gate();
  if (!g.ok) return g;
  const { session } = g;
  const orgId = session.user.org_id;
  // STOCK-IN moves real inventory → accountant-tier only (same gate as TRCloud push).
  if (!(await ledgerWebCanForRole(orgId, session.user.role, "expense.export"))) {
    return { ok: false, error: "เฉพาะบัญชี/ผู้ดูแลรับเข้าคลังได้" };
  }

  const exp = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId },
    select: {
      id: true, companyId: true, branchId: true, status: true, docCode: true,
      vendor: true, vendorTaxId: true, vendorAddress: true, docDate: true,
      paymentStatus: true, note: true, trcloudStockinDocId: true,
      items: { select: { description: true, qty: true, unitPrice: true, amount: true } },
    },
  });
  if (!exp) return { ok: false, error: "ไม่พบรายการ" };
  if (exp.status !== "confirmed" && exp.status !== "locked") {
    return { ok: false, error: "รับเข้าคลังได้เฉพาะรายการที่ยืนยันแล้ว" };
  }
  if (exp.trcloudStockinDocId) return { ok: true, alreadySent: true };
  if (exp.items.length === 0) return { ok: false, error: "ใบนี้ไม่มีรายการสินค้า (line items) ให้รับเข้าคลัง" };

  // Resolve every line to a stock SKU; collect unmatched.
  const lines: StockInLine[] = [];
  const unmatched: string[] = [];
  for (const it of exp.items) {
    const m = await resolveSku(orgId, exp.companyId, it.description);
    if (!m) {
      unmatched.push(it.description);
      continue;
    }
    const pack = m.packFactor || 1;
    const qty = Number(it.qty) * pack;
    const unitCost = pack > 0 ? Number(it.unitPrice) / pack : Number(it.unitPrice);
    lines.push({ productId: m.productId, productName: m.productName || it.description, quantity: qty, unitCost });
  }
  if (unmatched.length > 0) {
    return { ok: false, error: `มีสินค้าที่ยังไม่ได้จับคู่ SKU ${unmatched.length} รายการ — จับคู่ก่อนรับเข้าคลัง`, unmatched };
  }

  // Resolve branch → TRCloud project (สาขา) + department (BU) from branch settings.
  let project: string | null = null;
  let department: string | null = null;
  if (exp.branchId) {
    const br = await prisma.branch.findUnique({ where: { id: exp.branchId }, select: { settings: true } });
    const s = (br?.settings && typeof br.settings === "object" && !Array.isArray(br.settings)
      ? (br.settings as Record<string, unknown>)
      : {});
    project = typeof s.trcloudProject === "string" ? s.trcloudProject : null;
    department = typeof s.trcloudDepartment === "string" ? s.trcloudDepartment : null;
  }

  // Idempotency claim: mark 'pending' so a concurrent click can't double-receive.
  const claimed = await prisma.ledgerExpense.updateMany({
    where: { id: expenseId, orgId, companyId: exp.companyId, trcloudStockinDocId: null },
    data: { trcloudStockinDocId: "pending" },
  });
  if (claimed.count === 0) return { ok: true, alreadySent: true };

  const res = await pushStockIn({
    vendor: exp.vendor, vendorTaxId: exp.vendorTaxId, vendorAddress: exp.vendorAddress,
    orgId, companyId: exp.companyId, docDate: exp.docDate, reference: exp.docCode ?? exp.id,
    note: exp.note, project, department, paymentStatus: exp.paymentStatus, lines,
  });

  if (res.ok) {
    await prisma.ledgerExpense.updateMany({
      where: { id: expenseId, orgId, companyId: exp.companyId },
      data: { trcloudStockinDocId: res.docId ?? "sent", trcloudStockinNo: res.docNo, trcloudStockinAt: new Date(), trcloudStockinError: null },
    });
    await audit({
      orgId, userId: session.user.id, action: "LEDGER_EXPENSE_STOCKIN_PUSHED",
      resourceType: "ledger_expense", resourceId: expenseId,
      diff: { new: { docNo: res.docNo, lines: lines.length } },
    });
    revalidatePath("/ledger/expenses");
    return { ok: true, docNo: res.docNo };
  }
  // failure → release the claim to 'error' so it isn't stuck on 'pending'
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
