"use client";

// Bills matrix table · client side so rows can expand into per-category detail
// without a full reload. Data comes pre-buckedded from the server (single
// query · no N+1 · see lib/chairops/queries/vendor-bills.ts).

import { useCallback, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { baht } from "@/lib/chairops/utils/format";
import { BillWindow } from "./bill-window";

export interface MatrixCellPayload {
  total: number;
  paidTotal: number;
  pendingTotal: number;
  overdueTotal: number;
  worstStatus: "PAID" | "PENDING" | "OVERDUE" | null;
  /** UX-01 (2026-06-03) · true if any bill in the cell is ±20% off prior month. */
  isAnomalous: boolean;
  bills: Array<{
    id: string;
    categoryId: string;
    categoryLabel: string;
    amount: number;
    status: "PAID" | "PENDING" | "OVERDUE";
    isAnomalous: boolean;
    deltaPct: number | null;
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

  // CEO 2026-06-03 · clicking a bill opens a draggable, non-modal "pay" window.
  // Several can be open at once (compare bills) — track ids in order so we can
  // cascade their initial positions.
  const [openBills, setOpenBills] = useState<string[]>([]);
  const openBill = useCallback((id: string) => {
    setOpenBills((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const closeBill = useCallback((id: string) => {
    setOpenBills((prev) => prev.filter((b) => b !== id));
  }, []);

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

  // PERF-01 (2026-06-03) · pre-compute a (branchId|monthKey|categoryId) → bill
  // map so the inner sub-row render is O(1) instead of Array.find per cell.
  // Without this, 30 branches × 6 months × 11 categories = 1,980 .find calls
  // per re-render once all branches are expanded.
  const billByKey = useMemo(() => {
    const m = new Map<
      string,
      {
        id: string;
        amount: number;
        status: "PAID" | "PENDING" | "OVERDUE";
        isAnomalous: boolean;
        deltaPct: number | null;
      }
    >();
    for (const row of rows) {
      for (const month of months) {
        const cell = row.cells[month.monthKey];
        if (!cell) continue;
        for (const bill of cell.bills) {
          m.set(`${row.branchId}|${month.monthKey}|${bill.categoryId}`, {
            id: bill.id,
            amount: bill.amount,
            status: bill.status,
            isAnomalous: bill.isAnomalous,
            deltaPct: bill.deltaPct,
          });
        }
      }
    }
    return m;
  }, [rows, months]);

  return (
    <div className="space-y-1">
      {/* UX-02 (2026-06-03) · mobile-only horizontal-scroll hint · the table
          extends past the viewport on phones and the sticky branch column
          earlier gave no signal that more months exist to the right. */}
      <p className="text-xs text-zinc-500 sm:hidden">
        ← เลื่อนซ้าย-ขวาเพื่อดูเดือนทั้งหมด
      </p>
      <div
        className="relative overflow-x-auto rounded-lg border border-zinc-200 bg-white before:pointer-events-none before:absolute before:right-0 before:top-0 before:bottom-0 before:z-[5] before:w-6 before:bg-gradient-to-l before:from-white before:to-transparent sm:before:hidden"
      >
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
              className="sticky right-0 z-[15] border-b border-l border-zinc-200 bg-zinc-100/95 px-3 py-2 text-right text-xs font-semibold text-zinc-700 backdrop-blur"
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
                    const isAnomalous = Boolean(cell?.isAnomalous);
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
                          isAnomalous={isAnomalous}
                          onToggleExpand={() => toggleBranch(row.branchId)}
                        />
                      );
                    return (
                      <td
                        key={m.monthKey}
                        className={cn(
                          "border-b border-zinc-100 px-3 py-2 text-right text-sm tabular-nums",
                          cellBg(status),
                          isAnomalous &&
                            status !== "PAID" &&
                            "ring-1 ring-inset ring-amber-400",
                        )}
                      >
                        {content}
                      </td>
                    );
                  })}
                  {/* UX-02 (2026-06-03) · sticky right so the row-total is
                      never lost off-screen during horizontal scroll on mobile. */}
                  <td className="sticky right-0 z-[6] border-b border-l border-zinc-200 bg-zinc-50/95 px-3 py-2 text-right text-sm font-semibold tabular-nums text-zinc-900 backdrop-blur">
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
                          // PERF-01 (2026-06-03) · O(1) lookup via memoized map.
                          const bill = billByKey.get(
                            `${row.branchId}|${m.monthKey}|${sub.categoryId}`,
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
                          const anomalyTitle =
                            bill.isAnomalous && bill.deltaPct != null
                              ? `เดือนก่อนต่าง ${bill.deltaPct > 0 ? "+" : ""}${(bill.deltaPct * 100).toFixed(0)}%`
                              : undefined;
                          return (
                            <td
                              key={m.monthKey}
                              className="border-b border-zinc-100 px-3 py-1.5 text-right text-xs tabular-nums"
                            >
                              <button
                                type="button"
                                onClick={() => openBill(bill.id)}
                                title={anomalyTitle ?? "เปิดหน้าต่างจ่ายบิล"}
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
                                {bill.isAnomalous ? (
                                  <span className="text-amber-600">⚠</span>
                                ) : null}
                                {baht(bill.amount)}
                              </button>
                            </td>
                          );
                        })}
                        <td className="sticky right-0 z-[6] border-b border-l border-zinc-100 bg-zinc-50/95 px-3 py-1.5 text-right text-xs text-zinc-500 backdrop-blur" />
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
            <td className="sticky right-0 z-[6] border-t border-l border-zinc-200 bg-zinc-200/80 px-3 py-2 text-right text-sm tabular-nums backdrop-blur">
              {grandTotal ? baht(grandTotal) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
      </div>

      {/* Draggable, non-modal pay windows · portal to body so the table's
          overflow:auto never clips them. */}
      {openBills.map((id, i) => (
        <BillWindow
          key={id}
          billId={id}
          canEdit={canEdit}
          initialOffset={i * 28}
          onClose={() => closeBill(id)}
        />
      ))}
    </div>
  );
}

function CellLink({
  canEdit,
  tone,
  status,
  amount,
  isAnomalous,
  onToggleExpand,
}: {
  monthKey: string;
  branchId: string;
  canEdit: boolean;
  tone: string;
  status: "PAID" | "PENDING" | "OVERDUE" | null;
  amount: number;
  isAnomalous: boolean;
  onToggleExpand: () => void;
}) {
  const chip = status ? STATUS_CHIP[status] : null;
  const content = (
    <span className={cn("inline-flex items-center gap-1.5", tone)}>
      {chip ? (
        <span className={cn("size-1.5 rounded-full", chip.dot)} />
      ) : null}
      {isAnomalous ? (
        <span
          aria-hidden="true"
          title="ต่างจากเดือนก่อนเกิน 20%"
          className="text-amber-600"
        >
          ⚠
        </span>
      ) : null}
      {baht(amount)}
    </span>
  );
  if (!canEdit) return content;
  // DEVIL-02 (2026-06-03) · clicking an amount used to open the "create new
  // bill" modal pre-filled to that month — confusing because the cell already
  // had bills. The semantic action is "inspect this cell"; toggle the branch
  // row open so the sub-rows reveal the bills under it. The branch sub-row
  // still shows each bill's deep link to /chairops/bills/[id] for editing.
  return (
    <button
      type="button"
      onClick={onToggleExpand}
      className="hover:underline"
      aria-label="ดูรายการบิลในเดือนนี้"
    >
      {content}
    </button>
  );
}
