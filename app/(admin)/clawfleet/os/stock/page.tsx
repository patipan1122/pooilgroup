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
  getCfBranchOnHandMap,
  getCfMovements,
  getCfMachinesForBranchAdmin,
  getMachineLoadout,
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
  type MovementSeed,
} from "./stock-client";
import type { MachineSeed, LoadoutItemSeed } from "./machine-detail";

export const dynamic = "force-dynamic";

const REASON_TH: Record<string, string> = {
  DAMAGE: "ชำรุด/เสียหาย",
  THEFT: "สูญหาย/ถูกขโมย",
  OBSOLETE: "ล้าสมัย/ตัดทิ้ง",
  OTHER: "อื่น ๆ",
};

export default async function StockPage({
  searchParams,
}: {
  // ?branch=<id> → เลือกสาขาที่จะโหลดเอกสาร (รับของ/นับ/ตัดของเสีย) มาแสดง (item #9)
  // ?asof=YYYY-MM-DD → คิด "มูลค่าสต๊อก ณ วันที่" นั้นจาก ledger (default = วันนี้ · ไม่ใส่ = ปัจจุบัน)
  searchParams?: Promise<{ branch?: string; asof?: string }>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const requestedBranchId = typeof sp?.branch === "string" ? sp.branch : null;
  // parse ?asof — รับเฉพาะ YYYY-MM-DD ที่เป็นวันที่จริงและไม่เกินวันนี้ (ย้อนหลังเท่านั้น)
  const asOfDate = parseAsOf(typeof sp?.asof === "string" ? sp.asof : null);
  // ส่งกลับ client เป็น string YYYY-MM-DD สำหรับ badge + ค่าเริ่มต้น date picker (null = ปัจจุบัน)
  const asOfISO = asOfDate ? toYmd(asOfDate) : null;

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
  let docBranchId: string | null = null; // สาขาที่โหลดเอกสารจริงมา (= สาขาที่เลือก หรือสาขาแรก)
  let onHandMap: Record<string, number> = {}; // ยอด "ระบบมี" ต่อสินค้า ของสาขาเอกสาร (กันนับตาบอด)
  let movements: MovementSeed[] = []; // ledger การเคลื่อนไหวสต๊อกของสาขาเอกสาร (สำหรับดาวน์โหลด CSV)
  // D1 maker-checker: ใครกำลังดู + มีสิทธิ์อนุมัติใบตัดของเสียไหม (ผจก.สาขา/แอดมิน)
  let viewerId = "";
  let canReviewLoss = false;
  // surface-existing — รายชื่อตู้ (ในสโคป user) + โหลดเอาต์ปัจจุบันต่อตู้ (สำหรับแท็บ "ไส้ในตู้")
  let machines: MachineSeed[] = [];
  let loadoutByMachine: Record<string, LoadoutItemSeed[]> = {};

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

    // ── รายชื่อตู้ + โหลดเอาต์ปัจจุบันต่อตู้ (แท็บ "ไส้ในตู้") ──
    // query กรองสาขาตามสิทธิ์อยู่แล้ว · โหลดเอาต์ต่อตู้เล็ก → โหลด eager (กด modal เปิดทันที)
    try {
      const ms = await getCfMachinesForBranchAdmin();
      machines = ms.map((m) => ({
        id: m.id,
        code: m.code,
        nickname: m.nickname,
        branchName: m.branchName,
        kind: m.kind,
        isActive: m.isActive,
      }));
      const loadouts = await Promise.all(machines.map((m) => getMachineLoadout(m.id)));
      loadoutByMachine = {};
      machines.forEach((m, i) => {
        loadoutByMachine[m.id] = loadouts[i].map((l) => ({
          productId: l.productId,
          productName: l.productName,
          imageUrl: l.imageUrl,
          pricePerPlayCoins: l.pricePerPlayCoins,
          setAtISO: l.setAt.toISOString(),
        }));
      });
    } catch {
      // graceful: ยังไม่มีตู้/ยังไม่ migrate → แท็บจะขึ้น empty state
    }

    if (branches.length > 0) {
      // สาขาเอกสาร = สาขาที่เลือกจาก ?branch (ถ้าอยู่ในลิสต์สาขาที่ user เห็น) ไม่งั้นสาขาแรก
      // (item #9 · validate กับ branches ที่ getV2Branches คืน = สาขาที่ user มีสิทธิ์เห็นอยู่แล้ว)
      const first =
        (requestedBranchId && branches.find((b) => b.id === requestedBranchId)) || branches[0];
      docBranchId = first.id;
      let overview: Awaited<ReturnType<typeof getCfStockOverview>> | null = null;
      let branchStock: Awaited<ReturnType<typeof getV2BranchStock>> | null = null;
      let receipts: Awaited<ReturnType<typeof getCfReceipts>> = [];
      let counts: Awaited<ReturnType<typeof getCfCounts>> = [];
      let losses: Awaited<ReturnType<typeof getCfLosses>> = [];
      try {
        [overview, branchStock, receipts, counts, losses, onHandMap] = await Promise.all([
          getCfStockOverview(orgId, first.id, asOfDate ?? undefined),
          getV2BranchStock(first.id),
          getCfReceipts(orgId, first.id),
          getCfCounts(orgId, first.id),
          getCfLosses(orgId, first.id),
          getCfBranchOnHandMap(orgId, first.id),
        ]);
      } catch {
        // graceful: ตารางสต็อกยังว่าง → ปล่อยให้ client เติม sample
      }

      // ledger การเคลื่อนไหวสต๊อกของสาขาเอกสาร (สำหรับปุ่มดาวน์โหลด CSV · ไม่โชว์เป็นตารางใหญ่)
      try {
        const mv = await getCfMovements(orgId, first.id, 500);
        movements = mv.map((m) => ({
          id: m.id,
          type: m.type,
          productName: m.productName,
          qty: m.qty,
          reason: m.reason,
          documentType: m.documentType,
          occurredAt: m.occurredAt.toISOString(),
        }));
      } catch {
        // graceful
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
        // Wave 4b maker-checker: สถานะ + ผู้นับ (client ใช้ตัดสิน pill/ปุ่มอนุมัติ · maker≠checker)
        status: c.status,
        countedById: c.countedById,
        reviewedByName: c.reviewedByName,
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

      branchSeeds = branches.map((b) => {
        // "isFirst" = สาขาเอกสารที่โหลดข้อมูลจริงมา (อาจไม่ใช่ index 0 ถ้าเลือกสาขาอื่นผ่าน ?branch)
        const isFirst = b.id === first.id;
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
      movements={movements}
      docBranchId={docBranchId}
      onHandMap={onHandMap}
      viewerId={viewerId}
      canReviewLoss={canReviewLoss}
      asOfISO={asOfISO}
      machines={machines}
      loadoutByMachine={loadoutByMachine}
    />
  );
}

/** วันนี้เป็น string YYYY-MM-DD (โซนเซิร์ฟเวอร์) */
function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * แปลง ?asof=YYYY-MM-DD → Date (ปิดสิ้นวันนั้นทำใน query แล้ว).
 * คืน null ถ้า: ไม่ส่ง · รูปแบบผิด · ไม่ใช่วันจริง · เป็นวันนี้/อนาคต (ปัจจุบัน = ไม่ต้องคิด as-of).
 */
function parseAsOf(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, mo - 1, day, 0, 0, 0, 0);
  // ตรวจว่าเป็นวันจริง (กัน 2026-02-31 กลายเป็น มี.ค.)
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // วันนี้/อนาคต → ถือเป็น "ปัจจุบัน" (ไม่ส่ง asOf) เพื่อใช้ต้นทุนวันนี้ตามเดิม
  if (d.getTime() >= today.getTime()) return null;
  return d;
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
  // เก็บ branchId ในแต่ละแถว dist ด้วย — ให้ฝั่ง client เจาะดูรายสาขาโดย match ด้วย id
  // (ไม่ใช่ชื่อสาขา) กันเคสสาขาชื่อซ้ำแล้วนับยอดขาด (branch.name ไม่ unique)
  const distMap = new Map<string, { branchId: string; branch: string; qty: number }[]>();
  for (const r of perBranch) {
    const qty = r._sum.qty ?? 0;
    if (qty <= 0) continue;
    const arr = distMap.get(r.productId) ?? [];
    arr.push({ branchId: r.branchId, branch: branchName.get(r.branchId) ?? "สาขา", qty });
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
