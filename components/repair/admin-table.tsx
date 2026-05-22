"use client";
// Pooil App · dense table view (.table-wrap .table-toolbar .dtable)

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Search,
  X,
  Filter,
  Download,
} from "lucide-react";
import {
  STATUS_LABELS,
  URGENCY_LABELS,
  formatBaht,
  totalTicketCost,
} from "@/lib/repair/types";
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";
import { slaStatusFor, slaBadgeLabel } from "@/lib/repair/sla";

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

interface BranchOpt { id: string; code: string; name: string }
interface CatOpt { id: string; label: string; emoji: string | null }

interface Props {
  rows: Row[];
  total: number;
  currentStatus: RepairTicketStatus | null;
  currentUrgency: RepairUrgency | null;
  currentQuery: string;
  statusCounts: Record<RepairTicketStatus, number>;
  branches?: BranchOpt[];
  categories?: CatOpt[];
  currentBranch?: string | null;
  currentCategory?: string | null;
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
const URGENCY_DOT: Record<RepairUrgency, string> = {
  URGENT: "var(--p-urgent)",
  NORMAL: "var(--p-normal)",
  LOW: "var(--p-low)",
};

export function AdminTable(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [query, setQuery] = useState(props.currentQuery);
  const [filterOpen, setFilterOpen] = useState(false);

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

  function exportCsv() {
    const headers = [
      "ticketCode", "title", "status", "urgency",
      "branchCode", "branchName", "category",
      "assignedTech", "createdAt", "resolveDueAt",
      "totalCostTHB",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = props.rows.map((t) => [
      t.ticketCode,
      t.title,
      STATUS_LABELS[t.status],
      URGENCY_LABELS[t.urgency],
      t.branch?.code ?? "",
      t.branch?.name ?? "",
      t.category?.label ?? "",
      t.assignedTech?.name ?? "",
      new Date(t.createdAt).toISOString(),
      t.resolveDueAt ? new Date(t.resolveDueAt).toISOString() : "",
      ((t.partsCostCents + t.laborCostCents) / 100).toFixed(2),
    ]);
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    // BOM so Excel reads Thai correctly
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pooil-repairs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    <div className="repair-content">
      <div className="table-wrap">
        {/* Toolbar */}
        <div className="table-toolbar">
          <form onSubmit={submitSearch} className="table-search">
            <Search size={13} style={{ color: "var(--ink-400)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นเลขที่ใบ · หัวเรื่อง · สาขา · ผู้แจ้ง"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); setParam("q", null); }}
                style={{
                  width: 18, height: 18, borderRadius: 4, border: 0,
                  background: "transparent", display: "grid", placeItems: "center",
                  color: "var(--ink-400)", cursor: "pointer",
                }}
              >
                <X size={11} />
              </button>
            )}
          </form>

          <span style={{ fontSize: 11, color: "var(--ink-500)" }}>สถานะ:</span>
          <button
            type="button"
            className={"table-filter " + (props.currentStatus === null ? "is-active" : "")}
            onClick={() => setParam("status", null)}
          >
            ทั้งหมด
          </button>
          {(["NEW","ACK","IN_PROGRESS","WAITING_PARTS","RESOLVED","CLOSED"] as RepairTicketStatus[]).map((s) => (
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
          {(["URGENT","NORMAL","LOW"] as RepairUrgency[]).map((u) => (
            <button
              key={u}
              type="button"
              className={"table-filter " + (props.currentUrgency === u ? "is-active" : "")}
              onClick={() => setParam("urgency", u)}
            >
              <span className="step-dot" style={{ background: URGENCY_DOT[u] }} />
              {URGENCY_LABELS[u]}
            </button>
          ))}

          <span style={{ flex: 1 }} />
          <span className="num" style={{ fontSize: 11.5, color: "var(--ink-500)" }}>
            {props.rows.length} / {props.total} ใบ
          </span>
          {props.branches && props.categories && (
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              className={"btn btn-sm " + (filterOpen ? "btn-primary" : "btn-ghost")}
            >
              <Filter /> Filter
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={exportCsv}>
            <Download /> Export
          </button>
        </div>

        {/* Advanced filter row */}
        {filterOpen && props.branches && props.categories && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8,
            padding: "10px 12px",
            borderBottom: "1px solid var(--line-2)",
            background: "var(--surface)",
            fontSize: 12,
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--ink-600)" }}>
              <span style={{ fontWeight: 600 }}>สาขา:</span>
              <select
                value={props.currentBranch ?? ""}
                onChange={(e) => setParam("branch", e.target.value || null)}
                style={{
                  height: 28, padding: "0 8px",
                  border: "1px solid var(--line)", borderRadius: 6,
                  background: "var(--surface)", outline: 0,
                  fontFamily: "inherit", fontSize: 12,
                }}
              >
                <option value="">ทุกสาขา</option>
                {props.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--ink-600)" }}>
              <span style={{ fontWeight: 600 }}>หมวด:</span>
              <select
                value={props.currentCategory ?? ""}
                onChange={(e) => setParam("category", e.target.value || null)}
                style={{
                  height: 28, padding: "0 8px",
                  border: "1px solid var(--line)", borderRadius: 6,
                  background: "var(--surface)", outline: 0,
                  fontFamily: "inherit", fontSize: 12,
                }}
              >
                <option value="">ทุกหมวด</option>
                {props.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji ?? ""} {c.label}
                  </option>
                ))}
              </select>
            </label>
            {(props.currentBranch || props.currentCategory) && (
              <button
                type="button"
                className="table-filter"
                onClick={() => {
                  const next = new URLSearchParams(sp.toString());
                  next.delete("branch");
                  next.delete("category");
                  router.push(`/repairs/table?${next.toString()}`);
                }}
              >
                <X size={11} /> ล้าง
              </button>
            )}
          </div>
        )}

