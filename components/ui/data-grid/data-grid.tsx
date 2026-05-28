"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter as FilterIcon, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { Button } from "../button";
import { Dialog } from "../dialog";
import { rowsToTsv } from "./clipboard";
import type {
  ColumnFilters,
  DataGridBulkAction,
  DataGridColumn,
  DataGridRowAction,
  SortState,
} from "./types";

export interface DataGridProps<T extends { id: string }> {
  rows: T[];
  columns: DataGridColumn<T>[];
  /** Row click navigates here */
  rowHref?: (row: T) => string | undefined;
  /** Selection */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Inline edit — called when a cell is committed */
  onCellEdit?: (rowId: string, key: string, newValue: unknown) => Promise<void> | void;
  /** Paste — invoked with the pasted text after user confirms in dialog */
  onPaste?: (text: string) => void;
  /** Row-level actions in a per-row "..." menu */
  rowActions?: DataGridRowAction<T>[];
  /** Bulk actions in a sticky bar when rows are selected */
  bulkActions?: DataGridBulkAction<T>[];
  /** Empty state */
  emptyState?: ReactNode;
  /** className for outer container */
  className?: string;
  /** Max table height (for body scroll). Default: no limit. */
  maxHeight?: number;
  /** Storage key — when set, sort + column filters persist across reloads */
  persistKey?: string;
}

const ALIGN: Record<string, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function defaultGetValue<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  // booleans: false < true
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "th", { numeric: true, sensitivity: "base" });
}

function matchFilter(value: unknown, query: string): boolean {
  if (!query) return true;
  if (value == null) return false;
  return String(value).toLowerCase().includes(query.toLowerCase());
}

