// /repairs/kanban — Kanban board with 5 status columns (Pooil App redesign · รอบ 48)
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess, canRepairWrite } from "@/lib/repair/role-guard";
import { prisma } from "@/lib/prisma";
import {
  KANBAN_STATUSES,
  STATUS_LABELS,
  URGENCY_LABELS,
  formatBaht,
  totalTicketCost,
  OPEN_STATUSES,
} from "@/lib/repair/types";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";
import { MapPin, Camera, MessageSquare } from "lucide-react";
import { RepairViewHeader } from "@/components/repair/view-header";
import {
  countTicketsByStatus,
  countTicketsByUrgency,
  countNewSince,
  listCompanies,
} from "@/lib/repair/queries";

export const dynamic = "force-dynamic";

const STATUS_DOT: Record<string, string> = {
  NEW: "bg-blue-500",
  ACK: "bg-violet-500",
  IN_PROGRESS: "bg-amber-500",
  WAITING_PARTS: "bg-cyan-500",
  RESOLVED: "bg-emerald-500",
};

interface Search {
  company?: string;
}

export default async function RepairKanbanPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const orgId = session.user.org_id;
  const params = await searchParams;
  const companyId = params.company || null;

  const KANBAN_TAKE = 500;
  const where: Record<string, unknown> = {
    orgId,
    status: { in: KANBAN_STATUSES },
  };
  if (companyId) where.companyId = companyId;

  const [tickets, statusCounts, urgencyCounts, newToday, companies] = await Promise.all([
    prisma.repairTicket.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true, code: true } },
        category: { select: { id: true, label: true, emoji: true } },
        assignedTech: { select: { id: true, name: true } },
        _count: { select: { photos: true, parts: true, events: true } },
      },
      orderBy: [{ urgency: "asc" }, { createdAt: "desc" }],
      take: KANBAN_TAKE,
    }),
    countTicketsByStatus(orgId, companyId),
    countTicketsByUrgency(orgId, true, companyId),
    countNewSince(orgId, 24, companyId),
    listCompanies(orgId),
  ]);

  const byStatus = new Map<string, typeof tickets>();
  for (const s of KANBAN_STATUSES) byStatus.set(s, []);
  for (const t of tickets) byStatus.get(t.status)?.push(t);

  const openCount = OPEN_STATUSES.reduce((s, st) => s + statusCounts[st], 0);
  const total = openCount + statusCounts.RESOLVED + statusCounts.CLOSED + statusCounts.CANCELLED;

  return (
    <>
      <RepairViewHeader
        active="kanban"
        companies={companies}
        currentCompanyId={companyId}
        openCount={openCount}
        urgentCount={urgencyCounts.URGENT}
        canWrite={canRepairWrite(session.user.role)}
        ticketTotal={total}
        newSinceYesterday={newToday}
      />
      <div className="p-3 sm:p-5 lg:p-6 max-w-[1800px] mx-auto">
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_STATUSES.map((s) => {
            const col = byStatus.get(s) ?? [];
            return (
              <div
                key={s}
                className="bg-zinc-50 rounded-xl border border-zinc-200 w-[280px] shrink-0 flex flex-col"
              >
                <div className="px-3 py-2.5 border-b border-zinc-200 bg-white rounded-t-xl flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full shrink-0 ${STATUS_DOT[s] ?? "bg-zinc-400"}`}
                  />
                  <span className="text-[12.5px] font-bold text-zinc-800">
                    {STATUS_LABELS[s]}
                  </span>
                  <span className="ml-auto text-[10.5px] tabular-nums font-bold bg-zinc-100 text-zinc-700 px-1.5 rounded-full">
                    {col.length}
                  </span>
                </div>
                <div className="space-y-2 p-2.5 flex-1 min-h-[60vh] max-h-[calc(100vh-260px)] overflow-y-auto">
                  {col.length === 0 && (
                    <p className="text-center text-[11.5px] text-zinc-400 py-8">ว่าง</p>
                  )}
                  {col.map((t) => {
                    const sla = slaStatusFor(t);
                    const isUrgent = t.urgency === "URGENT";
                    const cost = totalTicketCost(t);
                    return (
                      <Link
                        key={t.id}
                        href={`/repairs/triage?selected=${t.id}`}
                        className={`block bg-white rounded-md border border-zinc-200 p-2.5 hover:border-zinc-300 hover:shadow-sm transition-all space-y-1.5 ${
                          isUrgent ? "border-l-[3px] border-l-red-500 pl-2" : ""
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-500">
                          <span className="font-mono font-bold text-zinc-700">{t.ticketCode}</span>
                          {t.branch && (
                            <>
                              <span className="text-zinc-300">·</span>
                              <span className="font-mono font-bold text-zinc-700">
                                {t.branch.code}
                              </span>
                            </>
                          )}
                        </div>
                        <p className="text-[12.5px] font-semibold text-zinc-900 leading-snug line-clamp-2">
                          {t.category?.emoji && <span className="mr-1">{t.category.emoji}</span>}
                          {t.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-1">
                          {t.category && (
                            <span className="text-[10px] bg-zinc-100 text-zinc-700 px-1.5 py-px rounded font-medium">
                              {t.category.label.split("/")[0]}
                            </span>
                          )}
                          {isUrgent && (
                            <span className="text-[10px] bg-red-50 text-red-700 border border-red-200 px-1.5 py-px rounded font-bold">
                              {URGENCY_LABELS.URGENT}
                            </span>
                          )}
                          {t._count.parts > 0 && (
                            <span className="text-[10px] bg-cyan-50 text-cyan-700 border border-cyan-200 px-1.5 py-px rounded font-bold">
                              อะไหล่ {t._count.parts}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 pt-1.5 border-t border-dashed border-zinc-100">
                          {t.assignedTech ? (
                            <>
                              <span
                                className="size-4 rounded-full grid place-items-center text-white text-[9px] font-bold"
                                style={{ background: techColor(t.assignedTech.id) }}
                              >
                                {t.assignedTech.name.charAt(0)}
                              </span>
                              <span className="text-[10.5px] text-zinc-700 font-medium truncate">
                                {t.assignedTech.name}
                              </span>
                            </>
                          ) : (
                            <span className="text-[10.5px] text-zinc-400 italic flex items-center gap-1">
                              <MapPin className="size-3" />
                              ยังไม่มอบหมาย
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-500">
                            {t._count.photos > 0 && (
                              <span className="inline-flex items-center gap-0.5 tabular-nums">
                                <Camera className="size-2.5" />
                                {t._count.photos}
                              </span>
                            )}
                            {t._count.events > 0 && (
                              <span className="inline-flex items-center gap-0.5 tabular-nums">
                                <MessageSquare className="size-2.5" />
                                {t._count.events}
                              </span>
                            )}
                            {sla !== "done" && sla !== "ok" && (
                              <span
                                className={`px-1 py-px rounded text-[9.5px] font-bold border ${slaBadgeColor(sla)}`}
                              >
                                {slaBadgeLabel(sla, t.resolveDueAt)}
                              </span>
                            )}
                          </span>
                        </div>
                        {cost > 0 && (
                          <div className="flex items-baseline gap-1 text-[10.5px] text-zinc-500">
                            <span>ค่าซ่อม</span>
                            <span className="tabular-nums font-bold text-zinc-800">
                              {formatBaht(cost)}
                            </span>
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function techColor(id: string): string {
  const palette = [
    "#2563EB", "#7C3AED", "#DB2777", "#059669",
    "#EA580C", "#0891B2", "#CA8A04", "#475569",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