        <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 320px)" }}>
          <table className="dtable">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>หัวเรื่อง</th>
                <th>สาขา</th>
                <th>หมวด</th>
                <th>สถานะ</th>
                <th>ระดับ</th>
                <th>ช่าง</th>
                <th>SLA</th>
                <th className="num">อายุ</th>
                <th className="num">ค่าใช้จ่าย</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}>
                    <Search size={24} style={{ color: "var(--ink-300)", marginBottom: 6 }} />
                    <div>ไม่พบใบในเงื่อนไขนี้</div>
                  </td>
                </tr>
              )}
              {props.rows.map((t) => {
                const sla = slaStatusFor(t);
                const cost = totalTicketCost(t);
                return (
                  <tr
                    key={t.id}
                    onClick={() => router.push(`/repairs/triage?selected=${t.id}`)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="ticket-id">{t.ticketCode}</td>
                    <td className="ticket-title">{t.title}</td>
                    <td>
                      {t.branch ? (
                        <>
                          <span className="num" style={{ fontWeight: 600, color: "var(--ink-700)", marginRight: 6 }}>
                            {t.branch.code}
                          </span>
                          <span style={{ color: "var(--ink-600)" }}>{t.branch.name}</span>
                        </>
                      ) : (
                        <span style={{ color: "var(--ink-400)" }}>—</span>
                      )}
                    </td>
                    <td>
                      {t.category ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--ink-700)" }}>
                          {t.category.emoji && <span>{t.category.emoji}</span>}
                          {t.category.label.split("/")[0]}
                        </span>
                      ) : (
                        <span style={{ color: "var(--ink-400)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={"pill " + STATUS_CLS[t.status]}>
                        <span className="dot" />
                        {STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td>
                      <span className={
                        "pill " +
                        (t.urgency === "URGENT" ? "pill-urgent" :
                         t.urgency === "NORMAL" ? "pill-normal" : "pill-low")
                      }>
                        <span className="dot" />
                        {URGENCY_LABELS[t.urgency]}
                      </span>
                    </td>
                    <td>
                      {t.assignedTech ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span className="tech-chip" style={{
                            width: 18, height: 18, fontSize: 9,
                            background: techColor(t.assignedTech.id),
                          }}>
                            {t.assignedTech.name.charAt(0)}
                          </span>
                          <span>{t.assignedTech.name}</span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--ink-400)", fontStyle: "italic" }}>—</span>
                      )}
                    </td>
                    <td>
                      {sla !== "done" ? (
                        <span className={"sla " + sla}>
                          {slaBadgeLabel(sla, t.resolveDueAt)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--ink-400)" }}>—</span>
                      )}
                    </td>
                    <td className="num" style={{ color: "var(--ink-600)" }}>
                      {ageHours(t.createdAt)}
                    </td>
                    <td className="num">
                      {cost > 0 ? (
                        <span style={{ color: "var(--ink-900)", fontWeight: 600 }}>
                          {formatBaht(cost)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--ink-400)" }}>—</span>
                      )}
                    </td>
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

function techColor(id: string): string {
  const palette = [
    "#2563EB", "#7C3AED", "#DB2777", "#059669",
    "#EA580C", "#0891B2", "#CA8A04", "#475569",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

