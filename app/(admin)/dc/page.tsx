// DC · หน้าคลัง (floor launcher) — ปุ่มใหญ่ 7 งาน สำหรับพนักงานบน iPad/มือถือ
import Link from "next/link";
import {
  PackagePlus, Truck, ArrowLeftRight, ClipboardCheck,
  PackageMinus, Search, QrCode, type LucideIcon,
} from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage } from "@/lib/dc/role-guard";
import { FLOOR_TASKS } from "@/lib/dc/nav";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";

export const dynamic = "force-dynamic";

const ICONS: Record<string, LucideIcon> = {
  PackagePlus, Truck, ArrowLeftRight, ClipboardCheck, PackageMinus, Search, QrCode,
};

export default async function DcFloorHome() {
  const ctx = await getDcContext();
  const canManage = canDcManage(ctx.session.user.role);

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">คลังกลาง (DC)</div>
          <div className="dc-sub">
            {ctx.activeWarehouse
              ? `คลัง: ${ctx.activeWarehouse.name}`
              : "ยังไม่มีคลัง — ไปสร้างที่ หลังบ้าน › โกดัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      {!ctx.activeWarehouse ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>ยังไม่มีคลังสินค้า</p>
          {canManage && (
            <Link href="/dc/office/warehouses" className="dc-btn-xl" style={{ maxWidth: 280, margin: "0 auto" }}>
              + สร้างคลังแรก
            </Link>
          )}
        </div>
      ) : (
        <div className="dc-floor-grid">
          {FLOOR_TASKS.map((t) => {
            const Icon = ICONS[t.icon] ?? PackagePlus;
            return (
              <Link key={t.key} href={t.href} className={`dc-tile dc-tile--${t.tone}`}>
                <span className="dc-tile__icon"><Icon size={26} strokeWidth={2.1} /></span>
                <span className="dc-tile__title">{t.label}</span>
                <span className="dc-tile__hint">{t.hint}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
