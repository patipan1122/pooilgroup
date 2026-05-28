"use client";

// Pooil App · Triage Inbox · uses exact design CSS (.triage / .triage-list /
// .triage-row / detail panel). list left + detail right.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  STATUS_LABELS,
  URGENCY_LABELS,
  OPEN_STATUSES,
  formatBaht,
} from "@/lib/repair/types";
import { slaStatusFor, slaBadgeLabel } from "@/lib/repair/sla";
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";
import {
  Search,
  X,
  Inbox as InboxIcon,
  AlertTriangle,
  Clock,
  Filter,
} from "lucide-react";
import { TicketDetailPanel } from "./ticket-detail-panel";

interface TicketSummary {
  id: string;
  ticketCode: string;
  title: string;
  status: RepairTicketStatus;
  urgency: RepairUrgency;
  createdAt: Date;
  resolveDueAt: Date | null;
  resolvedAt: Date | null;
  reporterName: string;
  branch: { id: string; name: string; code: string } | null;
  category: { id: string; label: string; emoji: string | null } | null;
  assignedTech: { id: string; name: string } | null;
  _count: { photos: number; parts: number; events: number };
}
interface Category { id: string; label: string; emoji: string | null }
interface Branch { id: string; name: string; code: string }
interface Technician { id: string; name: string; kind: "INTERNAL" | "VENDOR"; isActive: boolean }

