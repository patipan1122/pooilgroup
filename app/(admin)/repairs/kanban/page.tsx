// /repairs/kanban — Pooil App Kanban (.kanban .kanban-col .kcard exact structure)
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
import { slaStatusFor, slaBadgeLabel } from "@/lib/repair/sla";
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
  NEW: "var(--st-new)",
  ACK: "var(--st-assess)",
  IN_PROGRESS: "var(--st-approval)",
  WAITING_PARTS: "var(--st-parts)",
  RESOLVED: "var(--st-done)",
};

interface Search { company?: string }

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
      take: 500,
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
      <div className="repair-content">
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div className="kanban">
            {KANBAN_STATUSES.map((s) => {
              const col = (byStatus.get(s) ?? []).slice().sort((a, b) => {
                const pa = a.urgency === "URGENT" ? 0 : a.urgency === "NORMAL" ? 1 : 2;
                const pb = b.urgency === "URGENT" ? 0 : b.urgency === "NORMAL" ? 1 : 2;
                if (pa !== pb) return pa - pb;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              });
              return (
                <div className="kanban-col" key={s}>
                  <div className="kanban-col-head">
                    <span className="kanban-col-dot" style={{ background: STATUS_DOT[s] ?? "var(--ink-400)" }} />
                    <span className="kanban-col-title">{STATUS_LABELS[s]}</span>
                    <span className="kanban-col-count num">{col.length}</span>
                  </div>
                  <div className="kanban-col-body">
                    {col.length === 0 && (
                      <div style={{ padding: "20px 0", textAlign: "center", color: "var(--ink-400)", fontSize: 11 }}>
                        — ว่าง —
                      </div>
                    )}
                    {col.map((t) => {
                      const sla = slaStatusFor(t);
                      const isUrgent = t.urgency === "URGENT";
                      const cost = totalTicketCost(t);
                      return (
                        <Link
                          key={t.id}
                          href={`/repairs/triage?selected=${t.id}`}
                          className={"kcard " + (isUrgent ? "is-urgent" : "")}
                        >
                          <div className="kcard-top">
                            <span className="kcard-id">{t.ticketCode}</span>
                            <span style={{ color: "var(--ink-400)" }}>·</span>
                            <span className="num" style={{ fontWeight: 600, color: "var(--ink-700)" }}>
                              {t.branch?.code ?? "—"}
                            </span>
                            <span style={{
                              color: "var(--ink-500)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1, minWidth: 0,
                            }}>
                              {t.branch?.name ?? ""}
                            </span>
                          </div>
                          <div className="kcard-title">
                            {t.category?.emoji && <span style={{ marginRight: 4 }}>{t.category.emoji}</span>}
                            {t.title}
                          </div>
                          <div className="kcard-tags">
                            {t.category && (
                              <span className="tag">{t.category.label.split("/")[0]}</span>
                            )}
                            {isUrgent && (
                              <span className="pill pill-urgent">
                                <span className="dot" />
                                {URGENCY_LABELS.URGENT}
                              </span>
                            )}
                            {t._count.parts > 0 && (
                              <span className="tag" style={{ background: "var(--st-parts-bg)", color: "#0E7490" }}>
                                อะไหล่ {t._count.parts}
                              </span>
                            )}
                          </div>
                          <div className="kcard-bottom">
                            {t.assignedTech ? (
                              <>
                                <span className="tech-chip" style={{
                                  width: 18, height: 18, fontSize: 9,
                                  background: techColor(t.assignedTech.id),
                                }}>
                                  {t.assignedTech.name.charAt(0)}
                                </span>
                                <span style={{
                                  fontSize: 11, color: "var(--ink-700)",
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  maxWidth: 90,
                                }}>
                                  {t.assignedTech.name}
                                </span>
                              </>
                            ) : (
                              <span style={{
                                fontSize: 11, color: "var(--ink-400)",
                                fontStyle: "italic",
                                display: "inline-flex", alignItems: "center", gap: 4,
                              }}>
                                <MapPin size={11} />
                                ยังไม่มอบ
                              </span>
                            )}
                            <span className="spacer" />
                            {t._count.photos > 0 && (
                              <span className="kcard-iconlet"><Camera /> {t._count.photos}</span>
                            )}
                            {t._count.events > 0 && (
                              <span className="kcard-iconlet"><MessageSquare /> {t._count.events}</span>
                            )}
                            {sla !== "done" && sla !== "ok" && (
                              <span className={"sla " + sla}>
                                {slaBadgeLabel(sla, t.resolveDueAt)}
                              </span>
                            )}
                          </div>
                          {cost > 0 && (
                            <div style={{
                              display: "flex", alignItems: "baseline", gap: 6,
                              fontSize: 11, color: "var(--ink-500)", paddingTop: 2,
                            }}>
                              <span>ค่าซ่อม</span>
                              <span className="kcard-cost">{formatBaht(cost)}</span>
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

