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
          <div className="dc-h1">รับของไม่มีใบสั่งซื้อ</div>
          <div className="dc-sub">
            ของแถม · ตัวอย่าง · ของจิปาถะ
            {ctx.activeWarehouse ? ` · คลัง: ${ctx.activeWarehouse.name}` : " · ยังไม่มีคลัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      {/* ทางหลัก: รับตามใบสั่งซื้อ (PO) — ดันให้เป็น default path */}
      <Link
        href="/dc/receive-po"
        className="dc-card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 16,
          marginBottom: 14,
          textDecoration: "none",
          background: "var(--dc-primary, #1F4FD6)",
          color: "#fff",
          borderRadius: 14,
        }}
      >
        <span style={{ fontSize: 26, flexShrink: 0, lineHeight: 1 }}>📦</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>
            รับของที่สั่งจากจีน/ไทย → กดรับตามใบสั่งซื้อ (PO)
          </div>
          <div style={{ fontSize: 13, opacity: 0.92, marginTop: 2 }}>
            ทางที่แนะนำ — ระบบจะเทียบกับจำนวนที่สั่งให้อัตโนมัติ
          </div>
        </div>
        <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>›</span>
      </Link>

      {/* ทางลัด: ของที่สาขาส่งคืนคลังกลาง — รอ DC กดรับเข้าสต๊อก (ปิดช่องว่างเดิมที่ "รับของที่โอนมา" ไม่มีบ้าน) */}
      <Link
        href="/dc/office/transfers#branch-returns"
        className="dc-card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 14,
          marginBottom: 14,
          textDecoration: "none",
          background: "#fff",
          border: "1px solid var(--dc-line, #e7ebf2)",
          borderRadius: 14,
          color: "inherit",
        }}
      >
        <span style={{ fontSize: 24, flexShrink: 0, lineHeight: 1 }}>↩️</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.3 }}>รับคืนจากสาขา</div>
          <div style={{ fontSize: 13, color: "var(--ink2, #6b7280)", marginTop: 2 }}>
            ของที่สาขาส่งคืนคลังกลาง — กดยืนยันรับเข้าสต๊อก
          </div>
        </div>
        <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1, color: "#9ca3af" }}>›</span>
      </Link>

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
