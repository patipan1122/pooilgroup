"use server";

// LedgerLine — Inventory STOCK-IN server actions (LEDGER_STOCKIN_V1).
//
// Config (sync / toggle stock-tracked / pack units / branch-link) = ADMIN-tier.
// Alias mapping + the stock-IN send = ACCOUNTANT-tier (expense.export) — both
// route/move REAL stock in the live TRCloud book, so they need the money gate, not
// just module access. Every mutation is org+company scoped + audited.
//
// Branch scoping: a SKU with NO branch assignment = available to every branch
// (back-compat). A SKU WITH assignments = a stock-IN from a non-listed branch is
// flagged (กันคีย์ผิดสาขา). TRCloud keeps one on-hand balance per SKU — branch is the
// document `project` for reporting, not a per-branch stock split.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { ledgerWebCanForRole } from "@/lib/ledger/liff-auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { parsePackUnits, type PackUnit } from "@/lib/ledger/sku-match";
import type { PreviewLine, StockInPreview } from "@/lib/ledger/stockin-types";
import {
  syncSkuCache,
  resolveSku,
  normalizeAlias,
  loadSkuBranchScope,
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

/** Config writes (sync / toggle / pack / branch-link) — admin-tier only. */
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

/** Confirm a SKU belongs to the caller's org+company. */
async function skuInScope(orgId: string, companyId: string, skuId: string): Promise<boolean> {
  const s = await prisma.ledgerTrcloudSku.findFirst({ where: { id: skuId, orgId, companyId }, select: { id: true } });
  return !!s;
}

// ── config writes (admin) ─────────────────────────────────────────────────────

/** Admin: pull SKUs from TRCloud into the local cache (optionally filter by business). */
export async function syncSkusAction(
  companyId: string,
  category?: string,
): Promise<Result & { synced?: number; seeded?: number }> {
  const g = await adminGate();
  if (!g.ok) return g;
  if (!(await companyInOrg(g.session.user.org_id, companyId))) return { ok: false, error: "ไม่พบบริษัท" };
  const res = await syncSkuCache({ orgId: g.session.user.org_id, companyId, category });
  if (!res.ok) return res;
  revalidatePath("/ledger/settings/inventory");
  return { ok: true, synced: res.synced, seeded: res.seeded };
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

/** Admin: set the legacy single pack→base-unit factor (kept for back-compat). company-scoped. */
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

/** Admin: set the multi-unit pack list ([{name,factor}] เช่น โหล=12, ลัง=24). company-scoped. */
export async function setSkuPackUnits(skuId: string, companyId: string, units: PackUnit[]): Promise<Result> {
  const g = await adminGate();
  if (!g.ok) return g;
  const clean = parsePackUnits(units);
  const r = await prisma.ledgerTrcloudSku.updateMany({
    where: { id: skuId, orgId: g.session.user.org_id, companyId },
    data: { packUnits: clean },
  });
  if (r.count === 0) return { ok: false, error: "ไม่พบสินค้านี้" };
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

/** Admin: assign / unassign a SKU to a branch. Assigning also turns ON stock-tracked
 *  (a product you tell a branch to buy is one you want to receive). company-scoped. */
export async function setSkuBranchLink(
  skuId: string,
  companyId: string,
  branchId: string,
  on: boolean,
): Promise<Result> {
  const g = await adminGate();
  if (!g.ok) return g;
  const orgId = g.session.user.org_id;
  if (!(await skuInScope(orgId, companyId, skuId))) return { ok: false, error: "ไม่พบสินค้านี้" };
  const branch = await prisma.branch.findFirst({ where: { id: branchId, orgId, companyId }, select: { id: true } });
  if (!branch) return { ok: false, error: "ไม่พบสาขานี้" };

  if (on) {
    await prisma.ledgerSkuBranch.upsert({
      where: { skuId_branchId: { skuId, branchId } },
      update: {},
      create: { orgId, companyId, skuId, branchId, createdBy: g.session.user.id },
    });
    // sensible default — make it receivable right away.
    await prisma.ledgerTrcloudSku.updateMany({ where: { id: skuId, orgId, companyId }, data: { stockTracked: true } });
  } else {
    await prisma.ledgerSkuBranch.deleteMany({ where: { skuId, branchId, orgId, companyId } });
  }
  revalidatePath("/ledger/settings/inventory");
  return { ok: true };
}

// ── alias (accountant — routes stock) ─────────────────────────────────────────

/** Accountant: map a receipt line text → a SKU. Conflict-aware: if the text is already
 *  taught to a DIFFERENT SKU, refuse unless `force` (so we never silently re-route). */
export async function mapSkuAlias(
  companyId: string,
  aliasText: string,
  skuId: string,
  force = false,
): Promise<Result & { conflict?: { existingSkuId: string; existingProductId: string; existingProductName: string | null } }> {
  const g = await moneyGate();
  if (!g.ok) return g;
  const orgId = g.session.user.org_id;
  if (!(await companyInOrg(orgId, companyId))) return { ok: false, error: "ไม่พบบริษัท" };
  const key = normalizeAlias(aliasText);
  if (!key) return { ok: false, error: "ข้อความว่าง" };
  const sku = await prisma.ledgerTrcloudSku.findFirst({ where: { id: skuId, orgId, companyId }, select: { id: true } });
  if (!sku) return { ok: false, error: "ไม่พบสินค้านี้" };

  const existing = await prisma.ledgerSkuAlias.findUnique({
    where: { orgId_companyId_aliasKey: { orgId, companyId, aliasKey: key } },
    include: { sku: { select: { id: true, productId: true, productName: true } } },
  });
  if (existing && existing.skuId !== skuId && !force) {
    return {
      ok: false,
      error: `ชื่อนี้ผูกกับ ${existing.sku.productId} อยู่แล้ว`,
      conflict: { existingSkuId: existing.sku.id, existingProductId: existing.sku.productId, existingProductName: existing.sku.productName },
    };
  }

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

// ── stock-IN preview + send ───────────────────────────────────────────────────

const REAL_DOC = (v: string | null | undefined) => !!v && v !== "pending" && v !== "error";

/** Read-only dry-run of a stock-IN: resolve every line, flag unmatched/untracked/wrong-
 *  branch, and surface the available pack units so the UI can offer a unit per line. */
export async function previewExpenseStockIn(expenseId: string): Promise<StockInPreview> {
  const g = await moneyGate();
  if (!g.ok) return g;
  const orgId = g.session.user.org_id;
  const exp = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId },
    select: {
      id: true, companyId: true, branchId: true, status: true, trcloudStockinDocId: true,
      items: { select: { id: true, description: true, qty: true, unitPrice: true, amount: true } },
    },
  });
  if (!exp) return { ok: false, error: "ไม่พบรายการ" };
  if (exp.status !== "confirmed" && exp.status !== "locked")
    return { ok: false, error: "รับเข้าคลังได้เฉพาะรายการที่ยืนยันแล้ว" };
  if (REAL_DOC(exp.trcloudStockinDocId)) return { ok: false, error: "ใบนี้รับเข้าคลังแล้ว", alreadySent: true };

  // resolve every line first
  const resolved = await Promise.all(
    exp.items.map(async (it) => ({ it, m: await resolveSku(orgId, exp.companyId, it.description) })),
  );
  const trackedSkuIds = resolved.filter((r) => r.m?.stockTracked).map((r) => r.m!.skuId);
  const scope = await loadSkuBranchScope(orgId, exp.companyId, trackedSkuIds);

  const lines: PreviewLine[] = resolved.map(({ it, m }) => {
    if (!m) return { itemId: it.id, description: it.description, qty: Number(it.qty), amount: Number(it.amount), status: "unmatched", sku: null };
    const skuInfo = { skuId: m.skuId, productId: m.productId, productName: m.productName, baseUnit: m.unit, packUnits: m.packUnits };
    if (!m.stockTracked)
      return { itemId: it.id, description: it.description, qty: Number(it.qty), amount: Number(it.amount), status: "untracked", sku: skuInfo };
    const set = scope.get(m.skuId);
    const wrongBranch = set && set.size > 0 && (!exp.branchId || !set.has(exp.branchId));
    return {
      itemId: it.id, description: it.description, qty: Number(it.qty), amount: Number(it.amount),
      status: wrongBranch ? "wrong_branch" : "ok", sku: skuInfo,
    };
  });

  let branchName: string | null = null;
  let projectSet = false;
  if (exp.branchId) {
    const br = await prisma.branch.findFirst({
      where: { id: exp.branchId, orgId, companyId: exp.companyId },
      select: { name: true, settings: true },
    });
    branchName = br?.name ?? null;
    const s = br?.settings && typeof br.settings === "object" && !Array.isArray(br.settings) ? (br.settings as Record<string, unknown>) : {};
    projectSet = typeof s.trcloudProject === "string" && s.trcloudProject.length > 0;
  }
  return { ok: true, branchId: exp.branchId, branchName, projectSet, lines };
}

/** Send a confirmed resale-goods expense into TRCloud as a STOCK-IN (รับเข้าคลัง).
 *  `unitFactorByItem` = per-line chosen unit factor (base=1, or a pack factor). Missing
 *  → falls back to the SKU's legacy pack_factor (so old callers keep working). */
export async function sendExpenseStockIn(
  expenseId: string,
  unitFactorByItem?: Record<string, number>,
): Promise<Result & { docNo?: string | null; unmatched?: string[]; untracked?: string[]; wrongBranch?: string[]; alreadySent?: boolean }> {
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
      items: { select: { id: true, description: true, qty: true, unitPrice: true, amount: true } },
    },
  });
  if (!exp) return { ok: false, error: "ไม่พบรายการ" };
  if (exp.status !== "confirmed" && exp.status !== "locked")
    return { ok: false, error: "รับเข้าคลังได้เฉพาะรายการที่ยืนยันแล้ว" };
  if (REAL_DOC(exp.trcloudStockinDocId)) return { ok: true, alreadySent: true };
  if (exp.items.length === 0) return { ok: false, error: "ใบนี้ไม่มีรายการสินค้า (line items) ให้รับเข้าคลัง" };

  // VAT: items are NET. claimable input VAT only when the doc has VAT + the category
  // allows + a valid 13-digit vendor tax id.
  const docHasVat = Number(exp.vat) > 0;
  const vatRatePercent = docHasVat ? "7" : "0";
  const taxReport =
    docHasVat && (exp.category?.vatClaimable ?? false) && (exp.vendorTaxId ?? "").replace(/\D/g, "").length === 13;

  // Resolve every line: no-alias (unmatched) vs alias→untracked vs ok.
  type Matched = { item: (typeof exp.items)[number]; m: NonNullable<Awaited<ReturnType<typeof resolveSku>>> };
  const matched: Matched[] = [];
  const unmatched: string[] = [];
  const untracked: string[] = [];
  for (const it of exp.items) {
    const m = await resolveSku(orgId, exp.companyId, it.description);
    if (!m) { unmatched.push(it.description); continue; }
    if (!m.stockTracked) { untracked.push(it.description); continue; }
    matched.push({ item: it, m });
  }
  if (untracked.length > 0)
    return { ok: false, error: `มีสินค้าที่จับคู่ SKU แล้วแต่ยังไม่ได้เปิด "เก็บสต๊อก" ${untracked.length} รายการ — เปิดที่ ตั้งค่า → คลังสินค้า`, untracked };
  if (unmatched.length > 0)
    return { ok: false, error: `มีสินค้าที่ยังไม่ได้จับคู่ SKU ${unmatched.length} รายการ — จับคู่ก่อนรับเข้าคลัง`, unmatched };

  // Branch guard — a branch-restricted SKU can only be received at a listed branch.
  const scope = await loadSkuBranchScope(orgId, exp.companyId, matched.map((x) => x.m.skuId));
  const wrongBranch: string[] = [];
  for (const { item, m } of matched) {
    const set = scope.get(m.skuId);
    if (set && set.size > 0 && (!exp.branchId || !set.has(exp.branchId))) wrongBranch.push(item.description);
  }
  if (wrongBranch.length > 0)
    return { ok: false, error: `มีสินค้าที่ไม่ได้กำหนดให้สาขาของใบนี้ ${wrongBranch.length} รายการ — ไปผูกสาขาที่ ตั้งค่า → คลังสินค้า หรือตรวจสาขาของใบ`, wrongBranch };

  // Build lines with the chosen unit factor (default = SKU legacy pack_factor).
  const lines: StockInLine[] = [];
  for (const { item, m } of matched) {
    const chosen = unitFactorByItem?.[item.id];
    const factor = typeof chosen === "number" && chosen > 0 && Number.isFinite(chosen) ? chosen : m.packFactor > 0 ? m.packFactor : 1;
    const baseQty = Number(item.qty) * factor;
    if (!(baseQty > 0) || !Number.isFinite(baseQty))
      return { ok: false, error: `จำนวนของ "${item.description}" ไม่ถูกต้อง (qty=${item.qty}) — แก้ใบก่อน` };
    const netTotal = Number(item.amount) > 0 ? Number(item.amount) : Number(item.unitPrice) * Number(item.qty);
    const unitCost = netTotal / baseQty;
    if (!Number.isFinite(unitCost) || unitCost < 0)
      return { ok: false, error: `ต้นทุนของ "${item.description}" ไม่ถูกต้อง — แก้ใบก่อน` };
    lines.push({ productId: m.productId, productName: m.productName || item.description, quantity: baseQty, unitCost, vatRatePercent });
  }

  // Branch → TRCloud project (สาขา) + department (BU).
  let project: string | null = null;
  let department: string | null = null;
  if (exp.branchId) {
    const br = await prisma.branch.findFirst({ where: { id: exp.branchId, orgId, companyId: exp.companyId }, select: { settings: true } });
    const s = br?.settings && typeof br.settings === "object" && !Array.isArray(br.settings) ? (br.settings as Record<string, unknown>) : {};
    project = typeof s.trcloudProject === "string" ? s.trcloudProject : null;
    department = typeof s.trcloudDepartment === "string" ? s.trcloudDepartment : null;
  }
  if (!project)
    return { ok: false, error: exp.branchId ? "สาขาของใบนี้ยังไม่ได้ตั้งรหัสโครงการ TRCloud — ตั้งที่ ตั้งค่า → สาขา" : "ใบนี้ยังไม่ได้ระบุสาขา" };

  // Idempotency claim — re-claimable from 'error'.
  const claimed = await prisma.ledgerExpense.updateMany({
    where: { id: expenseId, orgId, companyId: exp.companyId, OR: [{ trcloudStockinDocId: null }, { trcloudStockinDocId: "error" }] },
    data: { trcloudStockinDocId: "pending", trcloudStockinError: null },
  });
  if (claimed.count === 0) return { ok: true, alreadySent: true };

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

/** Reverse/clear a stock-IN: delete the TRCloud doc (reverses stock) then clear the
 *  expense fields so it can be re-received. Accountant-gated + audited. */
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
