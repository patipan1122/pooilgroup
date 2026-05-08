// /dashboard — Cross-Module Executive Dashboard (Pool Group Command Center)
// ────────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/CORE_SYSTEM.md §4 + ดีเทลv1/CASHHUB.md §10
// Memory rules:
//   - role-scoped: super_admin / org_admin / admin / area_manager เท่านั้น
//     branch_manager / staff / driver / viewer → redirect ไป view ของตัวเอง
//   - Single source of truth: data ผ่าน lib/cashhub/data.ts + aggregator
//   - ห้าม mock data — ถ้าไม่มี data → empty state สวย ๆ
//   - ห้าม module-specific data ของ FuelOS/DocuFlow ที่ยังไม่มีจริง
//
// HOW IT DIFFERS FROM /cashhub/dashboard:
//   /cashhub/dashboard = single-module deep dive (one focus = ยอดสาขา)
//   /dashboard         = cross-module COMMAND CENTER — quick scan ทุก module
//                        ในหน้าเดียว · ผู้บริหารเปิดมือถือเช้า ๆ ดู 30 วินาที
//                        จบ
// ────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { resolveCompanyFilter } from "@/lib/auth/company-context";
import { loadDashboard, bkkMonthLabel } from "@/lib/cashhub/aggregator";
import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

export default async function ExecutiveDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; range?: string; type?: string }>;
}) {
  const session = await requireSession();
  const role = session.user.role;

  // ============================================================
  // ROLE-SCOPED ROUTING (memory rule: feedback_role_scoped_views.md)
  // ผู้จัดการสาขา / staff / driver / viewer ห้ามเห็น exec overview
  // ============================================================
  if (role === "driver") redirect("/driver");
  if (role === "staff") redirect("/cashhub/quick-fill");
  if (role === "branch_manager") redirect("/cashhub/my-branches");
  if (role === "viewer") redirect("/cashhub/heatmap");

  // remaining = super_admin | org_admin | admin | area_manager → allowed

  const sp = await searchParams;
  const companyId = await resolveCompanyFilter(sp.company);

  // โหลดทุกอย่างผ่าน canonical loader (Single Source of Truth)
  const data = await loadDashboard(session.user.org_id, companyId);

  const isAdmin =
    role === "super_admin" || role === "org_admin" || role === "admin";

  return (
    <DashboardView
      userName={session.user.name}
      userRole={role}
      isAdmin={isAdmin}
      monthLabel={bkkMonthLabel()}
      data={data}
      // refreshAt is read once on the server — UI shows relative time
      refreshAt={new Date().toISOString()}
      initialRange={(sp.range as "today" | "week" | "month") ?? "month"}
      initialType={sp.type ?? "all"}
    />
  );
}
