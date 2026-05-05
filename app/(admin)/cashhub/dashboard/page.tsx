import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { loadDashboard, bkkMonthLabel } from "@/lib/cashhub/aggregator";
import {
  loadExecutiveMatrix,
  type Period,
} from "@/lib/cashhub/executive-matrix";
import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; view?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const companyId = sp.company || undefined;
  const period: Period = sp.view === "daily" ? "daily" : "monthly";

  // Load all dashboard data + executive matrix in parallel
  // monthly = 12 เดือน (full year) · daily = 30 วัน
  const [data, executiveMatrix] = await Promise.all([
    loadDashboard(session.user.org_id, companyId),
    loadExecutiveMatrix(session.user.org_id, {
      period,
      count: period === "monthly" ? 12 : 30,
    }),
  ]);

  const isAdmin =
    session.user.role === "super_admin" || session.user.role === "org_admin";

  // Pull companies for the filter UI
  let companies: Array<{ id: string; code: string; name: string }> = [];
  try {
    const admin = adminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (admin.from as any)("companies")
      .select("id, code, name")
      .eq("org_id", session.user.org_id)
      .eq("is_active", true)
      .order("code");
    if (res.data) companies = res.data;
  } catch {
    /* table missing — silent */
  }

  return (
    <DashboardView
      userName={session.user.name}
      isAdmin={isAdmin}
      monthLabel={bkkMonthLabel()}
      data={data}
      executiveMatrix={executiveMatrix}
      companies={companies}
      currentCompanyId={companyId}
    />
  );
}
