import { requireSession } from "@/lib/auth/session";
import { loadDashboard, bkkMonthLabel } from "@/lib/cashhub/aggregator";
import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const data = await loadDashboard(session.user.org_id);
  const isAdmin =
    session.user.role === "super_admin" || session.user.role === "org_admin";

  return (
    <DashboardView
      userName={session.user.name}
      isAdmin={isAdmin}
      monthLabel={bkkMonthLabel()}
      data={data}
    />
  );
}
