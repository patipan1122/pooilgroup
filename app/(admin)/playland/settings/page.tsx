import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { Building2, Package, ShoppingBasket, ScanFace, Tag, Settings } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsHubPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const [branches, packageCount, productCount, deviceCount, promoCount] = await Promise.all([
    listBranches(orgId),
    prisma.playlandPackage.count({ where: { orgId, active: true } }),
    prisma.playlandProduct.count({ where: { orgId, active: true } }),
    prisma.playlandDevice.count({ where: { orgId, status: { not: "DISABLED" } } }),
    prisma.playlandPromo.count({ where: { orgId, active: true } }),
  ]);

  const cards = [
    { href: "/playland/settings/branches", icon: Building2, label: "สาขา", count: branches.length, desc: "เพิ่ม/แก้สาขา · เวลาเปิด · ตั้งค่าต่อสาขา" },
    { href: "/playland/settings/packages", icon: Package, label: "Packages (แพคเกจ)", count: packageCount, desc: "Fixed · Pay-per-minute · Day pass" },
    { href: "/playland/settings/products", icon: ShoppingBasket, label: "สินค้า POS", count: productCount, desc: "ขนม · เครื่องดื่ม · ของเล่น · สต๊อก" },
    { href: "/playland/settings/devices", icon: ScanFace, label: "ACS Devices", count: deviceCount, desc: "ACS-F606 · pairing · webhook" },
    { href: "/playland/settings/promos", icon: Tag, label: "Promo / Coupon", count: promoCount, desc: "Coupon · Loyalty · Birthday · Weekday" },
  ];

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Playland · Settings</div>
          <h1><Settings size={20} style={{ display: "inline", marginRight: 6, verticalAlign: -3 }} /> ตั้งค่า Playland</h1>
        </div>
      </header>

      <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.href} href={c.href} className="pl-card" style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Icon size={20} color="var(--pl-brand-dark)" />
                <div style={{ fontWeight: 600, fontSize: 15 }}>{c.label}</div>
                <span className="pl-chip pl-chip-brand" style={{ marginLeft: "auto" }}>{c.count}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{c.desc}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
