// DC · หน้าคลัง · "ใบที่ฉันส่ง / รอรับเข้า" (transfer list — floor)
//   • สองแท็บ: "ที่ฉันส่งออก" (fromWarehouse=คลังนี้) + "รอรับเข้า" (toWarehouse=คลังนี้ · IN_TRANSIT)
//   • พนักงานหน้างานกดรับของเข้าได้ (ล็อกตามคลังที่ผูกสิทธิ์)
//   server shell: gate floor role + dc context → โหลด list รอบแรกฝั่ง server ส่งให้ client.

import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import {
  listMyOutgoingTransfers,
  listIncomingTransfers,
  type TransferListRow,
} from "@/lib/dc/transfer-list-actions";
import { TransfersFloorView } from "./transfers-floor-view";

export const dynamic = "force-dynamic";

export default async function DcTransfersFloorPage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  let outgoing: TransferListRow[] = [];
  let incoming: TransferListRow[] = [];
  if (ctx.activeWarehouseId) {
    const [outRes, inRes] = await Promise.all([
      listMyOutgoingTransfers({ warehouseId: ctx.activeWarehouseId, limit: 100 }),
      listIncomingTransfers({ warehouseId: ctx.activeWarehouseId, limit: 100 }),
    ]);
    outgoing = outRes.ok ? outRes.rows : [];
    incoming = inRes.ok ? inRes.rows : [];
  }

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ใบที่ฉันส่ง / รอรับเข้า</div>
          <div className="dc-sub">
            {ctx.activeWarehouse
              ? `คลัง: ${ctx.activeWarehouse.name} · ดูของที่ส่งออก + ของที่รอรับเข้าคลังนี้`
              : "ยังไม่มีคลัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/dc"
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
            ← กลับหน้าคลัง
          </Link>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      <TransfersFloorView outgoing={outgoing} incoming={incoming} />
    </div>
  );
}
