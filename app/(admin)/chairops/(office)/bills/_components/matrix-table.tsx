"use client";

// Bills matrix table · client side so rows can expand into per-category detail
// without a full reload. Data comes pre-buckedded from the server (single
// query · no N+1 · see lib/chairops/queries/vendor-bills.ts).

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { baht } from "@/lib/chairops/utils/format";

export interface MatrixCellPayload {
  total: number;
  paidTotal: number;
  pendingTotal: number;
  overdueTotal: number;
  worstStatus: "PAID" | "PENDING" | "OVERDUE" | null;
  bills: Array<{
    id: string;
    categoryId: string;
    categoryLabel: string;
    amount: number;
    status: "PAID" | "PENDING" | "OVERDUE";
  }>;
}

export interface MatrixMonth {
  monthKey: string;
  label: string; // "พ.ค. 26"
}

export interface MatrixRow {
  branchId: string;
  branchName: string;
  rowTotal: number;
  cells: Record<string, MatrixCellPayload>; // keyed by monthKey
}

interface Props {
  rows: MatrixRow[];
  months: MatrixMonth[];
  totalsByMonth: Record<string, number>;
  grandTotal: number;
  /** Whether the viewer may click cells to open the editor. */
  canEdit: boolean;
}

const STATUS_CHIP: Record<
  "PAID" | "PENDING" | "OVERDUE",
  { dot: string; tone: string }
> = {
  PAID: { dot: "bg-emerald-500", tone: "text-emerald-700" },
  PENDING: { dot: "bg-amber-500", tone: "text-amber-700" },
  OVERDUE: { dot: "bg-rose-500", tone: "text-rose-700" },
};

function cellBg(status: "PAID" | "PENDING" | "OVERDUE" | null): string {
  if (status === null) return "bg-zinc-50/40";
  if (status === "PAID") return "bg-emerald-50/60";
  if (status === "PENDING") return "bg-amber-50/60";
  return "bg-rose-50/60";
}

