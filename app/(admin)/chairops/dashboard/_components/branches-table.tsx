"use client";

// Sortable 30-branch table · mobile-scroll · sticky thead
// Per memory [[sticky-thead-pattern]] — sticky thead at top-14 sm:top-16 z-20
// Per memory [[sticky-bg-inherit-anti-pattern]] — solid bg, never bg-inherit
import { useMemo, useState } from "react";
import Link from "next/link";
import { baht, thaiRelative } from "@/lib/chairops/utils/format";
import { StatusBadge, deriveStatus, formatAgeThai } from "./status-badge";
import { cn } from "@/lib/utils/cn";

export interface BranchRow {
  branchId: string;
  branchSlug: string;
  branchName: string;
  mallGroup: string | null;
  floor: string | null;
  posTotal: number;
  depositTotal: number;
  driftAmount: number;
  driftHours: number;
  lastCollectionAt: Date | string | null;
  daysSinceLastCollection: number;
  isActive: boolean;
}

type SortKey =
  | "branchName"
  | "posTotal"
  | "depositTotal"
  | "driftAmount"
  | "driftHours"
  | "daysSinceLastCollection";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "branchName", label: "สาขา" },
  { key: "posTotal", label: "POS รวม", numeric: true },
  { key: "depositTotal", label: "ฝากรวม", numeric: true },
  { key: "driftAmount", label: "DRIFT", numeric: true },
  { key: "driftHours", label: "อายุ", numeric: true },
  { key: "daysSinceLastCollection", label: "เก็บล่าสุด", numeric: true },
];

function rowTone(status: ReturnType<typeof deriveStatus>): string {
  // Solid bg colors — NEVER bg-inherit (per memory)
  switch (status) {
    case "shortage":
    case "missed":
      return "bg-danger/5 hover:bg-danger/10";
    case "watch":
    case "surplus":
      return "bg-warning/5 hover:bg-warning/10";
    case "inactive":
      return "bg-muted/50 text-muted-foreground hover:bg-muted";
    case "ok":
    default:
      return "bg-background hover:bg-muted/50";
  }
}

export function BranchesTable({ rows }: { rows: BranchRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("driftAmount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.branchName.toLowerCase().includes(q) ||
            (r.mallGroup ?? "").toLowerCase().includes(q) ||
            r.branchSlug.toLowerCase().includes(q)
        )
      : rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv, "th") * dir;
      }
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
    });
  }, [rows, sortKey, sortDir, filter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "branchName" ? "asc" : "desc");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div>
          <h2 className="text-base font-semibold sm:text-lg">สาขาทั้งหมด ({rows.length})</h2>
          <p className="text-xs text-muted-foreground">แตะที่แถวเพื่อดูรายละเอียดสาขา</p>
        </div>
        <input
          type="search"
          placeholder="ค้นหาชื่อสาขา / ห้าง..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-14 z-20 bg-background sm:top-16">
            <tr className="border-b border-border bg-muted/60 text-left">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "cursor-pointer select-none whitespace-nowrap bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted",
                    col.numeric && "text-right"
                  )}
                  onClick={() => toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key ? (
                      <span aria-hidden>{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </span>
                </th>
              ))}
              <th className="bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                สถานะ
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-muted-foreground">
                  ไม่พบสาขา · ลองล้างคำค้น
                </td>
              </tr>
            ) : (
              sorted.map((r) => {
                const status = deriveStatus({
                  isActive: r.isActive,
                  driftAmount: r.driftAmount,
                  driftHours: r.driftHours,
                  daysSinceLastCollection: r.daysSinceLastCollection,
                });
                const driftClass =
                  r.driftAmount > 0
                    ? "text-[hsl(0,84%,40%)] font-semibold"
                    : r.driftAmount < -100
                    ? "text-[hsl(38,92%,32%)] font-semibold"
                    : "text-muted-foreground";
                return (
                  <tr
                    key={r.branchId}
                    className={cn(
                      "border-b border-border transition-colors",
                      rowTone(status)
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/chairops/dashboard/${r.branchSlug}`}
                        className="block font-medium text-foreground hover:underline"
                      >
                        {r.branchName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[r.mallGroup, r.floor].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {baht(r.posTotal)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {baht(r.depositTotal)}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-2.5 text-right tabular-nums", driftClass)}>
                      {baht(r.driftAmount, true)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-muted-foreground">
                      {r.driftAmount > 0 ? formatAgeThai(r.driftHours) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs">
                      {r.lastCollectionAt ? (
                        <span title={String(r.lastCollectionAt)}>
                          {thaiRelative(r.lastCollectionAt as Date | string)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">ไม่เคยเก็บ</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={status} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
