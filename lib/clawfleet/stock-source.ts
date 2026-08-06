// ClawFleet · "คลังหลักข้ามสาขา" (cross-branch main warehouse) — helper กลาง money-safe.
// สาขา A ตั้ง stockSourceBranchId = B → A "ใช้คลังของ B เป็นคลังหลัก":
//   • เติมตู้ A  = โอน B→A (ห้องหลัก) แล้วโหลดเข้าตู้ A  → ชั้นของ A สุทธิ 0 · ของออกจาก B
//   • คืนสโตร์ A = เอาออกจากตู้ A (ADJUST) แล้วโอน A→B (ห้องหลัก) → ชั้นของ A สุทธิ 0 · ของกลับ B
// ทุกอย่างอยู่ใน $transaction ของ caller (atomic กับการโหลด/คืน) — ต้นทุนพกจาก product (org-wide) เอง.
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getBranchMainWarehouseId, getCfBranchStockProducts, type CfStockProductRow } from "./stock-queries";

type Tx = Prisma.TransactionClient;

/** map ทุกสาขาตู้คีบ → คลังต้นทาง (null = ใช้คลังตัวเอง) — สำหรับหน้าจัดการสาขา (dropdown ตั้งค่า). */
export async function getStockSourceMap(orgId: string): Promise<Record<string, string | null>> {
  const rows = await prisma.branch.findMany({
    where: { orgId, businessType: "claw_machine" },
    select: { id: true, stockSourceBranchId: true },
  });
  const out: Record<string, string | null> = {};
  for (const r of rows) out[r.id] = r.stockSourceBranchId;
  return out;
}

/** คลังต้นทางของสาขา (คลังหลักข้ามสาขา) — คืน branchId ต้นทาง หรือ null (= ใช้คลังตัวเอง · เดิม). */
export async function getStockSourceBranchId(orgId: string, branchId: string): Promise<string | null> {
  const b = await prisma.branch.findFirst({
    where: { id: branchId, orgId },
    select: { stockSourceBranchId: true },
  });
  return b?.stockSourceBranchId ?? null;
}

/** ยอด NET ห้องหลัก (main · รวมแถว legacy warehouseId null) ของสาขา ต่อสินค้า — mirror currentNetShelf(main scope). */
async function mainRoomNet(
  tx: Tx,
  orgId: string,
  branchId: string,
  productId: string,
  mainWh: string | null,
): Promise<number> {
  const whFilter: Record<string, unknown> =
    mainWh == null ? {} : { OR: [{ warehouseId: mainWh }, { warehouseId: null }] };
  const agg = await tx.cfStockMovement.aggregate({
    where: { orgId, branchId, productId, ...whFilter },
    _sum: { qty: true },
  });
  return agg._sum.qty ?? 0;
}

/** ยอด NET ห้องหลักของ "คลังต้นทาง" ต่อสินค้า (สำหรับ read: picker โชว์ของ B ให้ A เลือก · ตรงกับ guard). */
export async function getSourceMainRoomNet(
  orgId: string,
  sourceBranchId: string,
  productIds?: string[],
): Promise<Record<string, number>> {
  const mainWh = await getBranchMainWarehouseId(orgId, sourceBranchId);
  const whFilter: Record<string, unknown> =
    mainWh == null ? {} : { OR: [{ warehouseId: mainWh }, { warehouseId: null }] };
  const rows = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: {
      orgId,
      branchId: sourceBranchId,
      ...(productIds && productIds.length > 0 ? { productId: { in: productIds } } : {}),
      ...whFilter,
    },
    _sum: { qty: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.productId] = r._sum.qty ?? 0;
  return out;
}

/**
 * 🎯 CHOKE-POINT เดียว — สินค้า + ยอด "คลังที่ใช้เติมตู้ได้" ของสาขา (honor คลังหลักข้ามสาขา).
 *   • ปกติ (ไม่ตั้ง redirect): ของสาขานั้นเอง (getCfBranchStockProducts).
 *   • ตั้ง stockSourceBranchId=B: **รายการ SKU มาจากคลัง B** · warehouse = NET ห้องหลัก B (ตรงกับ guard ตอนเติม).
 *   never-throw: error/ยังไม่ migrate → fallback เป็นของสาขาตัวเอง (ไม่ทำหน้าเติมพัง).
 * ทุก picker เติมตู้ (เติมรอบ / ทัวร์ 7-11 / baseline / เปลี่ยนตุ๊กตา · แอดมิน + LIFF) ต้องเรียกตัวนี้
 *   → ตั้งคลังข้ามสาขาครั้งเดียว ได้ผลทุกฟังก์ชันอัตโนมัติ (กันตกหล่นแบบแก้ทีละหน้า).
 * ⚠️ อย่าเอาไปใช้กับ valuation / นับสต๊อกจริง / คลังกลาง — พวกนั้นต้องเป็น "ของสาขาตัวเอง" (getCfBranchStockProducts ตรง ๆ)
 *   ไม่งั้นมูลค่าซ้ำ / ยอดนับเพี้ยน.
 */