export function DataGrid<T extends { id: string }>({
  rows,
  columns,
  rowHref,
  selectable = true,
  selectedIds: controlledSelected,
  onSelectionChange,
  onCellEdit,
  onPaste,
  rowActions,
  bulkActions,
  emptyState,
  className,
  maxHeight,
  persistKey,
}: DataGridProps<T>) {
  // ----- selection (controlled or uncontrolled) -----
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selectedIds = controlledSelected ?? internalSelected;
  const setSelectedIds = useCallback(
    (next: Set<string>) => {
      if (onSelectionChange) onSelectionChange(next);
      else setInternalSelected(next);
    },
    [onSelectionChange],
  );

  // ----- sort + filter (persisted optionally) -----
  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);

  // localStorage hydrate (mount only) — restore last sort/filter
  // Pattern: setState ใน mount-effect สำหรับ browser-storage hydration (SSR-safe)
  useEffect(() => {
    if (!persistKey) return;
    try {
      const raw = localStorage.getItem(`dg:${persistKey}`);
      if (raw) {
        const v = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (v.sort) setSort(v.sort);
        if (v.filters) setFilters(v.filters);
      }
    } catch {
      /* ignore */
    }
  }, [persistKey]);

  // Debounced — typing in a filter box was hitting localStorage on every
  // keystroke, blocking the input. 300ms feels instant after typing stops.
  useEffect(() => {
    if (!persistKey) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          `dg:${persistKey}`,
          JSON.stringify({ sort, filters }),
        );
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [persistKey, sort, filters]);

  // ----- derived rows -----
  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, v]) => v && v.trim());
    if (activeFilters.length === 0) return rows;
    return rows.filter((r) =>
      activeFilters.every(([key, q]) => {
        const col = columns.find((c) => c.key === key);
        if (!col) return true;
        const v = col.getValue ? col.getValue(r) : defaultGetValue(r, key);
        return matchFilter(v, q);
      }),
    );
  }, [rows, columns, filters]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filteredRows;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = col.getValue ? col.getValue(a) : defaultGetValue(a, sort.key);
      const bv = col.getValue ? col.getValue(b) : defaultGetValue(b, sort.key);
      return compareValues(av, bv) * dir;
    });
  }, [filteredRows, columns, sort]);

  // ----- selection helpers -----
  const lastClickedIdxRef = useRef<number | null>(null);
  const allSelected = sortedRows.length > 0 && sortedRows.every((r) => selectedIds.has(r.id));
  const someSelected = sortedRows.some((r) => selectedIds.has(r.id));
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sortedRows.map((r) => r.id)));
  };

  const toggleRow = (id: string, idx: number, withShift: boolean) => {
    const next = new Set(selectedIds);
    if (withShift && lastClickedIdxRef.current !== null) {
      const start = Math.min(lastClickedIdxRef.current, idx);
      const end = Math.max(lastClickedIdxRef.current, idx);
      const target = next.has(id) ? false : true;
      for (let i = start; i <= end; i++) {
        const r = sortedRows[i];
        if (r) {
          if (target) next.add(r.id);
          else next.delete(r.id);
        }
      }
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    lastClickedIdxRef.current = idx;
    setSelectedIds(next);
  };

  // ----- inline edit -----
  const [editing, setEditing] = useState<{
    rowId: string;
    key: string;
    value: string;
  } | null>(null);

  // ----- bulk-action confirm dialog -----
  const [pendingBulk, setPendingBulk] = useState<{
    action: DataGridBulkAction<T>;
    list: T[];
    message: string;
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const startEdit = useCallback(
    (row: T, col: DataGridColumn<T>) => {
      if (!col.editable || !onCellEdit) return;
      const v = col.getValue ? col.getValue(row) : defaultGetValue(row, col.key);
      setEditing({ rowId: row.id, key: col.key, value: v == null ? "" : String(v) });
    },
    [onCellEdit],
  );

  const commitEdit = useCallback(
    async (move?: "next" | "down" | "cancel") => {
      if (!editing) return;
      if (move === "cancel") {
        setEditing(null);
        return;
      }
      const col = columns.find((c) => c.key === editing.key);
      const row = rows.find((r) => r.id === editing.rowId);
      if (!col || !row || !onCellEdit) {
        setEditing(null);
        return;
      }
      const parsed = col.parse ? col.parse(editing.value) : editing.value;
      if (col.validate) {
        const err = col.validate(parsed, row);
        if (err) {
          toast.error(err);
          return;
        }
      }
      try {
        await onCellEdit(editing.rowId, editing.key, parsed);
      } catch (e) {
        console.error(e);
      }
      setEditing(null);
      // TODO: move=next/down focus next cell — keep simple for v1
    },
    [editing, columns, rows, onCellEdit],
  );

  // ----- copy/paste keyboard handling -----
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Avoid hijacking when user is typing in an input
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT"
    ) {
      return;
    }
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelectedIds(new Set(sortedRows.map((r) => r.id)));
      return;
    }
    if (cmd && e.key.toLowerCase() === "c") {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const selectedRows = sortedRows.filter((r) => ids.includes(r.id));
      if (selectedRows.length === 0) return;
      e.preventDefault();
      const tsv = rowsToTsv(selectedRows, columns, { includeHeader: true });
      navigator.clipboard.writeText(tsv).catch(() => {
        /* ignore */
      });
      return;
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!onPaste) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT"
    ) {
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    if (!text || !text.trim()) return;
    e.preventDefault();
    onPaste(text);
  };

  // ----- bulk action bar -----
  const selectionList = useMemo(
    () => sortedRows.filter((r) => selectedIds.has(r.id)),
    [sortedRows, selectedIds],
  );

  const renderBulkBar = () => {
    if (!bulkActions || bulkActions.length === 0) return null;
    if (selectedIds.size === 0) return null;
    return (
      <div className="sticky top-0 z-30 rounded-xl border-2 border-[var(--color-brand-500)] bg-[var(--color-brand-50)] shadow-blue px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-[var(--color-brand-900)]">
          เลือกแล้ว {selectedIds.size} แถว
        </span>
        <button
          onClick={() => setSelectedIds(new Set())}
          className="text-xs text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] font-medium"
        >
          ยกเลิก
        </button>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {bulkActions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={async () => {
                if (a.confirm) {
                  setPendingBulk({
                    action: a,
                    list: selectionList,
                    message: a.confirm(selectionList.length),
                  });
                  return;
                }
                await a.run(selectionList);
              }}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold border-2 transition-colors",
                a.danger
                  ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                  : "bg-white border-[var(--color-brand-200)] text-[var(--color-brand-700)] hover:bg-[var(--color-brand-100)]",
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ----- render -----
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  // Ensure focus to receive keyboard events
  return (
    <div className={cn("space-y-2", className)}>
      {renderBulkBar()}

      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-md border-2 font-bold transition-colors",
            filtersOpen
              ? "bg-[var(--color-brand-100)] border-[var(--color-brand-400)] text-[var(--color-brand-900)]"
              : "bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400",
          )}
        >
          <FilterIcon className="size-3.5" />
          กรองรายคอลัมน์
        </button>
        {Object.values(filters).some((v) => v && v.trim()) && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-900 font-medium"
          >
            <X className="size-3" />
            ล้างกรอง
          </button>
        )}
        <span className="ml-auto tabular-num">
          {sortedRows.length} / {rows.length} แถว
          {selectedIds.size > 0 && (
            <>
              {" · "}
              <span className="font-bold text-[var(--color-brand-700)]">
                เลือก {selectedIds.size}
              </span>
            </>
          )}
        </span>
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className="rounded-xl border-2 border-zinc-200 bg-white overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)]"
        style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        <table className="w-full text-sm border-collapse" style={{ tableLayout: "auto" }}>
          <thead>
            <tr className="bg-zinc-50">
              {selectable && (
                <th
                  className="sticky top-0 left-0 z-20 bg-zinc-50 border-b-2 border-r border-zinc-200 px-3 py-2 w-10"
                  scope="col"
                >
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="size-3.5 rounded"
                    aria-label="เลือกทั้งหมด"
                  />
                </th>
              )}
              {columns.map((c, ci) => {
                const sortable = c.sortable !== false;
                const isSorted = sort?.key === c.key;
                const dir = isSorted ? sort.direction : null;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      "sticky top-0 z-10 bg-zinc-50 border-b-2 border-zinc-200 px-3 py-2 text-[11px] uppercase tracking-wider font-bold text-zinc-700 whitespace-nowrap",
                      ALIGN[c.align ?? "left"],
                      c.frozen && "left-10 z-20",
                      ci === columns.length - 1 ? "" : "border-r border-zinc-200/60",
                    )}
                    style={{
                      width: c.width,
                      minWidth: c.minWidth ?? c.width,
                    }}
                  >
                    <button
                      type="button"
                      disabled={!sortable}
                      onClick={() => {
                        if (!sortable) return;
                        setSort((s) => {
                          if (!s || s.key !== c.key) return { key: c.key, direction: "asc" };
                          if (s.direction === "asc") return { key: c.key, direction: "desc" };
                          return null;
                        });
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 group/h",
                        sortable && "hover:text-[var(--color-brand-700)] cursor-pointer",
                        !sortable && "cursor-default",
                      )}
                      title={sortable ? "คลิกเพื่อเรียง" : undefined}
                    >
                      <span>{c.label}</span>
                      {sortable && (
                        <span className="text-zinc-400 group-hover/h:text-[var(--color-brand-500)]">
                          {dir === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : dir === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-50" />
                          )}
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
              {rowActions && rowActions.length > 0 && (
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-zinc-50 border-b-2 border-zinc-200 px-3 py-2 w-10"
                />
              )}
            </tr>
            {filtersOpen && (
              <tr className="bg-white">
                {selectable && (
                  <th className="sticky top-[37px] left-0 z-20 bg-white border-b border-zinc-200 px-2 py-1.5" />
                )}
                {columns.map((c) => {
                  const filterable = c.filterable !== false;
                  return (
                    <th
                      key={c.key}
                      className={cn(
                        "sticky top-[37px] z-10 bg-white border-b border-zinc-200 px-2 py-1.5",
                        c.frozen && "left-10 z-20",
                      )}
                    >
                      {filterable ? (
                        <input
                          type="text"
                          value={filters[c.key] ?? ""}
                          onChange={(e) =>
                            setFilters((f) => ({ ...f, [c.key]: e.target.value }))
                          }
                          placeholder="กรอง..."
                          className="w-full px-2 py-1 rounded border border-zinc-200 bg-white text-xs focus:border-[var(--color-brand-500)] focus:outline-none"
                        />
                      ) : null}
                    </th>
                  );
                })}
                {rowActions && rowActions.length > 0 && (
                  <th className="sticky top-[37px] z-10 bg-white border-b border-zinc-200 px-2 py-1.5" />
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const isSelected = selectedIds.has(row.id);
              const href = rowHref?.(row);
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "transition-colors group/datarow",
                    isSelected
                      ? "bg-[var(--color-brand-50)]"
                      : idx % 2 === 0
                        ? "bg-white"
                        : "bg-zinc-50/40",
                    "hover:bg-[var(--color-brand-50)]/70",
                  )}
                >
                  {selectable && (
                    <td
                      className={cn(
                        "sticky left-0 z-10 border-b border-zinc-100 border-r px-3 py-2 w-10 transition-colors",
                        isSelected
                          ? "bg-[var(--color-brand-50)] group-hover/datarow:bg-[var(--color-brand-100)]"
                          : idx % 2 === 0
                            ? "bg-white group-hover/datarow:bg-[var(--color-brand-50)]"
                            : "bg-zinc-50 group-hover/datarow:bg-[var(--color-brand-50)]",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          toggleRow(
                            row.id,
                            idx,
                            (e.nativeEvent as MouseEvent).shiftKey,
                          )
                        }
                        onClick={(e) => e.stopPropagation()}
                        className="size-3.5 rounded"
                        aria-label={`เลือกแถว ${idx + 1}`}
                      />
                    </td>
                  )}
                  {columns.map((c, ci) => {
                    const isEditing =
                      editing?.rowId === row.id && editing?.key === c.key;
                    const cellHref = c.href?.(row) ?? (ci === 0 ? href : undefined);
                    const display = c.render
                      ? c.render(row)
                      : c.format
                        ? c.format(row)
                        : (() => {
                            const v = c.getValue
                              ? c.getValue(row)
                              : defaultGetValue(row, c.key);
                            return v == null ? "" : String(v);
                          })();
                    return (
                      <td
                        key={c.key}
                        className={cn(
                          "border-b border-zinc-100 px-3 py-2 align-middle whitespace-nowrap",
                          ALIGN[c.align ?? "left"],
                          c.frozen && [
                            "sticky left-10 z-10 transition-colors",
                            isSelected
                              ? "bg-[var(--color-brand-50)] group-hover/datarow:bg-[var(--color-brand-100)]"
                              : idx % 2 === 0
                                ? "bg-white group-hover/datarow:bg-[var(--color-brand-50)]"
                                : "bg-zinc-50 group-hover/datarow:bg-[var(--color-brand-50)]",
                          ],
                          ci === columns.length - 1 ? "" : "border-r border-zinc-100",
                          c.editable && onCellEdit && "cursor-text hover:bg-amber-50/30",
                        )}
                        onClick={(e) => {
                          if (isEditing) return;
                          if (c.editable && onCellEdit) {
                            e.stopPropagation();
                            startEdit(row, c);
                          }
                        }}
                      >
                        {isEditing ? (
                          <CellEditor
                            value={editing.value}
                            type={c.type ?? "text"}
                            options={c.options}
                            onChange={(v) =>
                              setEditing((s) => (s ? { ...s, value: v } : s))
                            }
                            onCommit={() => commitEdit("next")}
                            onCancel={() => commitEdit("cancel")}
                          />
                        ) : cellHref ? (
                          <a
                            href={cellHref}
                            className="text-[var(--color-brand-700)] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {display}
                          </a>
                        ) : (
                          display
                        )}
                      </td>
                    );
                  })}
                  {rowActions && rowActions.length > 0 && (
                    <td className="border-b border-zinc-100 px-2 py-2 w-10">
                      <RowActionsMenu actions={rowActions} row={row} />
                    </td>
                  )}
                </tr>
              );
            })}
            {sortedRows.length === 0 && (
              <tr>
                <td
                  colSpan={
                    columns.length +
                    (selectable ? 1 : 0) +
                    (rowActions && rowActions.length > 0 ? 1 : 0)
                  }
                  className="px-4 py-12 text-center text-sm text-zinc-500"
                >
                  ไม่พบข้อมูลที่ตรงกับเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-400">
        💡 เลือกแถว → <kbd className="px-1 rounded bg-zinc-100 border border-zinc-300 text-zinc-700 font-mono text-[10px]">⌘C</kbd> ก๊อปไปวาง Excel · วาง <kbd className="px-1 rounded bg-zinc-100 border border-zinc-300 text-zinc-700 font-mono text-[10px]">⌘V</kbd> เพื่อเพิ่ม/แก้แถวจากตาราง · คลิก header เพื่อเรียง
      </p>

      <Dialog
        open={pendingBulk !== null}
        onClose={() => {
          if (bulkBusy) return;
          setPendingBulk(null);
        }}
        title="ยืนยันการดำเนินการ"
      >
        <div className="space-y-5">
          <div className="text-sm text-zinc-700 leading-relaxed whitespace-pre-line">
            {pendingBulk?.message}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button
              variant="ghost"
              onClick={() => setPendingBulk(null)}
              disabled={bulkBusy}
            >
              ยกเลิก
            </Button>
            <Button
              variant={pendingBulk?.action.danger ? "danger" : "primary"}
              loading={bulkBusy}
              onClick={async () => {
                if (!pendingBulk) return;
                setBulkBusy(true);
                try {
                  await pendingBulk.action.run(pendingBulk.list);
                  setPendingBulk(null);
                } finally {
                  setBulkBusy(false);
                }
              }}
            >
              {pendingBulk?.action.label ?? "ยืนยัน"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function CellEditor({
  value,
  type,
  options,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  type: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (ref.current && "select" in ref.current && typeof ref.current.select === "function") {
      (ref.current as HTMLInputElement).select();
    }
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  if (type === "select" && options) {
    return (
      <select
        ref={ref as React.RefObject<HTMLSelectElement>}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKey}
        className="w-full px-1 py-0.5 rounded border-2 border-[var(--color-brand-500)] bg-white text-sm focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const inputType =
    type === "email"
      ? "email"
      : type === "phone"
        ? "tel"
        : type === "number"
          ? "number"
          : type === "date"
            ? "date"
            : "text";

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      type={inputType}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={onKey}
      className="w-full px-1 py-0.5 rounded border-2 border-[var(--color-brand-500)] bg-white text-sm focus:outline-none"
    />
  );
}

function RowActionsMenu<T>({
  actions,
  row,
}: {
  actions: DataGridRowAction<T>[];
  row: T;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOut);
    return () => document.removeEventListener("mousedown", onClickOut);
  }, [open]);

  const visible = actions.filter((a) => !a.hidden?.(row));
  if (visible.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="size-6 rounded hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700"
        title="เพิ่มเติม"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border-2 border-zinc-200 bg-white shadow-lg overflow-hidden">
          {visible.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                setOpen(false);
                await a.run(row);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left",
                a.danger ? "text-red-700 hover:bg-red-50" : "hover:bg-zinc-50",
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
