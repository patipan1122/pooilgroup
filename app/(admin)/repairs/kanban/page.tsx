// /repairs/kanban — Kanban board with 5 status columns
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { prisma } from "@/lib/prisma";
import { KANBAN_STATUSES, STATUS_LABELS, STATUS_COLORS, URGENCY_LABELS, URGENCY_COLORS } from "@/lib/repair/types";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";
import { MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RepairKanbanPage() {
  const session = await requireSession();
  requireRepairAccess(session.user.role);

  // Cap at 500 to avoid unbounded load once tickets accumulate. Older
  // tickets are out of urgent attention scope — surface a "load more" if
  // the kanban hits the cap.
  const KANBAN_TAKE = 500;
  const tickets = await prisma.repairTicket.findMany({
    where: {
      orgId: session.user.org_id,
      status: { in: KANBAN_STATUSES },
    },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      category: { select: { id: true, label: true, emoji: true } },
      assignedTech: { select: { id: true, name: true } },
    },
    orderBy: [{ urgency: "asc" }, { createdAt: "desc" }],
    take: KANBAN_TAKE,
  });

  const byStatus = new Map<string, typeof tickets>();
  for (const s of KANBAN_STATUSES) byStatus.set(s, []);
  for (const t of tickets) byStatus.get(t.status)?.push(t);

  return (
    <div className="p-3 sm:p-6 max-w-[1800px] mx-auto">
      <header className="flex items-baseline justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900">
            Kanban
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            ภาพรวมงานซ่อมตามสถานะ · คลิกการ์ดเพื่อดูรายละเอียด
          </p>
        </div>
        <Link
          href="/repairs"
          className="h-10 px-3 rounded-lg border-2 border-zinc-200 bg-white font-bold text-sm hover:bg-zinc-50"
        >
          ดูแบบ List
        </Link>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 overflow-x-auto pb-4">
        {KANBAN_STATUSES.map((s) => {
          const col = byStatus.get(s) ?? [];
          return (
            <div key={s} className="bg-zinc-50 rounded-xl border border-zinc-200 p-2.5 min-w-[260px]">
              <div className={`flex items-center justify-between mb-2 px-1.5 h-7 rounded text-xs font-bold border ${STATUS_COLORS[s]}`}>
                <span>{STATUS_LABELS[s]}</span>
                <span className="opacity-75">{col.length}</span>
              </div>
              <div className="space-y-2 min-h-[60vh]">
                {col.map((t) => {
                  const sla = slaStatusFor(t);
                  return (
                    <Link
                      key={t.id}
                      href={`/repairs?selected=${t.id}`}
                      className="block bg-white rounded-lg border border-zinc-200 p-2.5 hover:border-zinc-400 hover:shadow"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-mono font-bold text-xs text-zinc-500">{t.ticketCode}</p>
                        <span className={`text-xs font-bold px-1.5 h-5 inline-flex items-center rounded border ${URGENCY_COLORS[t.urgency]}`}>
                          {URGENCY_LABELS[t.urgency]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-bold text-zinc-900 line-clamp-2">
                        {t.category?.emoji && <span className="mr-1">{t.category.emoji}</span>}
                        {t.title}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                        {t.branch && (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="size-3" />
                            {t.branch.code}
                          </span>
                        )}
                        {t.assignedTech && <span>· {t.assignedTech.name}</span>}
                        {sla !== "done" && (sla === "overdue" || sla === "soon") && (
                          <span className={`px-1.5 h-5 inline-flex items-center rounded text-xs font-bold border ${slaBadgeColor(sla)}`}>
                            {slaBadgeLabel(sla, t.resolveDueAt)}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
                {col.length === 0 && (
                  <p className="text-center text-xs text-zinc-400 py-6">ว่าง</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
