// /repairs — Command Center Overview (KPIs · action queue · workload · pipeline · hotspots · activity)
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess, canRepairWrite } from "@/lib/repair/role-guard";
import {
  countTicketsByStatus,
  countTicketsByUrgency,
  sumOpenCost,
  countNewSince,
  hotspotBranches,
  technicianWorkload,
  categoryBreakdown,
  recentActivity,
  actionQueueBuckets,
  costTrend8w,
  volumeByDay,
  listCompanies,
} from "@/lib/repair/queries";
import { OverviewDashboard } from "@/components/repair/overview-dashboard";
import { RepairViewHeader } from "@/components/repair/view-header";

export const dynamic = "force-dynamic";

interface Search {
  company?: string;
}

export default async function RepairsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const orgId = session.user.org_id;
  const params = await searchParams;
  const companyId = params.company || null;

  const [
    statusCounts,
    urgencyCounts,
    openCost,
    newToday,
    hotspots,
    workload,
    categories,
    activity,
    buckets,
    costTrend,
    volume,
    companies,
  ] = await Promise.all([
    countTicketsByStatus(orgId, companyId),
    countTicketsByUrgency(orgId, true, companyId),
    sumOpenCost(orgId, companyId),
    countNewSince(orgId, 24, companyId),
    hotspotBranches(orgId, 6, companyId),
    technicianWorkload(orgId, companyId),
    categoryBreakdown(orgId, companyId),
    recentActivity(orgId, 8, companyId),
    actionQueueBuckets(orgId, 12, companyId),
    costTrend8w(orgId, companyId),
    volumeByDay(orgId, companyId),
    listCompanies(orgId),
  ]);

  const openCount =
    statusCounts.NEW + statusCounts.ACK + statusCounts.IN_PROGRESS + statusCounts.WAITING_PARTS;
  const total =
    openCount + statusCounts.RESOLVED + statusCounts.CLOSED + statusCounts.CANCELLED;

  return (
    <>
      <RepairViewHeader
        active="overview"
        companies={companies}
        currentCompanyId={companyId}
        openCount={openCount}
        urgentCount={urgencyCounts.URGENT}
        canWrite={canRepairWrite(session.user.role)}
        ticketTotal={total}
        newSinceYesterday={newToday}
      />
      <OverviewDashboard
        statusCounts={statusCounts}
        urgencyCounts={urgencyCounts}
        openCost={openCost}
        newSinceYesterday={newToday}
        hotspots={hotspots}
        workload={workload.map((w) => ({
          tech: {
            id: w.tech.id,
            name: w.tech.name,
            kind: w.tech.kind,
            specialties: w.tech.specialties ?? [],
          },
          active: w.active,
          urgent: w.urgent,
        }))}
        categories={categories}
        activity={activity}
        buckets={buckets}
        costTrend={costTrend}
        volume={volume}
      />
    </>
  );
}
