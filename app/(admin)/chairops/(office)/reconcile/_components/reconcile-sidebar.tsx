"use client";

// Reconcile v2 left sidebar (280px) — mockup `BranchSidebar` parity.
// Client island ONLY for the live search filter; navigation is plain <Link>
// so the rest of the screen stays server-rendered (URL drives branch + view).
//
// Rows: "ทุกสาขารวม" pinned at top (org) · then branch rows with status dot +
// cumulative-drift chip (color by sign). Active row gets the accent left edge
// via [data-active] (see reconcile-v2.css).

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Search } from "lucide-react";
import type { ReconcileSidebarRow } from "@/lib/chairops/queries/reconcile-v2";

function fmtCumDrift(n: number): string {
  const r = Math.round(n);
  // cumDrift = -(driftAmount): negative = shortage, positive = surplus.
  // Show "ค้างฝาก X" so office staff aren't confused by "−5,168".
  if (r < 0) return `ค้างฝาก ${Math.abs(r).toLocaleString("en-US")}`;
  if (r > 0) return `+${r.toLocaleString("en-US")}`;
  return "ปกติ";
}

/**
 * Positive-only formatter for the "ค้างฝากรวม" aggregate (no sign prefix).
 * Per CEO ruling 2026-06-02, the org-row aggregate is always ≥ 0 — a single
 * branch surplus does not pay back another branch's shortage.
 */
function fmtShortage(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function cumClass(n: number): string {
  if (n < -500) return "crit";
  if (n < -100) return "warn";
  return "muted";
}

export function ReconcileSidebar({
  rows,
  activeBranchId,
  orgCumShortage,
  view,
}: {
  rows: ReconcileSidebarRow[];
  activeBranchId: string | null;
  /**
   * Canonical positive-only "ค้างฝากรวมทุกสาขา" aggregate (always ≥ 0).
   * Comes from `getCumulativeShortage(orgId)` so it matches the exec home
   * tile and the reconcile hero exactly (CEO ruling 2026-06-02 · CONF-05).
   */
  orgCumShortage: number;
  view: string;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.mallLabel.toLowerCase().includes(query),
    );
  }, [q, rows]);

  const viewQs = view && view !== "ledger" ? `?view=${view}` : "";

  return (
    <aside className="rc-sidebar">
      <div className="rc-sidebar-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Reconcile</div>
            <div className="text-3" style={{ fontSize: 11 }}>
              {rows.length} สาขา
            </div>
          </div>
        </div>
        <div className="rc-sidebar-search">
          <Search size={13} aria-hidden="true" />
          <input
            placeholder="ค้นหาสาขา…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="ค้นหาสาขา"
          />
        </div>
      </div>
      <div className="rc-sidebar-list">
        {/* ทุกสาขารวม — pinned org row */}
        <Link
          href={`/chairops/reconcile${viewQs}`}
          className="rc-side-row rc-side-org"
          data-active={activeBranchId === null ? "" : undefined}
        >
          <div className="rc-side-icon">
            <LayoutGrid size={14} aria-hidden="true" />
          </div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="rc-side-name">ทุกสาขารวม</div>
            <div className="text-3" style={{ fontSize: 11 }}>
              {rows.length} สาขา · ค้างฝากรวม {fmtShortage(orgCumShortage)} ฿
            </div>
          </div>
        </Link>

        {filtered.map((b) => (
          <Link
            key={b.branchId}
            href={`/chairops/reconcile/${b.branchId}${viewQs}`}
            className="rc-side-row"
            data-active={activeBranchId === b.branchId ? "" : undefined}
          >
            <div className="rc-side-dot" data-status={b.status} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="rc-side-name">{b.name}</div>
              <div className="text-3" style={{ fontSize: 11 }}>
                {b.daysSinceCollect === 0
                  ? "เก็บวันนี้"
                  : b.daysSinceCollect >= 999
                    ? "ไม่เคยเก็บ"
                    : b.daysSinceCollect >= 5
                      ? `เก็บล่าสุด ${b.daysSinceCollect}d ↑`
                      : `เก็บล่าสุด ${b.daysSinceCollect}d`}
              </div>
            </div>
            <div className={"rc-side-cum mono co-drift " + cumClass(b.cumDrift)}>
              {fmtCumDrift(b.cumDrift)}
            </div>
          </Link>
        ))}
      </div>
    </aside>
  );
}
