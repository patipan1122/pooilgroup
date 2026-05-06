import type { ReactNode } from "react";

export type ColumnType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "select"
  | "date"
  | "datetime"
  | "boolean"
  | "badge";

export interface ColumnOption {
  value: string;
  label: string;
  /** Tailwind class hint, e.g. "bg-amber-100 text-amber-900 border-amber-300" */
  className?: string;
}

/**
 * A column in the data-grid.
 * `K` is the key (string), `T` is the row shape.
 */
export interface DataGridColumn<T> {
  key: string;
  label: string;
  type?: ColumnType;
  width?: number;
  minWidth?: number;
  align?: "left" | "right" | "center";
  /** Default true for text/number/date/select/email/phone */
  sortable?: boolean;
  /** Default true */
  filterable?: boolean;
  /** Default false. When true, clicking the cell turns it into an input. */
  editable?: boolean;
  /** Pin column to left side */
  frozen?: boolean;
  /** For select / badge types — list of valid values */
  options?: ReadonlyArray<ColumnOption>;
  /** Get the raw value from a row. Defaults to `row[key]`. */
  getValue?: (row: T) => unknown;
  /** Custom display renderer. Default: stringified value. */
  render?: (row: T) => ReactNode;
  /** Serialize to TSV cell. Default: stringified value. */
  format?: (row: T) => string;
  /** Parse a string from TSV/paste back to a value. Default: identity. */
  parse?: (text: string) => unknown;
  /** Validate a parsed value. Return error message or null. */
  validate?: (value: unknown, row: T | null) => string | null;
  /** Wrap cell content in a link. */
  href?: (row: T) => string | null | undefined;
  /** Hint shown in column header (e.g. "เช่น 081-...") */
  hint?: string;
}

export interface DataGridBulkAction<T> {
  id: string;
  label: string;
  icon?: ReactNode;
  /** When true, button uses red/destructive styling */
  danger?: boolean;
  /** Confirm message shown before action runs. If undefined, runs immediately. */
  confirm?: (count: number) => string;
  run: (rows: T[]) => Promise<void> | void;
}

export interface DataGridRowAction<T> {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  /** Hide for some rows */
  hidden?: (row: T) => boolean;
  run: (row: T) => Promise<void> | void;
}

export interface PasteDiff<T> {
  /** Rows that will be inserted */
  inserts: Partial<T>[];
  /** Rows that match existing (by id key) and will be updated */
  updates: Array<{ id: string; before: T; after: T; changedKeys: string[] }>;
  /** Pasted rows that have validation errors */
  errors: Array<{ rowIndex: number; message: string; raw: string[] }>;
  /** Headers detected from paste */
  headers: string[];
}

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

export type ColumnFilters = Record<string, string>;
