// Type-only module · separated from actions.ts because Next.js requires
// "use server" files to export ONLY async functions. The CSV header constant
// and shared types/interfaces live here so both the actions module and the
// client shell can import them safely.

export const CSV_HEADER = [
  "branchSlug",
  "collectedAt",
  "countedAmount",
  "maidPhone",
  "notes",
  "slipUrl",
] as const;

export const HEADER_LINE = CSV_HEADER.join(",");

export type RowKind =
  | "ready" // will insert
  | "dedup" // exact-ish match exists → skip
  | "invalid"; // parse / validation failed

export interface PreviewRow {
  rowIndex: number; // 1-based after header
  branchSlug: string;
  collectedAt: string | null; // ISO "YYYY-MM-DD HH:mm"
  countedAmount: number | null;
  maidPhone: string | null;
  notes: string | null;
  slipUrl: string | null;
  branchId: string | null;
  branchName: string | null;
  maidId: string | null;
  maidLabel: string | null;
  /** Why this row is invalid · empty when kind != "invalid". */
  errors: string[];
  kind: RowKind;
  /** Set when kind === "dedup". */
  dedupCollectionId?: string;
}

export interface PreviewResult {
  ok: true;
  rows: PreviewRow[];
  counts: { ready: number; dedup: number; invalid: number; total: number };
  /** Serialized rows, ready to POST back to commitMaidCsv. */
  payload: string;
}

export type PreviewResponse = PreviewResult | { ok: false; error: string };

export interface CommitResult {
  ok: true;
  committed: number;
  dedup: number;
}

export type CommitResponse = CommitResult | { ok: false; error: string };
