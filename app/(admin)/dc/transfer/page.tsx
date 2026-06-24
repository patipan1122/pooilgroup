// DC · หน้า "ส่ง / โอน" (floor) — ส่งของจากคลังต้นทางไปคลังอื่น/สาขา/โมดูล
//   • เลือกปลายทาง: คลัง DC อื่น (รับเข้า 2 จังหวะ) หรือ พิมพ์ป้ายสาขา/โมดูลเอง
//   • สแกน/พิมพ์รหัส → เพิ่มรายการ → นับจำนวน → "ส่งออก (N ชิ้น)"
import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { TransferDispatch, type DestWarehouseOption } from "./transfer-dispatch";

export const dynamic = "force-dynamic";

export default async function DcTransferPage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  // คลังปลายทางที่เลือกได้ = คลังที่ allowed ทั้งหมด ยกเว้นคลังต้นทาง (กรองใน client)
  const destWarehouses: DestWarehouseOption[] = ctx.warehouses.map((w) => ({
    id: w.id,
    name: w.name,
  }));

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ส่ง / โอน</div>
          <div className="dc-sub">
            {ctx.activeWarehouse ? `จากคลัง: ${ctx.activeWarehouse.name}` : "ยังไม่มีคลัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      {!ctx.activeWarehouseId || !ctx.activeWarehouse ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>ยังไม่มีคลัง — สร้างที่หลังบ้าน</p>
          {canManage && (
            <Link href="/dc/office/warehouses" className="dc-btn-xl" style={{ maxWidth: 280, margin: "0 auto" }}>
              + สร้างคลังแรก
            </Link>
          )}
        </div>
      ) : (
        <TransferDispatch
          fromWarehouseId={ctx.activeWarehouseId}
          fromWarehouseName={ctx.activeWarehouse.name}
          warehouses={destWarehouses}
        />
      )}
    </div>
  );
}
