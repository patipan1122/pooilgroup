"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

interface Column {
  key: string;
  header: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

export interface TableRow {
  /** Unique identifier for React key */
  key: string;
  /** Optional href — clicking the row navigates here */
  href?: string;
  /** Pre-rendered cell content keyed by column.key */
  cells: Record<string, ReactNode>;
}

interface DataTableProps {
  columns: Column[];
  rows: TableRow[];
  emptyState?: ReactNode;
  className?: string;
}

const alignClass = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * Auditmekub-style data table.
 * Client component (because it handles row click navigation).
 *
 * Server Components must pre-render cells before passing to this component
 * (functions cannot cross the Server → Client boundary in Next 16).
 *
 * Usage:
 *   <DataTable
 *     columns={[{ key: "name", header: "ชื่อ" }]}
 *     rows={list.map(u => ({
 *       key: u.id,
 *       href: `/users/${u.id}`,
 *       cells: { name: <span>{u.name}</span> }
 *     }))}
 *   />
 */
export function DataTable({
  columns,
  rows,
  emptyState,
  className,
}: DataTableProps) {
  const router = useRouter();

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
          {/* Sticky thead — long lists keep their column headers visible while
              the user scrolls the page. Top offset matches admin header height. */}
          <thead>
            <tr className="border-b-2 border-zinc-200">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-4 py-3 text-xs uppercase tracking-wider font-bold text-zinc-600 sticky top-14 sm:top-16 z-20 bg-zinc-50",
                    alignClass[c.align ?? "left"],
                    c.className,
                  )}
                  scope="col"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const rowClass = cn(
                "transition-colors",
                idx % 2 === 0 ? "bg-white" : "bg-zinc-50/40",
                row.href && "hover:bg-[var(--color-brand-50)] cursor-pointer",
              );
              return (
                <tr
                  key={row.key}
                  className={rowClass}
                  onClick={
                    row.href
                      ? () => router.push(row.href!)
                      : undefined
                  }
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-4 py-3 border-b border-zinc-100",
                        alignClass[c.align ?? "left"],
                        c.className,
                      )}
                    >
                      {row.cells[c.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
