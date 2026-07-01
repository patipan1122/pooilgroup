/**
 * ตู้คีบ OS — คลังสินค้า (Stock / Warehouse)
 * Server: โหลดสาขาจริง + เอกสารสต๊อกจริง (รับของ/นับ/ของหาย/ใบกระจาย) + ยอดคลังกลางจริง.
 * ถ้า DB ว่าง → client ใช้ sample fallback (ตาม pattern ClawFleet เดิม) เพื่อไม่ให้หน้าโล่ง.
 *
 * เอกสารโหลดจาก "สาขาแรก" เป็น real seed (กันยิง query หนักทุกสาขา) — แท็บ รับของ/นับ/ตัดของเสีย/
 * การกระจาย มี dropdown เลือกสาขา → ฟอร์มสร้างเขียนเข้าสาขาที่เลือกจริง (orgId-scoped + role guard
 * ใน server action). ยอดคลังกลาง (warehouse = movement ที่ machineId null) รวมทุกสาขาที่ user เห็น.
 */
import { prisma } from "@/lib/prisma";
import { getV2Branches, getV2BranchStock } from "@/lib/clawfleet/queries";
import { requireCfSession, userBranchIds, isCfAdmin, isCfBranchManager } from "@/lib/clawfleet/role-guard";
import {
  getCfStockOverview,
  getCfReceipts,
  getCfCounts,
  getCfLosses,
  getCfProductsForForms,
} from "@/lib/clawfleet/stock-queries";
import {
  StockClient,
  type BranchStockSeed,
  type ReceiptSeed,
  type BranchOption,
  type ProductOption,
  type DocReceiptSeed,
  type DocCountSeed,
  type DocLossSeed,
  type WarehouseRowSeed,
  type ShipmentSeed,
} from "./stock-client";

export const dynamic = "force-dynamic";

const REASON_TH: Record<string, string> = {
  DAMAGE: "ชำรุด/เสียหาย",
  THEFT: "สูญหาย/ถูกขโมย",
  OBSOLETE: "ล้าสมัย/ตัดทิ้ง",
  OTHER: "อื่น ๆ",
};

export default async function StockPage() {
  let branchSeeds: BranchStockSeed[] = [];
  // ปุ่ม "โอนสินค้า" / "ตรวจรับ" / สร้างเอกสาร ต้องเขียน DB จริง → ต้องมี id จริง (UUID)
  let realBranches: BranchOption[] = [];
  let products: ProductOption[] = [];
  // เอกสารจริง (สาขาแรก) สำหรับ 3 แท็บใหม่ + การกระจาย + ยอดคลังกลางจริง
  let receiptDocs: DocReceiptSeed[] = [];
  let countDocs: DocCountSeed[] = [];
  let lossDocs: DocLossSeed[] = [];
  let warehouseRows: WarehouseRowSeed[] = [];
  let shipments: ShipmentSeed[] = [];
  let docBranchId: string | null = null; // สาขาที่โหลดเอกสารจริงมา (= สาขาแรก)
  // D1 maker-checker: ใครกำลังดู + มีสิทธิ์อนุมัติใบตัดของเสียไหม (ผจก.สาขา/แอดมิน)
  let viewerId = "";
  let canReviewLoss = false;

  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    viewerId = session.user.id;
    canReviewLoss = isCfAdmin(session.user.role) || isCfBranchManager(session.user.role);
    const branches = await getV2Branches();
    realBranches = branches.map((b) => ({ id: b.id, name: b.name }));
    try {
      const ps = await getCfProductsForForms(orgId);
      products = ps.map((p) => ({ id: p.id, name: p.name, unitCostCents: p.unitCostCents }));
    } catch {
      // graceful: ยังไม่มีตาราง/สินค้า → ฟอร์มจะปิดการใช้งานเอง
    }

    if (branches.length > 0) {
      const first = branches[0];
      docBranchId = first.id;
      let overview: Awaited<ReturnType<typeof getCfStockOverview>> | null = null;
      let branchStock: Awaited<ReturnType<typeof getV2BranchStock>> | null = null;
      let receipts: Awaited<ReturnType<typeof getCfReceipts>> = [];
      let counts: Awaited<ReturnType<typeof getCfCounts>> = [];
      let losses: Awaited<ReturnType<typeof getCfLosses>> = [];
      try {
        [overview, branchStock, receipts, counts, losses] = await Promise.all([
          getCfStockOverview(orgId, first.id),
          getV2BranchStock(first.id),
          getCfReceipts(orgId, first.id),
          getCfCounts(orgId, first.id),
          getCfLosses(orgId, first.id),
        ]);
      } catch {
        // graceful: ตารางสต็อกยังว่าง → ปล่อยให้ client เติม sample
      }

      receiptDocs = receipts.map((r) => ({
        id: r.id,
        code: r.receiptCode,
        supplier: r.supplierName,
        itemsCount: r.itemsCount,
        totalCostCents: r.totalCostCents,
        createdAt: r.createdAt.toISOString(),
      }));
      countDocs = counts.map((c) => ({
        id: c.id,
        code: c.countCode,
        countedBy: c.countedByName,
        itemsCounted: c.itemsCounted,
        totalDiff: c.totalDiff,
        countedAt: c.countedAt.toISOString(),
      }));
      lossDocs = losses.map((l) => ({
        id: l.id,
        code: l.lossCode,
        reasonLabel: REASON_TH[l.reason] ?? l.reason,
        itemsCount: l.itemsCount,
        totalCostCents: l.totalCostCents,
        reportedAt: l.reportedAt.toISOString(),
        // D1 maker-checker: สถานะ + คนแจ้ง (client ใช้ตัดสินว่าโชว์ pill/ปุ่มอนุมัติหรือไม่)
        status: l.status,
        reportedById: l.reportedById,
        reviewedByName: l.reviewedByName,
      }));

      // ── ยอดคลังกลางจริง (warehouse = movement machineId null) รวมทุกสาขาที่ user เห็น ──
      try {
        const allowed = await userBranchIds(session);
        warehouseRows = await loadWarehouseRows(orgId, allowed, branches);
      } catch {
        // graceful
      }

      // ── ใบกระจายจริง (รวมทุกสาขาที่ user เห็น) ──
      try {
        const allowed = await userBranchIds(session);
        shipments = await loadShipments(orgId, allowed);
      } catch {
        // graceful
      }

      branchSeeds = branches.map((b, i) => {
        const isFirst = i === 0;
        const dolls = isFirst && branchStock
          ? branchStock.stock.reduce((s, e) => s + e.warehouse + e.inMachines, 0)
          : 0;
        const valueCents = isFirst && overview ? overview.inventoryValueCents : 0;
        const lowCount = isFirst && overview ? overview.lowCount : 0;
        const rcs: ReceiptSeed[] = isFirst
          ? receipts.slice(0, 3).map((r) => ({
              items: `${r.itemsCount} รายการ · ${r.receiptCode}`,
              date: r.createdAt.toISOString(),
              status: "received",
            }))
          : [];
        return {
          branchId: b.id,
          branch: b.name,
          dolls,
          valueCents,
          lowCount,
          receipts: rcs,
          hasReal: isFirst && dolls > 0,
        };
      });

      // ถ้าสาขาแรกก็ไม่มีของจริงเลย → ถือว่าทั้งหน้าไม่มี data จริง → client sample เต็ม
      if (!branchSeeds.some((s) => s.hasReal)) branchSeeds = [];
    }
  } catch {
    // graceful: ยังไม่ login / DB ว่าง / ยังไม่ migrate → sample fallback
  }

  return (
    <StockClient
      branches={branchSeeds}
      realBranches={realBranches}
      products={products}
      receiptDocs={receiptDocs}
      countDocs={countDocs}
      lossDocs={lossDocs}
      warehouseRows={warehouseRows}
      shipments={shipments}
      docBranchId={docBranchId}
      viewerId={viewerId}
      canReviewLoss={canReviewLoss}
    />
  );
}

