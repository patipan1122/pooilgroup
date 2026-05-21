// /repairs/[id] — full-page ticket detail (Pooil App redesign · standalone)
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import {
  requireRepairAccess,
  canRepairWrite,
  canRepairAdmin,
} from "@/lib/repair/role-guard";
import { getTicketDetail, listTechnicians } from "@/lib/repair/queries";
import { TicketDetailPanel } from "@/components/repair/ticket-detail-panel";
import { RepairSubHeader } from "@/components/repair/sub-header";
import { ChevronLeft, Receipt } from "lucide-react";
import { STATUS_LABELS, URGENCY_LABELS } from "@/lib/repair/types";

interface Params { id: string }

export default async function RepairDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const { id } = await params;

  const [ticket, technicians] = await Promise.all([
    getTicketDetail(session.user.org_id, id),
    listTechnicians(session.user.org_id),
  ]);
  if (!ticket) notFound();

  return (
    <>
      <RepairSubHeader
        icon={Receipt}
        eyebrow={`Ticket · ${STATUS_LABELS[ticket.status]}`}
        title={ticket.title}
        subtitle={`${ticket.ticketCode}${
          ticket.branch ? ` · ${ticket.branch.code} ${ticket.branch.name}` : ""
        } · ${URGENCY_LABELS[ticket.urgency]}`}
        backHref="/repairs/triage"
        crumbs={[
          { label: "Triage", href: "/repairs/triage" },
          { label: ticket.ticketCode },
        ]}
        actions={
          <Link
            href={`/repairs/triage?selected=${ticket.id}`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-zinc-700 font-semibold text-[12px] hover:bg-zinc-50"
          >
            <ChevronLeft className="size-3.5" />
            กลับ Triage
          </Link>
        }
      />

      <div className="p-3 sm:p-5 lg:p-6 max-w-[1100px] mx-auto">
        <div className="bg-white rounded-xl border border-zinc-200">
          <TicketDetailPanel
            ticket={ticket}
            technicians={technicians}
            canWrite={canRepairWrite(session.user.role)}
            canAdmin={canRepairAdmin(session.user.role)}
          />
        </div>
      </div>
    </>
  );
}
