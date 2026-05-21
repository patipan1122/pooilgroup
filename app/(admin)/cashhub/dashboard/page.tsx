import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { loadDashboard, bkkMonthLabel } from "@/lib/cashhub/aggregator";
import {
  loadExecutiveMatrix,
  type Period,
} from "@/lib/cashhub/executive-matrix";
import { resolveCompanyFilter } from "@/lib/auth/company-context";
import { DashboardV1View } from "./dashboard-v1-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; view?: string; year?: string }>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const sp = await searchParams;
  const companyId = await resolveCompanyFilter(sp.company);
  const period: Period =
    sp.view === "daily"
      ? "daily"
      : sp.view === "annual"
        ? "annual"
        : "monthly";

  const parsedYear = sp.year ? parseInt(sp.year, 10) : undefined;
  const validYear =
    parsedYear && parsedYear >= 2020 && parsedYear <= 2100 ? parsedYear : undefined;

  // Load all dashboard data + executive matrix in parallel
  // monthly = 12 trailing months · daily = 30 days · annual = full Jan-Dec of `year`
  // companyId sync ลงตารางด้วย (เลือก Pooil Oil → ตารางโชว์เฉพาะ Pooil Oil)
  const [data, executiveMatrix] = await Promise.all([
    loadDashboard(session.user.org_id, companyId),
    loadExecutiveMatrix(session.user.org_id, {
      period,
      count: period === "monthly" ? 12 : 30,
      year: validYear,
      companyId,
    }),
  ]);

  const isAdmin =
    session.user.role === "super_admin" || session.user.role === "org_admin";

  return (
    <DashboardV1View
      userName={session.user.name}
      isAdmin={isAdmin}
      monthLabel={bkkMonthLabel()}
      data={data}
      executiveMatrix={executiveMatrix}
    />
  );
}
