// Settings layout · 2-pane shell · left = vertical tab list · right = active form
// Solves UX review F4: "Settings hub is a card grid (Notion default), not a workspace"

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { headers } from "next/headers";
import { Building2, Package, ShoppingBasket, ScanFace, Tag, ArrowLeft, Settings } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const h = await headers();
  const pathname = h.get("x-pathname") ?? h.get("referer")?.replace(/^https?:\/\/[^/]+/, "") ?? "/playland/settings";

  const [branches, packageCount, productCount, deviceCount, promoCount] = await Promise.all([
    listBranches(orgId),
    prisma.playlandPackage.count({ where: { orgId, active: true } }),
    prisma.playlandProduct.count({ where: { orgId, active: true } }),
    prisma.playlandDevice.count({ where: { orgId, status: { not: "DISABLED" } } }),
    prisma.playlandPromo.count({ where: { orgId, active: true } }),
  ]);

  const sections = [
    { href: "/playland/settings/branches", icon: Building2, label: "สาขา", count: branches.length, desc: "พื้นที่ทำธุรกิจ" },
    { href: "/playland/settings/packages", icon: Package, label: "Packages", count: packageCount, desc: "ราคาเข้าเล่น" },
    { href: "/playland/settings/products", icon: ShoppingBasket, label: "สินค้า POS", count: productCount, desc: "ขนม · เครื่องดื่ม" },
    { href: "/playland/settings/devices", icon: ScanFace, label: "ACS Devices", count: deviceCount, desc: "face reader" },
    { href: "/playland/settings/promos", icon: Tag, label: "Promo / Coupon", count: promoCount, desc: "ส่วนลด" },
  ];

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1><Settings size={20} style={{ display: "inline", marginRight: 8, verticalAlign: -3 }} />ตั้งค่า Playland</h1>
        </div>
      </header>

      <div className="pl-two-pane">
        <aside className="pl-pane">
          <nav style={{ padding: "12px 0" }}>
            {sections.map((s) => {
              const Icon = s.icon;
              const active = pathname.startsWith(s.href);
              return (
                <Link key={s.href} href={s.href} className={`pl-rail-link ${active ? "is-active" : ""}`}>
                  <Icon size={16} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{s.label}</div>
                    <div style={{ fontSize: 11, color: "var(--pl-text-muted)", fontWeight: 400 }}>{s.desc}</div>
                  </div>
                  <span className="pl-rail-count">{s.count}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="pl-pane">
          {children}
        </main>
      </div>
    </div>
  );
}
