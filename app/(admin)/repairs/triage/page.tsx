// /repairs/triage — Inbox split-view (list + detail), filterable by status/urgency/branch/category
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import {
  countTicketsByStatus,
  countTicketsByUrgency,
  sumOpenCost,
  listTickets,
  getTicketDetail,
  listCategories,
  listBranches,
  listTechnicians,
  listCompanies,
  countNewSince,
} from "@/lib/repair/queries";
import { canRepairWrite, canRepairAdmin } from "@/lib/repair/role-guard";
import { AdminInbox } from "@/components/repair/admin-inbox";
import { RepairViewHeader } from "@/components/repair/view-header";
import { TICKET_STATUSES } from "@/lib/repair/types";
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

interface Search {
  status?: string;
  urgency?: string;
  branch?: string;
  category?: string;
  q?: string;
  selected?: string;
  company?: string;
}

export default async function RepairsTriagePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const orgId = session.user.org_id;
  const params = await searchParams;
  const companyId = params.company || null;

  const status = params.status && TICKET_STATUSES.includes(params.status as RepairTicketStatus)
    ? (params.status as RepairTicketStatus)
    : null;
  const urgency = params.urgency && ["URGENT", "NORMAL", "LOW"].includes(params.urgency)
    ? (params.urgency as RepairUrgency)
    : null;

  const [
    statusCounts,
    urgencyCounts,
    openCost,
    tickets,
    selectedTicket,
    categories,
    branches,
    technicians,
    companies,
    newToday,
  ] = await Promise.all([
    countTicketsByStatus(orgId, companyId),
    countTicketsByUrgency(orgId, true, companyId),
    sumOpenCost(orgId, companyId),
    listTickets({
      orgId,
      status,
      urgency,
      branchId: params.branch || null,
      companyId,
      categoryId: params.category || null,
      query: params.q || null,
    }),
    params.selected ? getTicketDetail(orgId, params.selected) : Promise.resolve(null),
    listCategories(orgId),
    listBranches(orgId),
    listTechnicians(orgId),
    listCompanies(orgId),
    countNewSince(orgId, 24, companyId),
  ]);

  const openCount =
    statusCounts.NEW + statusCounts.ACK + statusCounts.IN_PROGRESS + statusCounts.WAITING_PARTS;
  const total =
    openCount + statusCounts.RESOLVED + statusCounts.CLOSED + statusCounts.CANCELLED;

  return (
    <>
      <RepairViewHeader
        active="triage"
        companies={companies}
        currentCompanyId={companyId}
        openCount={openCount}
        urgentCount={urgencyCounts.URGENT}
        canWrite={canRepairWrite(session.user.role)}
        ticketTotal={total}
        newSinceYesterday={newToday}
      />
      <AdminInbox
        orgId={orgId}
        statusCounts={statusCounts}
        urgencyCounts={urgencyCounts}
        openCost={openCost}
        tickets={tickets}
        selectedTicket={selectedTicket}
        categories={categories}
        branches={branches}
        technicians={technicians}
        currentStatus={status}
        currentUrgency={urgency}
        currentBranch={params.branch ?? null}
        currentCategory={params.category ?? null}
        currentQuery={params.q ?? ""}
        canWrite={canRepairWrite(session.user.role)}
        canAdmin={canRepairAdmin(session.user.role)}
      />
    </>
  );
}
