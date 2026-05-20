"use client";

// Admin inbox — list + detail combo workspace (Linear/Gmail style).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
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
import { Search, X, Plus, MapPin, Inbox as InboxIcon, AlertTriangle, Wrench, PackageSearch, BadgeDollarSign } from "lucide-react";
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

export function AdminInbox(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [query, setQuery] = useState(props.currentQuery);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.push(`/repairs?${next.toString()}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam("q", query.trim() || null);
  }

  const openCount = OPEN_STATUSES.reduce((s, st) => s + props.statusCounts[st], 0);

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900">
            ระบบแจ้งซ่อม
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            กล่องรับเรื่อง · ติดตามงาน · มอบหมายช่าง
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/r/new"
            target="_blank"
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border-2 border-zinc-200 bg-white text-zinc-700 font-bold text-sm hover:bg-zinc-50"
            title="เปิดฟอร์มสาธารณะในแท็บใหม่"
          >
            <Search className="size-4" />
            ดูฟอร์มสาธารณะ
          </Link>
          {props.canWrite && (
            <Link
              href="/repairs/new"
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[var(--color-brand-600)] text-white font-bold text-sm hover:bg-[var(--color-brand-700)]"
            >
              <Plus className="size-4" />
              แจ้งซ่อมใหม่
            </Link>
          )}
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-5">
        <KpiCard
          icon={<InboxIcon className="size-4" />}
          label="เปิดอยู่"
          value={openCount}
          accent="zinc"
        />
        <KpiCard
          icon={<AlertTriangle className="size-4" />}
          label="ด่วนมาก"
          value={props.urgencyCounts.URGENT}
          accent="red"
        />
        <KpiCard
          icon={<Wrench className="size-4" />}
          label="กำลังซ่อม"
          value={props.statusCounts.IN_PROGRESS}
          accent="amber"
        />
        <KpiCard
          icon={<PackageSearch className="size-4" />}
          label="รออะไหล่"
          value={props.statusCounts.WAITING_PARTS}
          accent="orange"
        />
        <KpiCard
          icon={<BadgeDollarSign className="size-4" />}
          label="ค่าใช้จ่ายเดือนนี้"
          value={formatBaht(props.openCost)}
          accent="emerald"
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

        {/* Status pills */}
        <div className="flex flex-wrap gap-1.5">
          <Pill
            active={props.currentStatus === null}
            onClick={() => setParam("status", null)}
          >
            ทั้งหมด ({Object.values(props.statusCounts).reduce((a, b) => a + b, 0)})
          </Pill>
          {(["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED", "CLOSED", "CANCELLED"] as RepairTicketStatus[]).map((s) => (
            <Pill
              key={s}
              active={props.currentStatus === s}
              onClick={() => setParam("status", s)}
              dotClass={STATUS_COLORS[s]}
            >
              {STATUS_LABELS[s]} ({props.statusCounts[s]})
            </Pill>
          ))}
        </div>

        {/* Urgency pills */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 self-center pr-1">
            ระดับ:
          </span>
          <Pill
            active={props.currentUrgency === null}
            onClick={() => setParam("urgency", null)}
          >
            ทุกระดับ
          </Pill>
          {(["URGENT", "NORMAL", "LOW"] as RepairUrgency[]).map((u) => (
            <Pill
              key={u}
              active={props.currentUrgency === u}
              onClick={() => setParam("urgency", u)}
              dotClass={URGENCY_COLORS[u]}
            >
              {URGENCY_LABELS[u]} ({props.urgencyCounts[u]})
            </Pill>
          ))}
        </div>
      </div>

      {/* List + Detail */}
      <div className="grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-3">
        {/* List */}
        <aside className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-200 bg-zinc-50">
            <p className="text-sm font-bold text-zinc-900">
              ใบทั้งหมด ({props.tickets.length})
            </p>
          </div>
          <ul className="divide-y divide-zinc-100 max-h-[70vh] lg:max-h-[calc(100vh-280px)] overflow-y-auto">
            {props.tickets.length === 0 && (
              <li className="p-8 text-center text-zinc-500 text-sm">
                ไม่มีใบในเงื่อนไขนี้
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
                      <span className={`text-[10px] font-bold uppercase px-1.5 h-5 inline-flex items-center rounded border ${URGENCY_COLORS[t.urgency]}`}>
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
                      <span className={`inline-flex items-center px-1.5 h-5 rounded text-[10px] font-bold border ${STATUS_COLORS[t.status]}`}>
                        {STATUS_LABELS[t.status]}
                      </span>
                      {sla !== "done" && (sla === "overdue" || sla === "soon") && (
                        <span className={`inline-flex items-center px-1.5 h-5 rounded text-[10px] font-bold border ${slaBadgeColor(sla)}`}>
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
        <section className="bg-white rounded-xl border border-zinc-200 min-h-[60vh]">
          {props.selectedTicket ? (
            <TicketDetailPanel
              ticket={props.selectedTicket}
              technicians={props.technicians}
              canWrite={props.canWrite}
              canAdmin={props.canAdmin}
            />
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

function Pill({
  active,
  onClick,
  children,
  dotClass,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  dotClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-2.5 rounded-md text-xs font-bold inline-flex items-center gap-1 border ${
        active
          ? "bg-zinc-900 text-white border-zinc-900"
          : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400"
      }`}
    >
      {dotClass && (
        <span className={`size-2 rounded-full ${dotClass.split(" ")[0]}`} />
      )}
      {children}
    </button>
  );
}

function KpiCard({
  icon,
  label,
  value,
  accent,
  isMoney,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent: "zinc" | "red" | "amber" | "orange" | "emerald";
  isMoney?: boolean;
}) {
  const colorMap: Record<string, string> = {
    zinc: "bg-zinc-100 text-zinc-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
    orange: "bg-orange-100 text-orange-700",
    emerald: "bg-emerald-100 text-emerald-700",
  };
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3 flex items-start gap-3">
      <div className={`size-8 rounded-lg grid place-items-center flex-shrink-0 ${colorMap[accent]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-zinc-500 truncate">{label}</p>
        <p className={`font-extrabold text-zinc-900 ${isMoney ? "text-base sm:text-lg" : "text-xl sm:text-2xl"}`}>
          {value}
        </p>
      </div>
    </div>
  );
}
