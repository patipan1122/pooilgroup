"use client";
// Pooil Repair · dense table view
// Filterable by status/urgency/branch/category + search by code/title.

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Search,
  X,
  Filter,
  Download,
  MoreHorizontal,
} from "lucide-react";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  URGENCY_LABELS,
  URGENCY_COLORS,
  formatBaht,
  totalTicketCost,
} from "@/lib/repair/types";
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";

type Row = {
  id: string;
  ticketCode: string;
  title: string;
  status: RepairTicketStatus;
  urgency: RepairUrgency;
  createdAt: Date;
  resolveDueAt: Date | null;
  resolvedAt: Date | null;
  partsCostCents: number;
  laborCostCents: number;
  branch: { id: string; code: string; name: string } | null;
  category: { id: string; label: string; emoji: string | null } | null;
  assignedTech: { id: string; name: string } | null;
};

interface Props {
  rows: Row[];
  total: number;
  currentStatus: RepairTicketStatus | null;
  currentUrgency: RepairUrgency | null;
  currentQuery: string;
  statusCounts: Record<RepairTicketStatus, number>;
}

const STATUS_DOT: Record<RepairTicketStatus, string> = {
  NEW: "bg-blue-500",
  ACK: "bg-violet-500",
  IN_PROGRESS: "bg-amber-500",
  WAITING_PARTS: "bg-cyan-500",
  RESOLVED: "bg-emerald-500",
  CLOSED: "bg-zinc-400",
  CANCELLED: "bg-zinc-300",
};

const URGENCY_DOT: Record<RepairUrgency, string> = {
  URGENT: "bg-red-500",
  NORMAL: "bg-blue-500",
  LOW: "bg-zinc-400",
};

