// /repairs/table — dense filterable table view
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess, canRepairWrite } from "@/lib/repair/role-guard";
import {
  countTicketsByStatus,
  countTicketsByUrgency,
  listTickets,
  listCompanies,
  countNewSince,
} from "@/lib/repair/queries";
import { TICKET_STATUSES } from "@/lib/repair/types";
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";
import { RepairViewHeader } from "@/components/repair/view-header";
import { AdminTable } from "@/components/repair/admin-table";

export const dynamic = "force-dynamic";

interface Search {
  status?: string;
  urgency?: string;
  branch?: string;
  category?: string;
  q?: string;
  company?: string;
}

export default async function RepairsTablePage({
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

  const [statusCounts, urgencyCounts, rows, companies, newToday] = await Promise.all([
    countTicketsByStatus(orgId, companyId),
    countTicketsByUrgency(orgId, true, companyId),
    listTickets(
      {
        orgId,
        status,
        urgency,
        branchId: params.branch || null,
        companyId,
        categoryId: params.category || null,
        query: params.q || null,
      },
      200,
    ),
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
        active="table"
        companies={companies}
        currentCompanyId={companyId}
        openCount={openCount}
        urgentCount={urgencyCounts.URGENT}
        canWrite={canRepairWrite(session.user.role)}
        ticketTotal={total}
        newSinceYesterday={newToday}
      />
      <AdminTable
        rows={rows}
        total={total}
        currentStatus={status}
        currentUrgency={urgency}
        currentQuery={params.q ?? ""}
        statusCounts={statusCounts}
      />
    </>
  );
}
