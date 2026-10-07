"use client";

// Client island ONLY for the live search filter — the actual table + its
// mutation buttons (MaidActivityTable) are untouched, just fed a filtered
// row list. Same split as reconcile-sidebar.tsx's own search box.
// ultramobileux audit P1 (2026-10-07): this 54-branch table had no way to
// search/filter at all.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { MaidActivityTableRow } from "../types";
import { MaidActivityTable } from "./branch-roster-view";

function matches(row: MaidActivityTableRow, query: string): boolean {
  switch (row.kind) {
    case "branch_with_maids":
      return (
        row.branchName.toLowerCase().includes(query) ||
        row.maids.some((m) => m.displayName.toLowerCase().includes(query))
      );
    case "no_maid":
    case "closed_branch":
      return row.branchName.toLowerCase().includes(query);
    case "resigned_maid":
      return (
        row.displayName.toLowerCase().includes(query) ||
        (row.lastBranchName ?? "").toLowerCase().includes(query)
      );
  }
}

export function MaidRosterSearch({
  rows,
  canMutate,
}: {
  rows: MaidActivityTableRow[];
  canMutate: boolean;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) => matches(r, query));
  }, [q, rows]);

  return (
    <div className="space-y-3">
      <div className="relative sm:max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาสาขา / แม่บ้าน…"
          aria-label="ค้นหาสาขาหรือแม่บ้าน"
          className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm">
          ไม่พบสาขา/แม่บ้านที่ตรงกับ &quot;{q}&quot;
        </div>
      ) : (
        <MaidActivityTable rows={filtered} canMutate={canMutate} />
      )}
    </div>
  );
}
