// /repairs/[id] — full-page ticket detail (standalone)
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess, canRepairWrite, canRepairAdmin } from "@/lib/repair/role-guard";
import { getTicketDetail, listTechnicians } from "@/lib/repair/queries";
import { TicketDetailPanel } from "@/components/repair/ticket-detail-panel";
import { ArrowLeft } from "lucide-react";

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
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <Link
        href="/repairs"
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-zinc-700 font-bold text-sm hover:bg-zinc-100 mb-3"
      >
        <ArrowLeft className="size-4" />
        กลับกล่องรับเรื่อง
      </Link>
      <div className="bg-white rounded-xl border border-zinc-200">
        <TicketDetailPanel
          ticket={ticket}
          technicians={technicians}
          canWrite={canRepairWrite(session.user.role)}
          canAdmin={canRepairAdmin(session.user.role)}
        />
      </div>
    </div>
  );
}