export function AdminTable(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [query, setQuery] = useState(props.currentQuery);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.push(`/repairs/table?${next.toString()}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam("q", query.trim() || null);
  }

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  function ageHours(d: Date): string {
    const ms = nowMs - new Date(d).getTime();
    const h = ms / (60 * 60 * 1000);
    if (h < 1) return `${Math.round(h * 60)} นาที`;
    if (h < 24) return `${Math.round(h)} ชม.`;
    return `${Math.floor(h / 24)} วัน`;
  }

  return (
    <div className="p-3 sm:p-5 lg:p-6 max-w-[1800px] mx-auto">
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="px-3 py-2.5 border-b border-zinc-100 bg-zinc-50 flex flex-wrap items-center gap-2">
          <form onSubmit={submitSearch} className="relative max-w-[280px] flex-1">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นเลขที่ใบ · หัวเรื่อง · สาขา · ผู้แจ้ง"
              className="w-full h-8 pl-8 pr-7 rounded-md border border-zinc-200 bg-white text-[12.5px] outline-none focus:border-blue-400"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setParam("q", null);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center text-zinc-400 hover:text-zinc-700"
              >
                <X className="size-3" />
              </button>
            )}
          </form>

          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-zinc-500">สถานะ:</span>
            <FilterChip
              active={props.currentStatus === null}
              onClick={() => setParam("status", null)}
            >
              ทั้งหมด
            </FilterChip>
            {(
              [
                "NEW",
                "ACK",
                "IN_PROGRESS",
                "WAITING_PARTS",
                "RESOLVED",
                "CLOSED",
              ] as RepairTicketStatus[]
            ).map((s) => (
              <FilterChip
                key={s}
                active={props.currentStatus === s}
                onClick={() => setParam("status", s)}
              >
                <span className={`size-1.5 rounded-full ${STATUS_DOT[s]}`} />
                {STATUS_LABELS[s]}
              </FilterChip>
            ))}
          </div>

          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-zinc-500">ระดับ:</span>
            <FilterChip
              active={props.currentUrgency === null}
              onClick={() => setParam("urgency", null)}
            >
              ทุกระดับ
            </FilterChip>
            {(["URGENT", "NORMAL", "LOW"] as RepairUrgency[]).map((u) => (
              <FilterChip
                key={u}
                active={props.currentUrgency === u}
                onClick={() => setParam("urgency", u)}
              >
                <span className={`size-1.5 rounded-full ${URGENCY_DOT[u]}`} />
                {URGENCY_LABELS[u]}
              </FilterChip>
            ))}
          </div>

          <span className="ml-auto text-[11.5px] text-zinc-500 tabular-nums">
            {props.rows.length.toLocaleString()} / {props.total.toLocaleString()} ใบ
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-zinc-200 text-[11.5px] font-semibold text-zinc-600 hover:bg-white"
          >
            <Filter className="size-3" /> Filter
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-zinc-200 text-[11.5px] font-semibold text-zinc-600 hover:bg-white"
          >
            <Download className="size-3" /> Export
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto" style={{ maxHeight: "calc(100vh - 290px)" }}>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <Th className="w-7">
                  <input type="checkbox" />
                </Th>
                <Th>เลขที่</Th>
                <Th>หัวเรื่อง</Th>
                <Th>สาขา</Th>
                <Th>หมวด</Th>
                <Th>สถานะ</Th>
                <Th>ระดับ</Th>
                <Th>ช่าง</Th>
                <Th>SLA</Th>
                <Th align="right">อายุ</Th>
                <Th align="right">ค่าใช้จ่าย</Th>
                <Th className="w-7" />
              </tr>
            </thead>
            <tbody>
              {props.rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-12 text-center">
                    <Search className="size-6 mx-auto text-zinc-300" />
                    <p className="mt-2 text-[12px] text-zinc-500">
                      ไม่พบใบในเงื่อนไขนี้
                    </p>
                  </td>
                </tr>
              )}
              {props.rows.map((t) => {
                const sla = slaStatusFor(t);
                const cost = totalTicketCost(t);
                return (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer"
                    onClick={() => router.push(`/repairs/triage?selected=${t.id}`)}
                  >
                    <Td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" />
                    </Td>
                    <Td className="font-mono font-bold text-zinc-700">{t.ticketCode}</Td>
                    <Td className="max-w-[320px]">
                      <span className="font-semibold text-zinc-900 truncate block">
                        {t.title}
                      </span>
                    </Td>
                    <Td>
                      {t.branch ? (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono font-bold text-zinc-700 shrink-0">
                            {t.branch.code}
                          </span>
                          <span className="text-zinc-600 truncate">{t.branch.name}</span>
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </Td>
                    <Td>
                      {t.category ? (
                        <span className="inline-flex items-center gap-1 text-zinc-700">
                          {t.category.emoji && <span>{t.category.emoji}</span>}
                          {t.category.label.split("/")[0]}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </Td>
                    <Td>
                      <span
                        className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-px rounded border ${STATUS_COLORS[t.status]}`}
                      >
                        <span className={`size-1.5 rounded-full ${STATUS_DOT[t.status]}`} />
                        {STATUS_LABELS[t.status]}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-px rounded border ${URGENCY_COLORS[t.urgency]}`}
                      >
                        <span className={`size-1.5 rounded-full ${URGENCY_DOT[t.urgency]}`} />
                        {URGENCY_LABELS[t.urgency]}
                      </span>
                    </Td>
                    <Td>
                      {t.assignedTech ? (
                        <span className="flex items-center gap-1.5">
                          <span
                            className="size-5 rounded-full grid place-items-center text-white text-[9px] font-bold"
                            style={{ background: techColor(t.assignedTech.id) }}
                          >
                            {t.assignedTech.name.charAt(0)}
                          </span>
                          <span>{t.assignedTech.name}</span>
                        </span>
                      ) : (
                        <span className="text-zinc-400 italic">—</span>
                      )}
                    </Td>
                    <Td>
                      {sla !== "done" ? (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-px rounded border ${slaBadgeColor(sla)}`}
                        >
                          {slaBadgeLabel(sla, t.resolveDueAt)}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </Td>
                    <Td align="right" className="tabular-nums text-zinc-600">
                      {ageHours(t.createdAt)}
                    </Td>
                    <Td align="right" className="tabular-nums font-semibold">
                      {cost > 0 ? (
                        <span className="text-zinc-900">{formatBaht(cost)}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="size-7 grid place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`sticky top-0 bg-zinc-50 border-b border-zinc-200 px-3 py-2 text-[10.5px] font-bold text-zinc-500 uppercase tracking-wide ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className = "",
  onClick,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td
      onClick={onClick}
      className={`px-3 py-2 align-middle ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </td>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 h-6 px-1.5 rounded border text-[11px] font-medium transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
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
