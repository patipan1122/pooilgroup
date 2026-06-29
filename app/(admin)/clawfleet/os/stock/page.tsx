/**
 * ตู้คีบ OS — คลังสินค้า (Stock / Warehouse)
 * Server: โหลดสาขาจริง + (สาขาแรก) ภาพรวมสต็อก/ใบรับสินค้าจริง. ถ้า DB ว่าง → client ใช้ sample
 * fallback (ตาม pattern ClawFleet เดิม) เพื่อไม่ให้หน้าโล่ง.
 *
 * Backend นี้กว้างกว่าที่ design ต้องการ (ภาพรวมสต็อก "ทุก" สาขา + คลังกลาง + ใบโอน/shipment
 * แยกใบ) — query ปัจจุบันคืนแค่ระดับ "สาขาเดียว" → จึง sample ส่วนคลังกลาง/การกระจายไว้ในฝั่ง client.
 */
import { getV2Branches, getV2BranchStock } from "@/lib/clawfleet/v2-queries";
import { requireCfSession } from "@/lib/clawfleet/role-guard";
import { getCfStockOverview, getCfReceipts } from "@/lib/clawfleet/stock-queries";
import { StockClient, type BranchStockSeed, type ReceiptSeed } from "./stock-client";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  let branchSeeds: BranchStockSeed[] = [];

  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branches = await getV2Branches();

    if (branches.length > 0) {
      // โหลดแบบจริงเฉพาะสาขาแรก (ที่เหลือใส่ตัวเลข derive จาก machine count เพื่อไม่ยิง query หนัก)
      const first = branches[0];
      let overview: Awaited<ReturnType<typeof getCfStockOverview>> | null = null;
      let branchStock: Awaited<ReturnType<typeof getV2BranchStock>> | null = null;
      let receipts: Awaited<ReturnType<typeof getCfReceipts>> = [];
      try {
        [overview, branchStock, receipts] = await Promise.all([
          getCfStockOverview(orgId, first.id),
          getV2BranchStock(first.id),
          getCfReceipts(orgId, first.id),
        ]);
      } catch {
        // graceful: ตารางสต็อกยังว่าง → ปล่อยให้ client เติม sample
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

  return <StockClient branches={branchSeeds} />;
}
