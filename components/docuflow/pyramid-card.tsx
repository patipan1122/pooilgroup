// DocuFlow — pyramid drill-down card
// Renders one tile in the drill grid (company / business type / branch).
// Click → navigate one level deeper via the href in the AggregateNode.

import Link from "next/link";
import { ArrowUpRight, AlertTriangle, Clock, FileQuestion } from "lucide-react";
import type { AggregateNode } from "@/lib/docuflow/aggregations";

export function PyramidCard({ node }: { node: AggregateNode }) {
  const { stats } = node;
  const hasWarn = stats.expired + stats.critical > 0;
  const hasWatch = stats.watch > 0;

  return (
    <Link
      href={node.href}
      className="group relative rounded-2xl border-2 border-zinc-200 bg-white p-5 hover:border-[var(--color-brand-400)] hover:shadow-soft transition-all overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute -top-10 -right-10 size-32 rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="size-11 rounded-xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] flex items-center justify-center text-xl shrink-0">
            {node.emoji ?? "📁"}
          </div>
          <ArrowUpRight className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-600)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all mt-1" />
        </div>

        <h3 className="font-bold text-zinc-900 truncate text-base">
          {node.label}
        </h3>
        {node.sublabel && (
          <p className="text-xs text-zinc-500 truncate mt-0.5">
            {node.sublabel}
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-zinc-100">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold tabular-nums tracking-tight">
              {stats.total.toLocaleString("th-TH")}
            </span>
            <span className="text-xs text-zinc-500 font-medium">เอกสาร</span>
          </div>

          {stats.total > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {stats.expired > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
                  <AlertTriangle className="size-3" />
                  หมดแล้ว {stats.expired}
                </span>
              )}
              {stats.critical > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
                  <Clock className="size-3" />
                  วิกฤต {stats.critical}
                </span>
              )}
              {stats.watch > 0 && !hasWarn && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-yellow-50 border border-yellow-200 text-yellow-800 text-[11px] font-bold">
                  <Clock className="size-3" />
                  เฝ้าระวัง {stats.watch}
                </span>
              )}
              {!hasWarn && !hasWatch && stats.noExpiry < stats.total && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
                  ปกติ
                </span>
              )}
              {stats.noExpiry > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-50 border border-zinc-200 text-zinc-600 text-[11px] font-medium">
                  <FileQuestion className="size-3" />
                  ไม่กำหนดอายุ {stats.noExpiry}
                </span>
              )}
            </div>
          )}

          {stats.total === 0 && (
            <p className="text-xs text-zinc-400 mt-2">ยังไม่มีเอกสาร</p>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Compact "totals strip" shown above a grid — sums across all child cards. */
export function TotalsStrip({
  total,
  expired,
  critical,
  watch,
  noExpiry,
}: {
  total: number;
  expired: number;
  critical: number;
  watch: number;
  noExpiry: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
      <Cell label="รวม" value={total} tone="brand" />
      <Cell label="หมดอายุ" value={expired} tone={expired > 0 ? "danger" : "muted"} />
      <Cell label="วิกฤต ≤30 วัน" value={critical} tone={critical > 0 ? "warning" : "muted"} />
      <Cell label="เฝ้าระวัง 31-90" value={watch} tone="muted" />
      <Cell label="ไม่กำหนดอายุ" value={noExpiry} tone="muted" />
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "brand" | "danger" | "warning" | "muted";
}) {
  const palette = {
    brand: "bg-[var(--color-brand-50)] border-[var(--color-brand-200)] text-[var(--color-brand-900)]",
    danger: "bg-rose-50 border-rose-200 text-rose-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    muted: "bg-zinc-50 border-zinc-200 text-zinc-700",
  }[tone];
  return (
    <div className={`rounded-xl border-2 p-3 ${palette}`}>
      <p className="text-[10px] uppercase tracking-[0.14em] font-bold opacity-70">
        {label}
      </p>
      <p className="text-2xl font-extrabold tabular-nums mt-1">
        {value.toLocaleString("th-TH")}
      </p>
    </div>
  );
}
