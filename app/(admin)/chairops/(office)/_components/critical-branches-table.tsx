// Critical branches table (Dashboard LEFT card) · mockup `dashboard.jsx` table.
// Client island: rows navigate to reconcile detail · timeframe chip toggle.
//
// Columns: status dot | branch + maid | POS วันนี้ | ฝาก | DRIFT | เก็บล่าสุด | 7d | →
// Sorted by drift desc (computed server-side · top 8).
//
// DRIFT display convention: drift-engine positive = shortage → shown as a red
// NEGATIVE signed value to match the mockup ("−2,840 ฿"). Surplus (drift < 0)
// shows muted/green. Matches mockup `co-drift` coloring exactly.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Sparkbar, StatusDot } from "@/components/chairops/_kit";
import { baht, thaiRelative } from "@/lib/chairops/utils/format";
import type { CriticalBranchRow } from "@/lib/chairops/queries/exec-home";

const STATUS_DOT_TONE = {
  ok: "ok",
  warn: "warn",
  critical: "critical",
  missed: "critical",
} as const;

function driftClass(drift: number): "crit" | "warn" | "ok" | "muted" {
  // drift > 0 = shortage. Mockup thresholds (sign-flipped to our convention):
  if (drift > 1000) return "crit";
  if (drift > 100) return "warn";
  if (drift < 0) return "ok"; // surplus
  return "muted";
}

const DRIFT_TEXT = {
  crit: "text-rose-600 font-medium",
  warn: "text-amber-600 font-medium",
  ok: "text-emerald-600 font-medium",
  muted: "text-zinc-400",
} as const;

const SPARK_TONE = {
  crit: "critical",
  warn: "warn",
  ok: "neutral",
  muted: "neutral",
} as const;

export function CriticalBranchesTable({ rows }: { rows: CriticalBranchRow[] }) {
  const router = useRouter();
  const [timeframe, setTimeframe] = useState<"7d" | "today">("today");

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {/* card head */}
      <div className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900">
            สาขาที่ต้องดูก่อน
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            เรียงตาม drift × วันที่ค้าง — คลิกแถวเพื่อดู timeline
          </div>
        </div>
        <div className="inline-flex gap-1">
          <button
            type="button"
            onClick={() => setTimeframe("7d")}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100",
              timeframe === "7d" && "bg-zinc-100 text-zinc-900",
            )}
          >
            7 วัน
          </button>
          <button
            type="button"
            onClick={() => setTimeframe("today")}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100",
              timeframe === "today" && "bg-zinc-100 text-zinc-900",
            )}
          >
            วันนี้
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 pb-5 pt-2 text-center text-sm text-zinc-500">
          ไม่มีสาขาที่ต้องดู · ทุกสาขาราบรื่น
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead className="sticky top-14 z-20 bg-zinc-50 sm:top-16">
              <tr className="border-y border-zinc-200 text-left text-xs text-zinc-500">
                <th className="w-6 px-2 py-2" />
                <th className="px-3 py-2 font-medium">สาขา</th>
                <th className="px-3 py-2 text-right font-medium">POS วันนี้</th>
                <th className="px-3 py-2 text-right font-medium">ฝาก</th>
                <th className="px-3 py-2 text-right font-medium">DRIFT</th>
                <th className="px-3 py-2 font-medium">เก็บล่าสุด</th>
                <th className="px-3 py-2 font-medium">7d</th>
                <th className="w-6 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((b) => {
                const dc = driftClass(b.drift);
                // shortage (drift>0) renders as a negative signed value per mockup
                const display = b.drift > 0 ? -b.drift : Math.abs(b.drift);
                return (
                  <tr
                    key={b.branchId}
                    onClick={() =>
                      router.push(`/chairops/reconcile/${b.branchId}`)
                    }
                    className="cursor-pointer transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-2 py-2.5">
                      <StatusDot tone={STATUS_DOT_TONE[b.status]} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="max-w-[200px] truncate font-medium text-zinc-900">
                          {b.branchName}
                        </span>
                        {b.maidName && (
                          <span className="shrink-0 text-[11px] text-zinc-500">
                            · {b.maidName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-700">
                      {baht(b.posToday)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {b.depositToday === 0 ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <span className="text-zinc-700">
                          {baht(b.depositToday)}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-2.5 text-right tabular-nums",
                        DRIFT_TEXT[dc],
                      )}
                    >
                      {display > 0 ? "+" : display < 0 ? "−" : ""}
                      {Math.abs(display).toLocaleString("en-US")} ฿
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {b.lastCollectionAt ? (
                        <span className="text-xs text-zinc-600">
                          {thaiRelative(b.lastCollectionAt)}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-medium text-rose-600 ring-1 ring-rose-200">
                          ไม่เคยเก็บ
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Sparkbar series={b.posSeries} tone={SPARK_TONE[dc]} />
                    </td>
                    <td className="px-2 py-2.5">
                      <ChevronRight
                        className="size-3.5 text-zinc-400"
                        aria-hidden="true"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* card foot */}
      <div className="border-t border-zinc-100 px-4 py-2.5">
        <a
          href="/chairops/reconcile"
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
        >
          ดู 30 สาขาทั้งหมด <ChevronRight className="size-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