interface Props {
  orgId: string;
  statusCounts: Record<RepairTicketStatus, number>;
  urgencyCounts: Record<RepairUrgency, number>;
  openCost: number;
  tickets: TicketSummary[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedTicket: any | null;
  categories: Category[];
  branches: Branch[];
  technicians: Technician[];
  currentStatus: RepairTicketStatus | null;
  currentUrgency: RepairUrgency | null;
  currentBranch: string | null;
  currentCategory: string | null;
  currentQuery: string;
  canWrite: boolean;
  canAdmin: boolean;
}

const STATUS_DOT: Record<RepairTicketStatus, string> = {
  NEW: "var(--st-new)",
  ACK: "var(--st-assess)",
  IN_PROGRESS: "var(--st-approval)",
  WAITING_PARTS: "var(--st-parts)",
  RESOLVED: "var(--st-done)",
  CLOSED: "var(--ink-400)",
  CANCELLED: "var(--ink-300)",
};

const STATUS_CLS: Record<RepairTicketStatus, string> = {
  NEW: "pill-new",
  ACK: "pill-assess",
  IN_PROGRESS: "pill-approval",
  WAITING_PARTS: "pill-parts",
  RESOLVED: "pill-done",
  CLOSED: "pill-done",
  CANCELLED: "pill-low",
};

export function AdminInbox(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [query, setQuery] = useState(props.currentQuery);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.push(`/repairs/triage?${next.toString()}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam("q", query.trim() || null);
  }

  const openCount = OPEN_STATUSES.reduce((s, st) => s + props.statusCounts[st], 0);
  const overdueTickets = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return props.tickets.filter(
      (t) =>
        OPEN_STATUSES.includes(t.status) &&
        t.resolveDueAt &&
        new Date(t.resolveDueAt).getTime() < now,
    );
  }, [props.tickets]);
  const overdueCount = overdueTickets.length;
  const urgentOpen = props.urgencyCounts.URGENT;
  const heroActive = urgentOpen > 0 || overdueCount > 0;

  return (
    <div className="repair-content">
      {heroActive && (
        <div className="attention-bar">
          <div className="attention-pip">
            <div className="attention-mark"><AlertTriangle size={20} /></div>
            <div>
              <div className="attention-label">ต้องดูตอนนี้</div>
              <div className="attention-title">
                {urgentOpen > 0 && (
                  <span style={{ marginRight: 12 }}>
                    <span className="num" style={{ color: "var(--bad)" }}>{urgentOpen}</span> ใบด่วน
                  </span>
                )}
                {overdueCount > 0 && (
                  <span>
                    <span className="num" style={{ color: "var(--bad)" }}>{overdueCount}</span> ใบเกิน SLA
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {urgentOpen > 0 && (
              <button
                type="button"
                onClick={() => setParam("urgency", "URGENT")}
                className="btn btn-primary btn-sm"
                style={{ background: "var(--bad)", borderColor: "#B91C1C" }}
              >
                ดูใบด่วน
              </button>
            )}
            {overdueCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  const first = overdueTickets[0];
                  if (first) router.push(`/repairs/triage?selected=${first.id}`);
                }}
                className="btn btn-sm"
                style={{ background: "#fff", borderColor: "#FECACA", color: "var(--bad)" }}
              >
                เปิดใบเกิน SLA →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quick KPIs */}
      <div className="kpi-row" style={{ marginBottom: 14 }}>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="kpi-label"><span className="kpi-label-icon"><InboxIcon /></span>เปิดอยู่</div>
          <div className="kpi-value num">{openCount}</div>
        </div>
        <div className={"kpi " + (urgentOpen > 0 ? "danger" : "")} style={{ cursor: "default" }}>
          <div className="kpi-label"><span className="kpi-label-icon"><AlertTriangle /></span>ด่วนมาก</div>
          <div className="kpi-value num">{urgentOpen}</div>
        </div>
        <div className="kpi warn" style={{ cursor: "default" }}>
          <div className="kpi-label"><span className="kpi-label-icon"><AlertTriangle /></span>เกิน SLA</div>
          <div className="kpi-value num">{overdueCount}</div>
        </div>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="kpi-label"><span className="kpi-label-icon"><InboxIcon /></span>กำลังซ่อม</div>
          <div className="kpi-value num">{props.statusCounts.IN_PROGRESS}</div>
        </div>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="kpi-label"><span className="kpi-label-icon"><InboxIcon /></span>รออะไหล่</div>
          <div className="kpi-value num">{props.statusCounts.WAITING_PARTS}</div>
        </div>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="kpi-label"><span className="kpi-label-icon"><InboxIcon /></span>เดือนนี้</div>
          <div className="kpi-value num" style={{ fontSize: 16 }}>{formatBaht(props.openCost)}</div>
        </div>
      </div>

      {/* Search + filter chips */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <form onSubmit={submitSearch} style={{ display: "flex", gap: 6, flex: 1, maxWidth: 320 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 7,
              flex: 1, background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: 8, padding: "4px 9px",
            }}>
              <Search size={13} style={{ color: "var(--ink-400)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นเลขที่ใบ · หัวเรื่อง · ผู้แจ้ง · เบอร์"
                style={{ border: 0, outline: 0, flex: 1, fontSize: 12.5, background: "transparent" }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(""); setParam("q", null); }}
                  style={{
                    width: 22, height: 22, borderRadius: 4, border: 0,
                    background: "transparent", display: "grid", placeItems: "center",
                    color: "var(--ink-400)", cursor: "pointer",
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button type="submit" className="btn btn-sm btn-primary">ค้นหา</button>
          </form>

          <span style={{ flex: 1 }} />

          <span style={{ fontSize: 11, color: "var(--ink-500)" }}>สถานะ:</span>
          <button
            type="button"
            className={"table-filter " + (props.currentStatus === null ? "is-active" : "")}
            onClick={() => setParam("status", null)}
          >
            ทั้งหมด
          </button>
          {(["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED", "CLOSED"] as RepairTicketStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              className={"table-filter " + (props.currentStatus === s ? "is-active" : "")}
              onClick={() => setParam("status", s)}
            >
              <span className="step-dot" style={{ background: STATUS_DOT[s] }} />
              {STATUS_LABELS[s]}
            </button>
          ))}
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--line)", margin: "0 4px" }} />
          <span style={{ fontSize: 11, color: "var(--ink-500)" }}>ระดับ:</span>
          <button
            type="button"
            className={"table-filter " + (props.currentUrgency === null ? "is-active" : "")}
            onClick={() => setParam("urgency", null)}
          >
            ทุกระดับ
          </button>
          {(["URGENT", "NORMAL", "LOW"] as RepairUrgency[]).map((u) => (
            <button
              key={u}
              type="button"
              className={"table-filter " + (props.currentUrgency === u ? "is-active" : "")}
              onClick={() => setParam("urgency", u)}
            >
              <span className="step-dot" style={{
                background: u === "URGENT" ? "var(--p-urgent)" : u === "NORMAL" ? "var(--p-normal)" : "var(--p-low)",
              }} />
              {URGENCY_LABELS[u]}
            </button>
          ))}
        </div>
      </div>

      {/* Triage split-view */}
      <div className="triage">
        {/* LIST */}
        <aside className="triage-list" style={{ display: props.selectedTicket ? undefined : undefined }}>
          <div style={{
            height: 44, padding: "0 14px", display: "flex", alignItems: "center",
            borderBottom: "1px solid var(--line-2)", background: "var(--surface-2)",
            fontSize: 12, color: "var(--ink-700)", fontWeight: 600,
          }}>
            <Filter size={13} style={{ marginRight: 6, color: "var(--ink-500)" }} />
            ใบทั้งหมด ({props.tickets.length})
          </div>
          <div className="triage-rows">
            {props.tickets.length === 0 && (
              <div style={{ padding: 32, textAlign: "center" }}>
                <InboxIcon size={32} style={{ color: "var(--ink-300)" }} />
                <p style={{ marginTop: 8, fontSize: 12, color: "var(--ink-500)" }}>ไม่มีใบในเงื่อนไขนี้</p>
                <button
                  type="button"
                  onClick={() => router.push("/repairs/triage")}
                  className="btn btn-sm"
                  style={{ marginTop: 10 }}
                >
                  ล้างตัวกรอง
                </button>
              </div>
            )}
            {props.tickets.map((t) => {
              const sla = slaStatusFor(t);
              const isSelected = props.selectedTicket?.id === t.id;
              const prioColor =
                t.urgency === "URGENT" ? "var(--p-urgent)"
                : t.urgency === "NORMAL" ? "var(--p-normal)"
                : "var(--p-low)";
              return (
                <Link
                  key={t.id}
                  href={`?${setParamHref(sp, "selected", t.id)}`}
                  className={"triage-row " + (isSelected ? "is-selected" : "")}
                >
                  <div className="prio-dot" style={{ background: prioColor }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="triage-row-title">
                      {t.category?.emoji && <span style={{ marginRight: 4 }}>{t.category.emoji}</span>}
                      {t.title}
                    </div>
                    <div className="triage-row-meta">
                      <span className="branch-id num">{t.ticketCode}</span>
                      {t.branch && (
                        <>
                          <span style={{ color: "var(--ink-300)" }}>·</span>
                          <span className="branch-id num">{t.branch.code}</span>
                          <span style={{
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            minWidth: 0,
                          }}>{t.branch.name}</span>
                        </>
                      )}
                    </div>
                    <div className="triage-row-foot">
                      <span className={"pill " + STATUS_CLS[t.status]}>
                        <span className="dot" />
                        {STATUS_LABELS[t.status]}
                      </span>
                      {t.category && (
                        <span className="tag">{t.category.label.split("/")[0]}</span>
                      )}
                      {t.assignedTech && (
                        <span style={{ fontSize: 10.5, color: "var(--ink-600)" }}>
                          ·{" "}{t.assignedTech.name}
                        </span>
                      )}
                      <span style={{ flex: 1 }} />
                      {sla !== "done" && sla !== "ok" && (
                        <span className={"sla " + sla}>
                          <Clock />
                          {slaBadgeLabel(sla, t.resolveDueAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </aside>

        {/* DETAIL */}
        <section className="triage-detail">
          {props.selectedTicket ? (
            <TicketDetailPanel
              ticket={props.selectedTicket}
              technicians={props.technicians}
              canWrite={props.canWrite}
              canAdmin={props.canAdmin}
            />
          ) : (
            <div style={{
              height: "100%", display: "grid", placeItems: "center",
              color: "var(--ink-500)", padding: 32, textAlign: "center",
            }}>
              <div>
                <InboxIcon size={32} style={{ color: "var(--ink-300)" }} />
                <p style={{ marginTop: 8, fontSize: 13, fontWeight: 600 }}>
                  เลือกใบจากรายการซ้ายเพื่อดูรายละเอียด
                </p>
                <p style={{ marginTop: 4, fontSize: 11.5, color: "var(--ink-500)" }}>
                  หรือกรองด้วยสถานะ / ระดับ / สาขา ทางด้านบน
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function setParamHref(sp: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(sp.toString());
  next.set(key, value);
  return next.toString();
}

