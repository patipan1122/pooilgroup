// All-branches P&L table (CEO ask 2026-05-28 · "ดูทุกสาขาพร้อมกัน").
//
// Server Component · no client JS. Sorting is URL-driven (header links toggle
// `?sort=`), so the page stays a pure RSC and survives the IDE buffer-revert
// trap ([[pooil-tracked-file-revert-and-prod-db-block]]).
//
// Columns: สาขา · ยอดขายรวม · เงินสด · เงินโอน · ฝากแม่บ้าน · DRIFT ·
//          [admin] ค่าใช้จ่าย (+ค่าเช่า sub-line) · [admin] กำไร/ขาดทุนสุทธิ · สถานะ
//
// Cost/profit columns render ONLY when `showCost` (admin-tier). Managers see
// revenue + drift only. Sorted server-side; default = worst profit first
// (CEO watches losses).

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { StatusDot } from "@/components/chairops/_kit";
import { baht } from "@/lib/chairops/utils/format";
import { resolveMall } from "@/lib/chairops/utils/mall-groups";
import type { BranchPLRow } from "@/lib/chairops/queries/dashboard-pl";

export type PLSort =
  | "profit"
  | "profit_desc"
  | "revenue"
  | "drift"
  | "deposit"
  | "name";

const SORT_LABELS: { key: PLSort; label: string; adminOnly?: boolean }[] = [
  { key: "profit", label: "ขาดทุนมากสุด", adminOnly: true },
  { key: "profit_desc", label: "กำไรมากสุด", adminOnly: true },
  { key: "revenue", label: "ยอดขายสูงสุด" },
  { key: "drift", label: "DRIFT มากสุด" },
  { key: "deposit", label: "ฝากมากสุด" },
  { key: "name", label: "ชื่อสาขา" },
];

export function sortBranchPL(rows: BranchPLRow[], sort: PLSort): BranchPLRow[] {
  const out = [...rows];
  switch (sort) {
    case "profit": // worst (most negative net) first — CEO default
      out.sort((a, b) => a.net - b.net);
      break;
    case "profit_desc":
      out.sort((a, b) => b.net - a.net);
      break;
    case "revenue":
      out.sort((a, b) => b.revenue - a.revenue);
      break;
    case "drift":
      out.sort((a, b) => b.drift - a.drift);
      break;
    case "deposit":
      out.sort((a, b) => b.deposit - a.deposit);
      break;
    case "name":
      out.sort((a, b) => a.name.localeCompare(b.name, "th"));
      break;
  }
  return out;
}

function statusTone(row: BranchPLRow): {
  tone: "ok" | "warn" | "critical";
  label: string;
} {
  if (row.drift > 1000) return { tone: "critical", label: "วิกฤต" };
  if (row.drift > 100) return { tone: "warn", label: "เฝ้าดู" };
  return { tone: "ok", label: "ปกติ" };
}

/** Build a querystring that keeps the date range but swaps the sort. */
function sortHref(
  search: { from: string; to: string },
  sort: PLSort,
): string {
  const p = new URLSearchParams({
    from: search.from,
    to: search.to,
    sort,
  });
  return `?${p.toString()}#all-branches`;
}

export interface AllBranchesPLTableProps {
  rows: BranchPLRow[];
  /** day count of the selected range (cost pro-ration base for the sub-line). */
  dayCount: number;
  totals: {
    revenue: number;
    cash: number;
    online: number;
    deposit: number;
    drift: number;
    cost: number;
    rentCost: number;
    net: number;
  };
  /** admin-tier → show cost + profit columns. */
  showCost: boolean;
  sort: PLSort;
  search: { from: string; to: string };
  rangeLabel: string;
}

