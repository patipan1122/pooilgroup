// DC Redesign v2 · หลังบ้าน (ภาพรวม/hub) — KPI + การ์ดงาน · shell ครีม/ฟ้า (เข้าชุด DC).
import Link from "next/link";
import {
  ShoppingCart, Building2, Ship, ClipboardCheck, Boxes,
  Warehouse, BarChart3, Users, type LucideIcon,
  Package, Layers, Coins, AlertTriangle, Truck, FileWarning, GitCompare,
} from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { canDcAdmin, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOverview, fmtSatang, EST_VALUE_NOTE } from "@/lib/dc/reports";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { KpiTile } from "@/components/ui/kpi-tile";

export const dynamic = "force-dynamic";

type Card = { href: string; label: string; hint: string; icon: LucideIcon; admin?: boolean };

const CARDS: Card[] = [
  // #16 ผู้ขาย + ขนส่ง ยุบเข้าใต้ "สั่งซื้อจีน" (แท็บ PurchasingSubnav) — ไม่แยกการ์ด/เมนู
  { href: "/dc/office/purchasing", label: "สั่งซื้อจีน", hint: "ใบสั่งซื้อ · ผู้ขาย · ขนส่ง/ชิปเมนต์ · CBM", icon: ShoppingCart },
  { href: "/dc/office/receipts", label: "ใบรับสินค้า (GRN)", hint: "รับของเข้าคลัง · ดูย้อนหลัง", icon: ClipboardCheck },
  { href: "/dc/office/transfers", label: "การโอน", hint: "ยืนยันรับโอน · ของระหว่างทาง", icon: Truck },
  { href: "/dc/office/products", label: "สินค้า", hint: "ทะเบียนสินค้า · บาร์โค้ด · อะไหล่/ขาย", icon: Boxes },
  { href: "/dc/office/warehouses", label: "โกดัง", hint: "สร้าง/จัดการคลัง", icon: Warehouse },
  { href: "/dc/office/reconcile", label: "กระทบยอด", hint: "เทียบ DC↔บัญชี · งานนับ", icon: GitCompare },
  { href: "/dc/office/reports", label: "รายงาน", hint: "มูลค่าสต๊อก · ต้นทุน landed · เคลื่อนไหว", icon: BarChart3 },
  { href: "/dc/office/permissions", label: "สิทธิ์พนักงาน", hint: "ใครเห็นคลังไหน", icon: Users, admin: true },
];

export default async function DcOfficeHub() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const isAdmin = canDcAdmin(ctx.session.user.role);
  const cards = CARDS.filter((c) => !c.admin || isAdmin);
  const orgId = ctx.session.user.org_id;

  const allowed = ctx.warehouses.map((w) => w.id);
  const [chrome, ov] = await Promise.all([
    getDcOfficeChrome(orgId),
    getDcOverview(orgId, allowed.length ? allowed : null),
  ]);

  return (
    <DcOfficeShell active="dash" {...dcShellChrome(ctx, chrome)}>
      <div>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>ภาพรวม · DC คลังกลาง</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>จัดการสั่งซื้อ ต้นทุน ทะเบียน สิทธิ์ และรายงาน — ในที่เดียว</p>
        </div>

        {/* แถว KPI ภาพรวมสต๊อก */}
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <KpiTile icon={<Package size={16} />} accent="brand" label="สินค้า (SKU มีของ)" value={ov.totalSkus} unit="รายการ" />
          <KpiTile icon={<Layers size={16} />} accent="info" label="ชิ้นในคลัง" value={ov.totalUnits} unit="ชิ้น" />
          <KpiTile icon={<Coins size={16} />} accent="success" label="มูลค่าประมาณ" value={fmtSatang(ov.estValueSatang)} isMoney sub={EST_VALUE_NOTE} />
          <KpiTile icon={<AlertTriangle size={16} />} accent={ov.lowStockCount > 0 ? "warning" : "zinc"} label="ของใกล้หมด" value={ov.lowStockCount} unit="รายการ" />
          <KpiTile icon={<Truck size={16} />} accent="zinc" label="กำลังส่ง" value={ov.inTransitUnits} unit="ชิ้น" />
          <KpiTile icon={<FileWarning size={16} />} accent={ov.pendingTrcloud > 0 ? "warning" : "zinc"} label="รอลง TRCloud" value={ov.pendingTrcloud} unit="ใบ" />
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
    </DcOfficeShell>
  );
}