export async function getCfRefillAvailability(orgId: string, branchId: string): Promise<CfStockProductRow[]> {
  let srcId: string | null = null;
  try {
    const b = await prisma.branch.findFirst({ where: { id: branchId, orgId }, select: { stockSourceBranchId: true } });
    srcId = b?.stockSourceBranchId ?? null;
  } catch {
    srcId = null;
  }
  if (!srcId) return getCfBranchStockProducts(orgId, branchId);
  // รายการ SKU + ชื่อ/รูป มาจากคลังต้นทาง B (ถ้าดึงไม่ได้จริง ๆ ค่อย fallback สาขาตัวเอง)
  let products: CfStockProductRow[];
  try {
    products = await getCfBranchStockProducts(orgId, srcId);
  } catch {
    return getCfBranchStockProducts(orgId, branchId);
  }
  // warehouse = NET ห้องหลัก B (ตรง guard เติม) — ถ้าคำนวณ net ไม่ได้ ใช้ gross ของ B แทน (ยังโชว์รายการ · ไม่ทำ list ว่าง)
  let net: Record<string, number> | null = null;
  try {
    net = await getSourceMainRoomNet(orgId, srcId, products.map((p) => p.id));
  } catch {
    net = null;
  }
  return products.map((p) => ({ ...p, warehouse: net ? (net[p.id] ?? 0) : p.warehouse }));
}

export class CfSourceOverIssueError extends Error {}

/**
 * โอนสต๊อก 1 สินค้า "ห้องหลัก→ห้องหลัก" ระหว่างสาขา (คลังหลักข้ามสาขา) — ต้องเรียก "ภายใน" $transaction ของ caller.
 * - เขียน 2 แถว: TRANSFER_OUT(from,-qty) · TRANSFER_IN(to,+qty) — ต้นทุน (unitCostCents) พกจาก product เดียวกัน.
 * - guard: ห้องหลักของ "from" ต้องมี NET ≥ qty (กันโอนเกินของบนชั้น) → CfSourceOverIssueError.
 * - lock: (branch:ห้องหลัก, product) ของ from + to เรียงตาม key (กัน deadlock ข้ามทิศ refill/return);
 *   คีย์ล็อกตรงกับ path เติมปกติของสาขานั้น → serialize กับการโหลด/เติมของสาขา from ด้วย (กัน over-issue จริง).
 */
export async function transferMainRoomBetweenBranchesTx(
  tx: Tx,
  opts: {
    orgId: string;
    userId: string;
    fromBranchId: string;
    toBranchId: string;
    productId: string;
    qty: number;
    unitCostCents: number | null;
    refTable: string;
    refId: string | null;
    note: string;
  },
): Promise<void> {
  const { orgId, userId, fromBranchId, toBranchId, productId, qty, unitCostCents, refTable, refId, note } =
    opts;
  if (qty <= 0) return;
  // อ่านคลังหลักผ่าน tx เดียวกัน (connection เดียว · กัน pool starvation ระหว่าง interactive tx)
  const mainOf = async (bid: string): Promise<string | null> =>
    (await tx.cfWarehouse.findFirst({ where: { orgId, branchId: bid, isMain: true }, select: { id: true } }))?.id ??
    null;
  const fromMain = await mainOf(fromBranchId);
  const toMain = await mainOf(toBranchId);

  // lock ทั้งสองสาขา (ห้องหลัก,สินค้า) เรียง key → ทิศไหน (refill B→A / return A→B) ก็ล็อกลำดับเดียวกัน = ไม่มี deadlock cycle.
  // key ตรงกับ path เติมปกติ: `${branchId}:${mainWh ?? "MAIN"}` (actions.ts/stock-actions.ts) → serialize กับการโหลดของ from.
  const keyFor = (bid: string, main: string | null) => `${bid}:${main ?? "MAIN"}`;
  const lockKeys = [keyFor(fromBranchId, fromMain), keyFor(toBranchId, toMain)].sort();
  for (const k of lockKeys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${k}), hashtext(${productId}))`;
  }

  const fromNet = await mainRoomNet(tx, orgId, fromBranchId, productId, fromMain);
  if (qty > fromNet) {
    throw new CfSourceOverIssueError(`คลังต้นทางมี ${fromNet} ตัว · ต้องใช้ ${qty} ตัวไม่พอ`);
  }

  const now = new Date();
  await tx.cfStockMovement.create({
    data: {
      orgId,
      branchId: fromBranchId,
      type: "TRANSFER_OUT",
      productId,
      warehouseId: fromMain ?? undefined,
      qty: -qty,
      unitCostCents: unitCostCents ?? undefined,
      refTable,
      refId,
      occurredAt: now,
      createdById: userId,
      documentType: "transfer",
      reason: note,
    },
  });
  await tx.cfStockMovement.create({
    data: {
      orgId,
      branchId: toBranchId,
      type: "TRANSFER_IN",
      productId,
      warehouseId: toMain ?? undefined,
      qty,
      unitCostCents: unitCostCents ?? undefined,
      refTable,
      refId,
      occurredAt: now,
      createdById: userId,
      documentType: "transfer",
      reason: note,
    },
  });
}
