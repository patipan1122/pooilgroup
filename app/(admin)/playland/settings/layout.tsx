// Settings layout · 2-pane shell · left = vertical tab list (client) · right = active form
// Solves UX review F4: "Settings hub is a card grid (Notion default), not a workspace"
// Active-state detection moved to client SettingsRail (was broken via headers() in server layout)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { SettingsRail } from "@/components/playland/settings-rail";
import { ArrowLeft, Settings } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const [branches, packageCount, productCount, deviceCount, promoCount] = await Promise.all([
    listBranches(orgId),
    prisma.playlandPackage.count({ where: { orgId, active: true } }),
    prisma.playlandProduct.count({ where: { orgId, active: true } }),
    prisma.playlandDevice.count({ where: { orgId, status: { not: "DISABLED" } } }),
    prisma.playlandPromo.count({ where: { orgId, active: true } }),
  ]);

  const sections = [
    { href: "/playland/settings/branches", iconName: "building" as const,  label: "สาขา",           count: branches.length, desc: "พื้นที่ทำธุรกิจ" },
    { href: "/playland/settings/packages", iconName: "package" as const,   label: "Packages",        count: packageCount,    desc: "ราคาเข้าเล่น" },
    { href: "/playland/settings/products", iconName: "shopping" as const,  label: "สินค้า POS",      count: productCount,    desc: "ขนม · เครื่องดื่ม" },
    { href: "/playland/settings/devices",  iconName: "scanface" as const,  label: "ACS Devices",     count: deviceCount,     desc: "face reader" },
    { href: "/playland/settings/promos",   iconName: "tag" as const,       label: "Promo / Coupon",  count: promoCount,      desc: "ส่วนลด" },
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
          <SettingsRail sections={sections} />
        </aside>
        <main className="pl-pane">{children}</main>
      </div>
    </div>
  );
}
