// DC · หน้านับสต๊อก (floor stock count · OFFLINE-capable)
//   server shell: gate floor role + dc context → ส่ง warehouse ให้ client workspace.
//   หน้าเดียวในโมดูลที่ต้องทำงานได้ตอนเน็ตหลุด (บัฟเฟอร์ใน localStorage → ซิงค์).

import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { CountWorkspace } from "./count-workspace";

export const dynamic = "force-dynamic";

export default async function DcCountPage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">นับสต๊อก</div>
          <div className="dc-sub">
            {ctx.activeWarehouse
              ? `คลัง: ${ctx.activeWarehouse.name} · ทำงานได้แม้เน็ตหลุด — เก็บในเครื่องแล้วซิงค์ทีหลัง`
              : "ยังไม่มีคลัง — ไปสร้างที่ หลังบ้าน › โกดัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/dc/count/history"
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
            ดูประวัติใบนับ
          </Link>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      {!ctx.activeWarehouse ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>ยังไม่มีคลังสินค้าให้นับ</p>
          {canManage && (
            <Link href="/dc/office/warehouses" className="dc-btn-xl" style={{ maxWidth: 280, margin: "0 auto" }}>
              + สร้างคลังแรก
            </Link>
          )}
        </div>
      ) : (
        <CountWorkspace
          warehouseId={ctx.activeWarehouse.id}
          warehouseName={ctx.activeWarehouse.name}
        />
      )}
    </div>
  );
}
