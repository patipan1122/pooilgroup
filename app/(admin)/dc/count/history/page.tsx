// DC · ประวัติใบนับ (stock count history) — server page
//   ไล่ดูใบนับที่เคยบันทึก (เลขที่ · วันที่ · ใครนับ · จำนวนรายการ · ส่วนต่างรวม) → กดดูรายละเอียด.
//   server shell: gate floor role + dc context → โหลด list รอบแรกฝั่ง server ส่งให้ client.

import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { listCountSheets, type CountSheetSummary } from "@/lib/dc/count-actions";
import { CountHistoryView } from "./history-view";

export const dynamic = "force-dynamic";

export default async function DcCountHistoryPage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  let sheets: CountSheetSummary[] = [];
  if (ctx.activeWarehouseId) {
    const res = await listCountSheets({ warehouseId: ctx.activeWarehouseId, limit: 100 });
    sheets = res.ok ? res.sheets : [];
  }

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ประวัติใบนับ</div>
          <div className="dc-sub">
            {ctx.activeWarehouse
              ? `คลัง: ${ctx.activeWarehouse.name} · ดูว่าใครนับอะไร เมื่อไร ส่วนต่างเท่าไร`
              : "ยังไม่มีคลัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/dc/count"
            className="dc-btn-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 14px",
              borderRadius: 10,
              border: "1.5px solid var(--dc-line)",
              background: "var(--dc-paper)",
              color: "var(--dc-ink)",
              fontWeight: 700,
              fontSize: 14,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            ← กลับไปนับ
          </Link>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      <CountHistoryView initialSheets={sheets} />
    </div>
  );
}
