import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  emptyState?: ReactNode;
  className?: string;
}

const alignClass = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * Auditmekub-style data table:
 * - Visible borders on all cells (not just dividers)
 * - Strong header row with bg
 * - Zebra rows
 * - Hover lift on row
 * - Responsive: scrolls horizontally on mobile
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  emptyState,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 border-b-2 border-zinc-200">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-4 py-3 text-xs uppercase tracking-wider font-bold text-zinc-600",
                    alignClass[c.align ?? "left"],
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const key = rowKey(row);
              const cells = columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4 py-3 border-b border-zinc-100",
                    alignClass[c.align ?? "left"],
                    c.className,
                  )}
                >
                  {c.cell(row)}
                </td>
              ));

              const rowClass = cn(
                "transition-colors",
                idx % 2 === 0 ? "bg-white" : "bg-zinc-50/40",
                rowHref && "hover:bg-[--color-brand-50] cursor-pointer",
              );

              if (rowHref) {
                return (
                  <tr
                    key={key}
                    className={rowClass}
                    onClick={() => {
                      window.location.href = rowHref(row);
                    }}
                  >
                    {cells}
                  </tr>
                );
              }

              return (
                <tr key={key} className={rowClass}>
                  {cells}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