/**
 * ยอดคลังกลางต่อสินค้า = ผลรวม signed qty ใน movement ที่ machineId null (= คลังสาขา · ไม่ใช่ในตู้)
 * รวมข้ามทุกสาขาที่ user เห็น (คลังกลางในมุมหลังบ้าน = ยอดรวมที่ยังไม่อยู่ในตู้) + การกระจายต่อสาขา.
 */
async function loadWarehouseRows(
  orgId: string,
  allowed: string[] | "ALL",
  branches: { id: string; name: string }[],
): Promise<WarehouseRowSeed[]> {
  const branchFilter = allowed === "ALL" ? {} : { branchId: { in: allowed } };
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const products = await prisma.cfProduct.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, category: true },
    orderBy: { name: "asc" },
  });
  if (products.length === 0) return [];

  // ยอดคลังต่อ product (รวมทุกสาขา) + ยอดต่อ product×สาขา (สำหรับ distribution bar)
  const totals = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: { orgId, machineId: null, ...branchFilter },
    _sum: { qty: true },
    _max: { occurredAt: true },
  });
  const perBranch = await prisma.cfStockMovement.groupBy({
    by: ["productId", "branchId"],
    where: { orgId, machineId: null, ...branchFilter },
    _sum: { qty: true },
  });
  const totalMap = new Map(totals.map((t) => [t.productId, { qty: t._sum.qty ?? 0, last: t._max.occurredAt }]));
  const distMap = new Map<string, { branch: string; qty: number }[]>();
  for (const r of perBranch) {
    const qty = r._sum.qty ?? 0;
    if (qty <= 0) continue;
    const arr = distMap.get(r.productId) ?? [];
    arr.push({ branch: branchName.get(r.branchId) ?? "สาขา", qty });
    distMap.set(r.productId, arr);
  }
  const pcat = new Map(products.map((p) => [p.id, p]));

  return Array.from(totalMap.entries())
    .map(([productId, v]) => {
      const p = pcat.get(productId);
      return {
        id: productId,
        name: p?.name ?? "สินค้า",
        cat: p?.category ?? "OTHER",
        qty: v.qty,
        recvISO: v.last ? v.last.toISOString() : null,
        dist: (distMap.get(productId) ?? []).sort((a, b) => b.qty - a.qty),
      };
    })
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty);
}

/** ใบกระจายจริง (cf_deliveries + lines) รวมทุกสาขาที่ user เห็น */
async function loadShipments(orgId: string, allowed: string[] | "ALL"): Promise<ShipmentSeed[]> {
  const branchFilter = allowed === "ALL" ? {} : { branchId: { in: allowed } };
  const rows = await prisma.cfDelivery.findMany({
    where: { orgId, ...branchFilter },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      status: true,
      itemsCount: true,
      unitsCount: true,
      createdAt: true,
      branch: { select: { name: true } },
      lines: { select: { id: true, productName: true, qty: true, receivedQty: true } },
    },
  });
  return rows.map((d) => ({
    id: d.id,
    to: d.branch.name,
    status: d.status,
    unitsCount: d.unitsCount,
    createdAt: d.createdAt.toISOString(),
    lines: d.lines.map((l) => ({
      lineId: l.id,
      name: l.productName,
      sent: l.qty,
      received: d.status === "DELIVERED" ? l.receivedQty : null,
    })),
  }));
}
