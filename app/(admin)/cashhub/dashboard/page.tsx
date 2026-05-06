import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { loadDashboard, bkkMonthLabel } from "@/lib/cashhub/aggregator";
import {
  loadExecutiveMatrix,
  type Period,
} from "@/lib/cashhub/executive-matrix";
import { resolveCompanyFilter } from "@/lib/auth/company-context";
import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; view?: string }>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const sp = await searchParams;
  const companyId = await resolveCompanyFilter(sp.company);
  const period: Period = sp.view === "daily" ? "daily" : "monthly";

  // Load all dashboard data + executive matrix in parallel
  // monthly = 12 เดือน (full year) · daily = 30 วัน
  // companyId sync ลงตารางด้วย (เลือก Pooil Oil → ตารางโชว์เฉพาะ Pooil Oil)
  const [data, executiveMatrix] = await Promise.all([
    loadDashboard(session.user.org_id, companyId),
    loadExecutiveMatrix(session.user.org_id, {
      period,
      count: period === "monthly" ? 12 : 30,
      companyId,
    }),
  ]);

  const isAdmin =
    session.user.role === "super_admin" || session.user.role === "org_admin";

  return (
    <DashboardView
      userName={session.user.name}
      isAdmin={isAdmin}
      monthLabel={bkkMonthLabel()}
      data={data}
      executiveMatrix={executiveMatrix}
    />
  );
}
