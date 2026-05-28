"use client";

// Timeline tab — chronological feed of recent reports
// (submitted / approved / rejected events).
// Reuses data shape from /cashhub/reports but renders compact.

import Link from "next/link";
import { Check, Clock, X as XIcon, Banknote } from "lucide-react";

export interface TimelineEntry {
  id: string;
  date: string;
  branchCode: string;
  branchName: string;
  amount: number;
  status: "approved" | "submitted" | "rejected";
  submittedAt: string | null;
  staffName: string | null;
}

const STATUS_ICONS = {
  approved: { Icon: Check, color: "var(--ch-ok)", bg: "var(--ch-ok-soft)", label: "อนุมัติ" },
  submitted: { Icon: Clock, color: "#a16207", bg: "var(--ch-pending-soft)", label: "รออนุมัติ" },
  rejected: { Icon: XIcon, color: "var(--ch-danger)", bg: "var(--ch-danger-soft)", label: "ปฏิเสธ" },
} as const;

function formatBaht(n: number) {
  return "฿" + Math.round(n).toLocaleString("en-US");
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TimelineTab({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="ch-card-v2 bg-white p-8 text-center text-[var(--ch-text-3)] mt-5">
        ยังไม่มีรายงานในช่วงนี้
      </div>
    );
  }
  return (
    <div className="ch-card-v2 bg-white overflow-hidden mt-5">
      <ul className="divide-y divide-[var(--ch-border)]">
        {entries.map((e) => {
          const m = STATUS_ICONS[e.status];
          const { Icon } = m;
          return (
            <li key={e.id}>
              <Link
                href={`/cashhub/reports/${e.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--ch-bg-2)] transition-colors"
              >
                <div
                  className="size-9 rounded-lg shrink-0 grid place-items-center"
                  style={{ background: m.bg, color: m.color }}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">
                    {e.branchCode}
                    <span className="text-[var(--ch-text-3)] font-normal ml-1.5">
                      {e.branchName}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--ch-text-3)] mt-0.5">
                    {m.label}
                    {e.staffName ? ` · ${e.staffName}` : ""} ·{" "}
                    {formatTime(e.submittedAt)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="ch-tnum text-sm font-bold text-[var(--ch-text)] flex items-center gap-1 justify-end">
                    <Banknote className="size-3 text-[var(--ch-text-3)]" />
                    {formatBaht(e.amount)}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
