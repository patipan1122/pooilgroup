// Exec home leaderboard — re-skin of /chairops/dashboard/branches-table for
// the (office) home (W1 · claude-design).
//
// Differs from BranchesTable:
//   • Server component (no client sort/filter — leaderboard is short)
//   • Top-N pre-sorted by shortage desc (caller decides N)
//   • Each row clicks through to /chairops/reconcile/[branchId] (not /dashboard/[slug])
//   • Uses ShortageDriftCell kit primitive for the drift column
//   • Sticky thead solid bg per [[sticky-bg-inherit-anti-pattern]]
//
// Empty + zero-shortage states both render explicit "everything green" copy.

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { ShortageDriftCell } from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import { baht, thaiRelative } from "@/lib/chairops/utils/format";
import type { getDashboardRows } from "@/lib/chairops/reconcile/drift-engine";

type Row = Awaited<ReturnType<typeof getDashboardRows>>[number];

function classifyRow(r: Row): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  rowClass: string;
} {
  if (r.daysSinceLastCollection > 1) {
    return {
      label: "ไม่ส่งยอด",
      tone: "danger",
      rowClass: "bg-rose-50/40 hover:bg-rose-50",
    };
  }
  if (r.driftAmount > 0 && r.driftHours >= 24) {
    return {
      label: "shortage",
      tone: "danger",
      rowClass: "bg-rose-50/40 hover:bg-rose-50",
    };
  }
  if (r.driftAmount > 0) {
    return {
      label: "ค้าง <24 ชม.",
      tone: "warning",
      rowClass: "bg-amber-50/40 hover:bg-amber-50",
    };
  }
  return {
    label: "OK",
    tone: "success",
    rowClass: "bg-background hover:bg-muted/50",
  };
}

export function BranchesLeaderboard({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
        ยังไม่มีข้อมูลสาขา · ตรวจสอบ ChairopsBranch หรือลอง Recompute drift
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-muted/60">
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">
                สาขา
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">
                POS รวม
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">
                ฝากรวม
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">
                DRIFT
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                เก็บล่าสุด
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                สถานะ
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const cls = classifyRow(r);
              return (
                <tr
                  key={r.branchId}
                  className={cn(
                    "transition-colors",
                    cls.rowClass,
                  )}
                >
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/chairops/reconcile/${r.branchId}`}
                      className="block font-medium text-foreground hover:underline"
                    >
                      {r.branchName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[r.mallGroup, r.floor].filter(Boolean).join(" · ") ||
                        "—"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-foreground tabular-nums">
                    {baht(r.posTotal)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-foreground tabular-nums">
                    {baht(r.depositTotal)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ShortageDriftCell
                      // drift-engine: positive = shortage · cell convention: negative = shortage
                      amount={-r.driftAmount}
                      ageHours={r.driftHours}
                      cumulativeDays={Math.floor(r.driftHours / 24)}
                      compact
                      className="justify-end"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {r.lastCollectionAt ? (
                      thaiRelative(r.lastCollectionAt)
                    ) : (
                      <span className="font-semibold text-rose-600">
                        ไม่เคยเก็บ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill tone={cls.tone} size="xs" dot>
                      {cls.label}
                    </StatusPill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
