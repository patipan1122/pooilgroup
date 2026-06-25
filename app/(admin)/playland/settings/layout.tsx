// Settings layout · 2-pane shell · left = vertical tab list (client) · right = active form
// Solves UX review F4: "Settings hub is a card grid (Notion default), not a workspace"
// Active-state detection moved to client SettingsRail (was broken via headers() in server layout)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { requirePlaylandAdmin } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { SettingsRail } from "@/components/playland/settings-rail";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { MobileRailToggle } from "@/components/playland/mobile-rail-toggle";
import { ArrowLeft, Settings } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // หน้าตั้งค่า = ผู้ดูแล/เจ้าของเท่านั้น (CEO permission matrix: ตั้งค่า = admin/owner tier · กันผู้จัดการ/พนักงานแก้แพ็กเกจ/โปรโม)
  requirePlaylandAdmin(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId);
  // นับเฉพาะ "สาขาที่กำลังทำงาน" → ตัวเลขในเมนูตรงกับสิ่งที่เห็น (ไม่ปนสาขาอื่น)
  const branchScope = activeId ? { branchId: activeId } : {};
  const [packageCount, productCount, deviceCount] = await Promise.all([
    prisma.playlandPackage.count({ where: { orgId, active: true, ...(activeId ? { OR: [{ branchId: activeId }, { branchId: null }] } : {}) } }),
    prisma.playlandProduct.count({ where: { orgId, active: true, ...branchScope } }),
    prisma.playlandDevice.count({ where: { orgId, status: { not: "DISABLED" }, ...branchScope } }),
  ]);

  const sections = [
    { href: "/playland/settings/branches",    iconName: "building" as const,  label: "สาขา",           count: branches.length, desc: "พื้นที่ทำธุรกิจ" },
    { href: "/playland/settings/packages",    iconName: "package" as const,   label: "Packages",        count: packageCount,    desc: "ราคาเข้าเล่น" },
    { href: "/playland/settings/products",    iconName: "shopping" as const,  label: "สินค้า POS",      count: productCount,    desc: "ขนม · เครื่องดื่ม" },
    { href: "/playland/settings/stock-count", iconName: "boxes" as const,     label: "นับสต๊อก",        count: productCount,    desc: "จำนวนคงเหลือ" },
    // ACS Devices ถือกุญแจลับ webhook → โชว์เมนูเฉพาะ super_admin
    ...(isSuperAdmin(session.user.role)
      ? [{ href: "/playland/settings/devices", iconName: "scanface" as const, label: "ACS Devices", count: deviceCount, desc: "face reader" }]
      : []),
  ];

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1><Settings size={20} style={{ display: "inline", marginRight: 8, verticalAlign: -3 }} />ตั้งค่า Playland</h1>
        </div>
        <BranchSwitcher branches={branches} activeId={activeId} />
      </header>

      <div className="pl-two-pane">
        <aside className="pl-pane">
          <SettingsRail sections={sections} />
        </aside>
        <main className="pl-pane">{children}</main>
        <MobileRailToggle label="ตั้งค่า" />
      </div>
    </div>
  );
}
