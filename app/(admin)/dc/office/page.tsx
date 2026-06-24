// DC · หลังบ้าน (back-office hub) — การ์ดงานจัดการ (desktop)
import Link from "next/link";
import {
  ShoppingCart, Building2, Ship, ClipboardCheck, Boxes,
  Warehouse, BarChart3, Users, type LucideIcon,
  Package, Layers, Coins, AlertTriangle, Truck, FileWarning,
} from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { canDcAdmin, canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOverview, fmtSatang, EST_VALUE_NOTE } from "@/lib/dc/reports";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { KpiTile } from "@/components/ui/kpi-tile";

export const dynamic = "force-dynamic";

type Card = { href: string; label: string; hint: string; icon: LucideIcon; admin?: boolean };

const CARDS: Card[] = [
  { href: "/dc/office/purchasing", label: "สั่งซื้อจีน", hint: "ใบสั่งซื้อ · รูป · ราคาหยวน · CBM", icon: ShoppingCart },
  { href: "/dc/office/suppliers", label: "ผู้ขาย", hint: "ทะเบียนซัพพลายเออร์จีน", icon: Building2 },
  { href: "/dc/office/shipments", label: "ขนส่ง / ชิปเมนต์", hint: "ค่าส่ง CBM · อากร · ต้นทุนนำเข้า", icon: Ship },
  { href: "/dc/office/receipts", label: "ใบรับสินค้า (GRN)", hint: "รับของเข้าคลัง · ดูย้อนหลัง", icon: ClipboardCheck },
  { href: "/dc/office/products", label: "สินค้า", hint: "ทะเบียนสินค้า · บาร์โค้ด · อะไหล่/ขาย", icon: Boxes },
  { href: "/dc/office/warehouses", label: "โกดัง", hint: "สร้าง/จัดการคลัง", icon: Warehouse },
  { href: "/dc/office/reports", label: "รายงาน", hint: "มูลค่าสต๊อก · ต้นทุน landed · เคลื่อนไหว", icon: BarChart3 },
  { href: "/dc/office/permissions", label: "สิทธิ์พนักงาน", hint: "ใครเห็นคลังไหน", icon: Users, admin: true },
];

export default async function DcOfficeHub() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const isAdmin = canDcAdmin(ctx.session.user.role);
  const cards = CARDS.filter((c) => !c.admin || isAdmin);

  // KPI แถวบนสุด — ภาพรวมสด (สเกลตามคลังที่ผู้ใช้เห็นได้)
  const allowed = ctx.warehouses.map((w) => w.id);
  const ov = await getDcOverview(ctx.session.user.org_id, allowed.length ? allowed : null);

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">หลังบ้าน · DC คลังกลาง</div>
          <div className="dc-sub">จัดการสั่งซื้อ ต้นทุน ทะเบียน สิทธิ์ และรายงาน</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      {/* แถว KPI ภาพรวมสต๊อก */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
      >
        <KpiTile
          icon={<Package size={16} />}
          accent="brand"
          label="สินค้า (SKU มีของ)"
          value={ov.totalSkus}
          unit="รายการ"
        />
        <KpiTile
          icon={<Layers size={16} />}
          accent="info"
          label="ชิ้นในคลัง"
          value={ov.totalUnits}
          unit="ชิ้น"
        />
        <KpiTile
          icon={<Coins size={16} />}
          accent="success"
          label="มูลค่าประมาณ"
          value={fmtSatang(ov.estValueSatang)}
          isMoney
          sub={EST_VALUE_NOTE}
        />
        <KpiTile
          icon={<AlertTriangle size={16} />}
          accent={ov.lowStockCount > 0 ? "warning" : "zinc"}
          label="ของใกล้หมด"
          value={ov.lowStockCount}
          unit="รายการ"
        />
        <KpiTile
          icon={<Truck size={16} />}
          accent="zinc"
          label="กำลังส่ง"
          value={ov.inTransitUnits}
          unit="ชิ้น"
        />
        <KpiTile
          icon={<FileWarning size={16} />}
          accent={ov.pendingTrcloud > 0 ? "warning" : "zinc"}
          label="รอลง TRCloud"
          value={ov.pendingTrcloud}
          unit="ใบ"
        />
      </div>

      <div className="dc-floor-grid">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="dc-tile dc-tile--slate">
            <span className="dc-tile__icon"><c.icon size={24} strokeWidth={2} /></span>
            <span className="dc-tile__title">{c.label}</span>
            <span className="dc-tile__hint">{c.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
