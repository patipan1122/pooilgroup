// DC · ดูสินค้า / สต๊อก (floor browse) — server page
//   ไล่ดูสินค้าทั้งหมดพร้อมรูป + คงเหลือ (READ-ONLY) สำหรับพนักงานหน้างานบนมือถือ.
//   server shell: gate floor role + dc context → ส่ง warehouse + รายการแรกให้ client.
import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import {
  listDcFloorProducts,
  listCategoriesForCount,
  type FloorProductRow,
} from "@/lib/dc/floor-products-actions";
import { FloorProductsBrowse } from "./products-browse";

export const dynamic = "force-dynamic";

export default async function DcProductsPage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  // โหลดรอบแรกฝั่ง server (เร็ว + ไม่ต้องรอ fetch หลัง mount) เมื่อมีคลัง
  let initialProducts: FloorProductRow[] = [];
  let categories: string[] = [];
  if (ctx.activeWarehouse && ctx.activeWarehouseId) {
    const [listRes, cats] = await Promise.all([
      listDcFloorProducts({ warehouseId: ctx.activeWarehouseId }),
      listCategoriesForCount(),
    ]);
    initialProducts = listRes.ok ? listRes.products : [];
    categories = cats;
  }

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ดูสินค้า / สต๊อก</div>
          <div className="dc-sub">
            {ctx.activeWarehouse
              ? `คลัง: ${ctx.activeWarehouse.name} · ไล่ดูสินค้าทั้งหมด + รูป + คงเหลือ`
              : "ยังไม่มีคลัง — ไปสร้างที่ หลังบ้าน › โกดัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      {!ctx.activeWarehouse || !ctx.activeWarehouseId ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>ยังไม่มีคลังสินค้า</p>
          {canManage && (
            <Link href="/dc/office/warehouses" className="dc-btn-xl" style={{ maxWidth: 280, margin: "0 auto" }}>
              + สร้างคลังแรก
            </Link>
          )}
        </div>
      ) : (
        <FloorProductsBrowse
          warehouseId={ctx.activeWarehouseId}
          warehouseName={ctx.activeWarehouse.name}
          categories={categories}
          initialProducts={initialProducts}
          r2PublicUrl={process.env.R2_PUBLIC_URL ?? ""}
        />
      )}
    </div>
  );
}
