// DC · หน้า "ค้นหา" (floor search) — สแกน/ค้นหาสินค้า → ของชิ้นนี้อยู่คลังไหน ชั้นไหน เหลือเท่าไหร่
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { SearchWorkspace } from "./search-workspace";

export const dynamic = "force-dynamic";

export default async function DcSearchPage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ค้นหา</div>
          <div className="dc-sub">ของชิ้นนี้อยู่คลังไหน ชั้นไหน เหลือเท่าไหร่</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      <SearchWorkspace />
    </div>
  );
}
