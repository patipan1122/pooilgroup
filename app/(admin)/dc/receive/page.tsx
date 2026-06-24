// DC · หน้า "รับเข้า" (floor receive) — สแกน/พิมพ์รหัส → นับ → ยืนยันรับเข้า → ปริ้นฉลาก
import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { ReceiveWorkspace } from "./receive-workspace";

export const dynamic = "force-dynamic";

export default async function DcReceivePage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">รับเข้า</div>
          <div className="dc-sub">
            {ctx.activeWarehouse
              ? `คลัง: ${ctx.activeWarehouse.name}`
              : "ยังไม่มีคลัง"}
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
            <Link
              href="/dc/office/warehouses"
              className="dc-btn-xl"
              style={{ maxWidth: 280, margin: "0 auto" }}
            >
              + สร้างคลังแรก
            </Link>
          )}
        </div>
      ) : (
        <ReceiveWorkspace
          warehouseId={ctx.activeWarehouseId}
          activeWarehouseName={ctx.activeWarehouse.name}
        />
      )}
    </div>
  );
}