export function AllBranchesPLTable({
  rows,
  dayCount,
  totals,
  showCost,
  sort,
  search,
  rangeLabel,
}: AllBranchesPLTableProps) {
  return (
    <section
      id="all-branches"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm scroll-mt-20"
    >
      {/* card head */}
      <div className="flex flex-col gap-2 px-4 pb-2.5 pt-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900">
            ทุกสาขา · กำไร/ขาดทุน
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {rangeLabel} · {rows.length.toLocaleString("th-TH")} สาขา ·{" "}
            {showCost
              ? `ค่าใช้จ่ายเฉลี่ย ${dayCount} วัน (คิดจากต้นทุนรายเดือน ÷ 30)`
              : "ยอดขาย + drift (ต้นทุนเฉพาะผู้บริหาร)"}
          </div>
        </div>
        {/* sort chips (URL links · no client JS) */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[11px] text-zinc-400">เรียง:</span>
          {SORT_LABELS.filter((s) => showCost || !s.adminOnly).map((s) => (
            <Link
              key={s.key}
              href={sortHref(search, s.key)}
              scroll={false}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100",
                sort === s.key && "bg-zinc-900 text-white hover:bg-zinc-900",
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 pb-5 pt-2 text-center text-sm text-zinc-500">
          ไม่มีสาขาทำการในช่วงนี้
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="sticky top-14 z-20 bg-zinc-50 sm:top-16">
              <tr className="border-y border-zinc-200 text-left text-xs text-zinc-500">
                <th className="w-6 px-2 py-2" />
                <th className="px-3 py-2 font-medium">สาขา</th>
                <th className="px-3 py-2 text-right font-medium">ยอดขายรวม</th>
                <th className="px-3 py-2 text-right font-medium">เงินสด</th>
                <th className="px-3 py-2 text-right font-medium">เงินโอน</th>
                <th className="px-3 py-2 text-right font-medium">ฝากแม่บ้าน</th>
                <th className="px-3 py-2 text-right font-medium">DRIFT</th>
                {showCost && (
                  <>
                    <th className="px-3 py-2 text-right font-medium">
                      ค่าใช้จ่าย
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      กำไร/ขาดทุนสุทธิ
                    </th>
                  </>
                )}
                <th className="px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((b) => {
                const mall = resolveMall(b.mallGroup);
                const st = statusTone(b);
                // shortage (drift>0) shown as red negative · matches dashboard.
                const driftDisplay = b.drift > 0 ? -b.drift : Math.abs(b.drift);
                const driftClass =
                  b.drift > 1000
                    ? "text-rose-600 font-medium"
                    : b.drift > 100
                      ? "text-amber-600 font-medium"
                      : b.drift < 0
                        ? "text-emerald-600 font-medium"
                        : "text-zinc-400";
                const isLoss = b.net < 0;
                return (
                  <tr
                    key={b.branchId}
                    className="transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-2 py-2.5">
                      <StatusDot tone={st.tone} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/chairops/branches/${b.branchSlug}`}
                        className="flex min-w-0 items-center gap-1.5 hover:underline"
                      >
                        <span className="max-w-[220px] truncate font-medium text-zinc-900">
                          {b.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-zinc-400">
                          · {mall.label}
                        </span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-medium text-zinc-900">
                      {b.revenue === 0 ? (
                        <span className="font-normal text-zinc-400">—</span>
                      ) : (
                        baht(b.revenue)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600">
                      {b.cash === 0 ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        baht(b.cash)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600">
                      {b.online === 0 ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        baht(b.online)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600">
                      {b.deposit === 0 ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        baht(b.deposit)
                      )}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-2.5 text-right tabular-nums",
                        driftClass,
                      )}
                    >
                      {driftDisplay > 0 ? "+" : driftDisplay < 0 ? "−" : ""}
                      {Math.abs(driftDisplay).toLocaleString("en-US")} ฿
                    </td>
                    {showCost && (
                      <>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600">
                          <span
                            title={`ค่าเช่า ${baht(b.rentCost)} (จากต้นทุนรวม ${baht(
                              b.cost,
                            )} · เฉลี่ย ${dayCount} วัน)`}
                            className="cursor-help"
                          >
                            {b.cost === 0 ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              baht(b.cost)
                            )}
                          </span>
                          {b.rentCost > 0 && (
                            <div className="text-[10.5px] font-normal text-zinc-400">
                              ค่าเช่า {baht(b.rentCost)}
                            </div>
                          )}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold",
                            isLoss ? "text-rose-600" : "text-emerald-600",
                          )}
                        >
                          {isLoss ? "−" : "+"}
                          {Math.abs(b.net).toLocaleString("en-US")} ฿
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                          st.tone === "critical" &&
                            "bg-rose-50 text-rose-600 ring-rose-200",
                          st.tone === "warn" &&
                            "bg-amber-50 text-amber-600 ring-amber-200",
                          st.tone === "ok" &&
                            "bg-emerald-50 text-emerald-600 ring-emerald-200",
                        )}
                      >
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* totals row */}
            <tfoot>
              <tr className="border-t-2 border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700">
                <td className="px-2 py-2.5" />
                <td className="px-3 py-2.5">รวมทุกสาขา</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  {baht(totals.revenue)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  {baht(totals.cash)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  {baht(totals.online)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  {baht(totals.deposit)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-rose-600">
                  {totals.drift > 0
                    ? `−${totals.drift.toLocaleString("en-US")} ฿`
                    : "0 ฿"}
                </td>
                {showCost && (
                  <>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {baht(totals.cost)}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-2.5 text-right tabular-nums",
                        totals.net < 0 ? "text-rose-600" : "text-emerald-600",
                      )}
                    >
                      {totals.net < 0 ? "−" : "+"}
                      {Math.abs(totals.net).toLocaleString("en-US")} ฿
                    </td>
                  </>
                )}
                <td className="px-3 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* card foot */}
      <div className="border-t border-zinc-100 px-4 py-2.5">
        <Link
          href="/chairops/branches"
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
        >
          เปิด workspace สาขา (3-pane)
          <ChevronRight className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