export function BillsMatrixTable({
  rows,
  months,
  totalsByMonth,
  grandTotal,
  canEdit,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleBranch = (branchId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  // For each expanded branch, collect the union of categoryIds across all
  // visible months (so the sub-rows stay aligned column-by-column).
  const subRowsByBranch = useMemo(() => {
    const map = new Map<
      string,
      Array<{ categoryId: string; categoryLabel: string }>
    >();
    for (const row of rows) {
      if (!expanded.has(row.branchId)) continue;
      const seen = new Map<string, string>();
      for (const month of months) {
        const cell = row.cells[month.monthKey];
        if (!cell) continue;
        for (const bill of cell.bills) {
          if (!seen.has(bill.categoryId)) {
            seen.set(bill.categoryId, bill.categoryLabel);
          }
        }
      }
      map.set(
        row.branchId,
        Array.from(seen.entries()).map(([categoryId, categoryLabel]) => ({
          categoryId,
          categoryLabel,
        })),
      );
    }
    return map;
  }, [rows, months, expanded]);

  return (
    <div className="relative overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-50/95 backdrop-blur">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 min-w-[160px] border-b border-r border-zinc-200 bg-zinc-50/95 px-3 py-2 text-left text-xs font-semibold text-zinc-600"
            >
              สาขา
            </th>
            {months.map((m) => (
              <th
                key={m.monthKey}
                scope="col"
                className="border-b border-zinc-200 px-3 py-2 text-right text-xs font-semibold text-zinc-600"
              >
                {m.label}
              </th>
            ))}
            <th
              scope="col"
              className="border-b border-l border-zinc-200 bg-zinc-100/80 px-3 py-2 text-right text-xs font-semibold text-zinc-700"
            >
              รวม
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={months.length + 2}
                className="px-4 py-8 text-center text-sm text-zinc-500"
              >
                ยังไม่มีบิลในช่วงเวลานี้
              </td>
            </tr>
          ) : (
            rows.flatMap((row) => {
              const isOpen = expanded.has(row.branchId);
              const subRows = subRowsByBranch.get(row.branchId) ?? [];
              return [
                <tr key={row.branchId} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 min-w-[160px] border-b border-r border-zinc-200 bg-white px-3 py-2 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => toggleBranch(row.branchId)}
                      className="inline-flex items-center gap-1.5 text-left text-sm font-medium text-zinc-800 hover:text-zinc-950"
                      aria-expanded={isOpen}
                      aria-controls={`sub-${row.branchId}`}
                    >
                      <ChevronRight
                        className={cn(
                          "size-4 text-zinc-400 transition-transform",
                          isOpen && "rotate-90 text-zinc-600",
                        )}
                        aria-hidden="true"
                      />
                      {row.branchName}
                    </button>
                  </th>
                  {months.map((m) => {
                    const cell = row.cells[m.monthKey];
                    const status = cell?.worstStatus ?? null;
                    const tone = status
                      ? STATUS_CHIP[status].tone
                      : "text-zinc-400";
                    const content =
                      !cell || cell.total === 0 ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        <CellLink
                          monthKey={m.monthKey}
                          branchId={row.branchId}
                          canEdit={canEdit}
                          tone={tone}
                          status={status}
                          amount={cell.total}
                        />
                      );
                    return (
                      <td
                        key={m.monthKey}
                        className={cn(
                          "border-b border-zinc-100 px-3 py-2 text-right text-sm tabular-nums",
                          cellBg(status),
                        )}
                      >
                        {content}
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-zinc-200 bg-zinc-50/70 px-3 py-2 text-right text-sm font-semibold tabular-nums text-zinc-900">
                    {row.rowTotal === 0 ? (
                      <span className="text-zinc-300">—</span>
                    ) : (
                      baht(row.rowTotal)
                    )}
                  </td>
                </tr>,
                ...(isOpen
                  ? subRows.map((sub) => (
                      <tr
                        key={`${row.branchId}-${sub.categoryId}`}
                        id={`sub-${row.branchId}`}
                        className="bg-zinc-50/30"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-10 min-w-[160px] border-b border-r border-zinc-100 bg-zinc-50/30 px-3 py-1.5 text-left text-xs font-normal text-zinc-600"
                        >
                          <span className="pl-6">{sub.categoryLabel}</span>
                        </th>
                        {months.map((m) => {
                          const cell = row.cells[m.monthKey];
                          const bill = cell?.bills.find(
                            (b) => b.categoryId === sub.categoryId,
                          );
                          if (!bill) {
                            return (
                              <td
                                key={m.monthKey}
                                className="border-b border-zinc-100 px-3 py-1.5 text-right text-xs text-zinc-300"
                              >
                                —
                              </td>
                            );
                          }
                          const chip = STATUS_CHIP[bill.status];
                          return (
                            <td
                              key={m.monthKey}
                              className="border-b border-zinc-100 px-3 py-1.5 text-right text-xs tabular-nums"
                            >
                              {canEdit ? (
                                <Link
                                  href={`/chairops/bills/${bill.id}`}
                                  className={cn(
                                    "inline-flex items-center gap-1 hover:underline",
                                    chip.tone,
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "size-1.5 rounded-full",
                                      chip.dot,
                                    )}
                                  />
                                  {baht(bill.amount)}
                                </Link>
                              ) : (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1",
                                    chip.tone,
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "size-1.5 rounded-full",
                                      chip.dot,
                                    )}
                                  />
                                  {baht(bill.amount)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="border-b border-l border-zinc-100 bg-zinc-50/40 px-3 py-1.5 text-right text-xs text-zinc-500" />
                      </tr>
                    ))
                  : []),
              ];
            })
          )}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-100/80 font-semibold">
            <th
              scope="row"
              className="sticky left-0 z-10 min-w-[160px] border-t border-r border-zinc-200 bg-zinc-100/80 px-3 py-2 text-left text-sm"
            >
              รวมทุกสาขา
            </th>
            {months.map((m) => (
              <td
                key={m.monthKey}
                className="border-t border-zinc-200 px-3 py-2 text-right text-sm tabular-nums"
              >
                {totalsByMonth[m.monthKey]
                  ? baht(totalsByMonth[m.monthKey])
                  : "—"}
              </td>
            ))}
            <td className="border-t border-l border-zinc-200 bg-zinc-200/60 px-3 py-2 text-right text-sm tabular-nums">
              {grandTotal ? baht(grandTotal) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CellLink({
  monthKey,
  branchId,
  canEdit,
  tone,
  status,
  amount,
}: {
  monthKey: string;
  branchId: string;
  canEdit: boolean;
  tone: string;
  status: "PAID" | "PENDING" | "OVERDUE" | null;
  amount: number;
}) {
  const chip = status ? STATUS_CHIP[status] : null;
  const content = (
    <span className={cn("inline-flex items-center gap-1.5", tone)}>
      {chip ? (
        <span className={cn("size-1.5 rounded-full", chip.dot)} />
      ) : null}
      {baht(amount)}
    </span>
  );
  if (!canEdit) return content;
  // Deep-link to a filtered new-bill view (branch + month preselected · admins
  // can also click a sub-row category bill to edit specific rows).
  return (
    <Link
      href={`/chairops/bills?branch=${branchId}&month=${monthKey}`}
      className="hover:underline"
    >
      {content}
    </Link>
  );
}
