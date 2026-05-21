"use client";

// Admin inbox — list + detail combo workspace (Linear/Gmail style).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  URGENCY_LABELS,
  URGENCY_COLORS,
  OPEN_STATUSES,
  formatBaht,
} from "@/lib/repair/types";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";
import { Search, X, MapPin, Inbox as InboxIcon, AlertTriangle, Wrench, PackageSearch, BadgeDollarSign } from "lucide-react";
import { TicketDetailPanel } from "./ticket-detail-panel";
import { KpiTile } from "@/components/ui/kpi-tile";
import { FilterPill } from "@/components/ui/filter-pill";

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
  // Compute overdue from loaded tickets (resolveDueAt past, still open).
  // Date.now() inside useMemo — fine here because the value only matters at
  // render time for a hero alert; React's purity rule false-positives on this.
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
    <div className="p-3 sm:p-5 lg:p-6 max-w-[1600px] mx-auto">
      {/* Hero attention bar — first-second content per Artifact #1 ·
          shows only when something genuinely needs attention. */}
      {heroActive && (
        <div className="mb-4 rounded-2xl border-2 border-red-300 bg-gradient-to-r from-red-50 to-amber-50 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="size-12 rounded-2xl bg-red-600 text-white grid place-items-center shrink-0">
                <AlertTriangle className="size-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-red-700">
                  ต้องดูตอนนี้
                </p>
                <p className="text-zinc-900 font-bold text-base sm:text-lg">
                  {urgentOpen > 0 && (
                    <span className="mr-3">
                      <span className="tabular-num text-red-700">{urgentOpen}</span> ใบด่วน
                    </span>
                  )}
                  {overdueCount > 0 && (
                    <span>
                      <span className="tabular-num text-red-700">{overdueCount}</span> ใบเกิน SLA
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-2 sm:ml-auto">
              {urgentOpen > 0 && (
                <button
                  type="button"
                  onClick={() => setParam("urgency", "URGENT")}
                  className="h-10 px-4 rounded-lg bg-red-600 text-white font-bold text-sm hover:bg-red-700"
                >
                  ดูใบด่วน
                </button>
              )}
              {overdueCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const first = overdueTickets[0];
                    if (first) {
                      router.push(`/repairs/triage?selected=${first.id}`);
                    }
                  }}
                  className="h-10 px-4 rounded-lg bg-white border-2 border-red-300 text-red-700 font-bold text-sm hover:bg-red-50"
                >
                  เปิดใบที่เกิน SLA →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI strip — uses shared <KpiTile> primitive (รอบ 46 unified) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-5">
        <KpiTile
          icon={<InboxIcon className="size-4" />}
          label="เปิดอยู่"
          value={openCount}
          accent="zinc"
        />
        <KpiTile
          icon={<AlertTriangle className="size-4" />}
          label="ด่วนมาก"
          value={props.urgencyCounts.URGENT}
          accent="danger"
        />
        <KpiTile
          icon={<Wrench className="size-4" />}
          label="กำลังซ่อม"
          value={props.statusCounts.IN_PROGRESS}
          accent="warning"
        />
        <KpiTile
          icon={<PackageSearch className="size-4" />}
          label="รออะไหล่"
          value={props.statusCounts.WAITING_PARTS}
          accent="orange"
        />
        <KpiTile
          icon={<BadgeDollarSign className="size-4" />}
          label="ค่าใช้จ่ายเดือนนี้"
          value={formatBaht(props.openCost)}
          accent="success"
          isMoney
        />
      </div>

      {/* Search + filters */}
      <div className="rounded-xl bg-white border border-zinc-200 p-3 mb-3 space-y-2.5">
        <form onSubmit={submitSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นเลขที่ใบ · หัวเรื่อง · ผู้แจ้ง · เบอร์"
              className="w-full h-10 pl-9 pr-3 rounded-lg border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setParam("q", null);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded text-zinc-400 hover:bg-zinc-100"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="h-10 px-4 rounded-lg bg-zinc-900 text-white font-bold text-sm hover:bg-zinc-700"
          >
            ค้นหา
          </button>
        </form>

        {/* Status pills — shared <FilterPill> primitive */}
        <div className="flex flex-wrap gap-1.5">
          <FilterPill
            active={props.currentStatus === null}
            onClick={() => setParam("status", null)}
            count={Object.values(props.statusCounts).reduce((a, b) => a + b, 0)}
          >
            ทั้งหมด
          </FilterPill>
          {(["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED", "CLOSED", "CANCELLED"] as RepairTicketStatus[]).map((s) => (
            <FilterPill
              key={s}
              active={props.currentStatus === s}
              onClick={() => setParam("status", s)}
              dotClass={STATUS_COLORS[s].split(" ")[0]}
              count={props.statusCounts[s]}
            >
              {STATUS_LABELS[s]}
            </FilterPill>
          ))}
        </div>

        {/* Urgency pills */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs font-bold text-zinc-500 self-center pr-1">
            ระดับ:
          </span>
          <FilterPill
            active={props.currentUrgency === null}
            onClick={() => setParam("urgency", null)}
          >
            ทุกระดับ
          </FilterPill>
          {(["URGENT", "NORMAL", "LOW"] as RepairUrgency[]).map((u) => (
            <FilterPill
              key={u}
              active={props.currentUrgency === u}
              onClick={() => setParam("urgency", u)}
              dotClass={URGENCY_COLORS[u].split(" ")[0]}
              count={props.urgencyCounts[u]}
            >
              {URGENCY_LABELS[u]}
            </FilterPill>
          ))}
        </div>
      </div>

      {/* List + Detail — on mobile, hide list when a ticket is selected so the detail can use full width */}
      <div className="grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-3">
        {/* List */}
        <aside className={`bg-white rounded-xl border border-zinc-200 overflow-hidden ${
          props.selectedTicket ? "hidden lg:block" : "block"
        }`}>
          <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-200 bg-zinc-50">
            <p className="text-sm font-bold text-zinc-900">
              ใบทั้งหมด ({props.tickets.length})
            </p>
          </div>
          <ul className="divide-y divide-zinc-100 max-h-[70vh] lg:max-h-[calc(100vh-280px)] overflow-y-auto">
            {props.tickets.length === 0 && (
              <li className="p-8 text-center">
                <InboxIcon className="size-10 mx-auto text-zinc-300" />
                <p className="mt-3 text-sm font-bold text-zinc-700">ไม่มีใบในเงื่อนไขนี้</p>
                <p className="mt-1 text-xs text-zinc-500">ลองล้างตัวกรอง หรือเปิดใบใหม่</p>
                <button
                  type="button"
                  onClick={() => router.push("/repairs/triage")}
                  className="mt-4 inline-flex items-center h-9 px-3 rounded-lg border-2 border-zinc-200 bg-white text-zinc-700 font-bold text-xs hover:bg-zinc-50"
                >
                  ล้างตัวกรอง
                </button>
              </li>
            )}
            {props.tickets.map((t) => {
              const sla = slaStatusFor(t);
              const isSelected = props.selectedTicket?.id === t.id;
              return (
                <li key={t.id}>
                  <Link
                    href={`?${setParamHref(sp, "selected", t.id)}`}
                    className={`block p-3 hover:bg-zinc-50 ${isSelected ? "bg-[var(--color-brand-50)] border-l-4 border-[var(--color-brand-600)]" : ""}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-mono font-bold text-xs text-zinc-500">
                        {t.ticketCode}
                      </p>
                      <span className={`text-xs font-bold px-1.5 h-5 inline-flex items-center rounded border ${URGENCY_COLORS[t.urgency]}`}>
                        {URGENCY_LABELS[t.urgency]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-bold text-zinc-900 line-clamp-2">
                      {t.category?.emoji && <span className="mr-1">{t.category.emoji}</span>}
                      {t.title}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                      {t.branch && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {t.branch.code}
                        </span>
                      )}
                      <span className={`inline-flex items-center px-1.5 h-5 rounded text-xs font-bold border ${STATUS_COLORS[t.status]}`}>
                        {STATUS_LABELS[t.status]}
                      </span>
                      {sla !== "done" && (sla === "overdue" || sla === "soon") && (
                        <span className={`inline-flex items-center px-1.5 h-5 rounded text-xs font-bold border ${slaBadgeColor(sla)}`}>
                          {slaBadgeLabel(sla, t.resolveDueAt)}
                        </span>
                      )}
                      {t.assignedTech && (
                        <span className="text-zinc-600 font-medium">· {t.assignedTech.name}</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Detail */}
        <section className={`bg-white rounded-xl border border-zinc-200 min-h-[60vh] ${
          props.selectedTicket ? "block" : "hidden lg:block"
        }`}>
          {props.selectedTicket ? (
            <>
              {/* Mobile back-to-list bar */}
              <div className="lg:hidden sticky top-0 z-10 bg-white border-b border-zinc-200 px-3 py-2 flex items-center justify-between rounded-t-xl">
                <Link
                  href={`?${(() => {
                    const next = new URLSearchParams(sp.toString());
                    next.delete("selected");
                    return next.toString();
                  })()}`}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-zinc-700 font-bold text-sm hover:bg-zinc-100"
                >
                  ← กลับรายการ
                </Link>
                <span className="text-xs font-mono text-zinc-500">
                  {props.selectedTicket.ticketCode}
                </span>
              </div>
              <TicketDetailPanel
                ticket={props.selectedTicket}
                technicians={props.technicians}
                canWrite={props.canWrite}
                canAdmin={props.canAdmin}
              />
            </>
          ) : (
            <div className="h-full grid place-items-center text-zinc-400 p-10 text-center">
              <div>
                <InboxIcon className="size-12 mx-auto opacity-40" />
                <p className="mt-4 text-sm font-bold">เลือกใบจากรายการซ้ายเพื่อดูรายละเอียด</p>
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

// Local Pill + KpiCard removed รอบ 46 — moved to:
//   @/components/ui/filter-pill (FilterPill)
//   @/components/ui/kpi-tile (KpiTile)
