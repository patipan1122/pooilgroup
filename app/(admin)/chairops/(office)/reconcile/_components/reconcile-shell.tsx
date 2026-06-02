// Reconcile v2 shell — the shared 2-column workspace rendered by BOTH the org
// page (/chairops/reconcile) and the branch page (/chairops/reconcile/[id]).
//
// LEFT  : ReconcileSidebar (280px · client live-search · branch nav)
// RIGHT : breadcrumb + title + freshness + hero + tab switcher + active view
//
// Tab is URL-driven (?view=ledger|timeline|periods · default ledger). Only the
// data the active tab needs is fetched (Ledger | Timeline | Periods), keeping
// each request lean. Server Component — sidebar is the only client island.

import Link from "next/link";
import { Download, RefreshCcw } from "lucide-react";
import {
  getReconcileSidebar,
  getReconcileOverview,
  getReconcileLedger,
  getReconcileTimeline,
  getReconcilePeriods,
  ledgerTotals,
} from "@/lib/chairops/queries/reconcile-v2";
import { getCumulativeShortage } from "@/lib/chairops/queries/_cumulative-shortage";
import { ReconcileSidebar } from "./reconcile-sidebar";
import {
  FreshnessBar,
  DriftHero,
  ReconcileTabs,
  LedgerTab,
  TimelineTab,
  PeriodsTab,
} from "./reconcile-views";
import { LedgerDateFilter } from "./ledger-date-filter";

export type ReconcileView = "ledger" | "timeline" | "periods";

export function normalizeView(raw: string | undefined): ReconcileView {
  return raw === "timeline" || raw === "periods" ? raw : "ledger";
}

// CEO 2026-06-02: validate ?from / ?to in "YYYY-MM-DD" form. Anything else is
// dropped silently so a malformed URL never throws.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDate(raw: string | undefined): string | undefined {
  return raw && DATE_RE.test(raw) ? raw : undefined;
}

export async function ReconcileShell({
  orgId,
  branchId,
  branchName,
  view,
  from,
  to,
  missingSlip,
}: {
  orgId: string;
  /** null = org-level "ทุกสาขารวม" view */
  branchId: string | null;
  branchName: string | null;
  view: ReconcileView;
  from?: string;
  to?: string;
  /** F1 · audit MISS-04: filter Ledger to days where a CSV_IMPORT row has no slip. */
  missingSlip?: boolean;
}) {
  const isOrg = branchId === null;
  const baseHref = isOrg
    ? "/chairops/reconcile"
    : `/chairops/reconcile/${branchId}`;

  const safeFrom = normalizeDate(from);
  const safeTo = normalizeDate(to);

  // Sidebar + overview always load. The active tab's dataset loads on demand.
  // cumShortage is the canonical "ค้างฝากรวม" aggregate shared with the exec
  // home tile (CEO ruling 2026-06-02 — positive-only sum across active
  // branches · see lib/chairops/queries/_cumulative-shortage.ts).
  const [sidebar, overview, cumShortage, ledger, timeline, periods] = await Promise.all([
    getReconcileSidebar({ orgId }),
    getReconcileOverview({ orgId, branchId: branchId ?? undefined }),
    getCumulativeShortage(orgId),
    view === "ledger"
      ? getReconcileLedger({
          orgId,
          branchId: branchId ?? undefined,
          take: 365,
          from: safeFrom,
          to: safeTo,
        })
      : Promise.resolve([]),
    view === "timeline"
      ? getReconcileTimeline({ orgId, branchId: branchId ?? undefined, days: 60 })
      : Promise.resolve([]),
    view === "periods"
      ? getReconcilePeriods({ orgId, branchId: branchId ?? undefined })
      : Promise.resolve([]),
  ]);

  // CEO 2026-06-02: default the Ledger view to "last 30 complete POS days
  // ending at posCoverThrough" — same as how a bank statement opens on the
  // most-recent month, not a random year-old slice. Only applies when the
  // user hasn't supplied an explicit ?from/?to.
  const posThrough = overview.freshness.posCoverThrough;
  const defaultedLedger = (() => {
    if (view !== "ledger" || safeFrom || safeTo) return ledger;
    if (!posThrough) return ledger;
    const cutoff = isoMinusDays(posThrough, 29); // 30-day inclusive window
    return ledger.filter((d) => d.date >= cutoff && d.date <= posThrough);
  })();
  const totals = view === "ledger" ? ledgerTotals(defaultedLedger) : null;

  // CEO 2026-06-02 (orchestra-audit CONF-05): the org-level aggregate uses
  // the canonical "positive-only" formula (= "ค้างฝากรวม") so it matches the
  // exec home tile exactly. Previously this used `sidebar.reduce((s,r) =>
  // s + r.cumDrift, 0)` which is signed net — surplus branches cancelled
  // shortage branches and the number contradicted the exec home tile.
  // Per-row sidebar chips stay signed (a branch can still be in surplus).
  const orgCumShortage = cumShortage.total;
  const heroLabel = isOrg
    ? "ค้างฝากรวมทุกสาขา"
    : `ค้างฝาก · ${branchName ?? ""}`;
  const recomputeHref = isOrg
    ? "/chairops/reconcile?recompute=1"
    : `${baseHref}?recompute=1`;
  // CEO 2026-06-02: forward the active date range so the CSV matches the
  // visible ledger slice. Falls back to the default 30-day window if no
  // explicit ?from/?to were set.
  const exportQs = new URLSearchParams();
  if (!isOrg) exportQs.set("branchId", branchId);
  if (safeFrom) exportQs.set("from", safeFrom);
  else if (posThrough && view === "ledger") {
    exportQs.set("from", isoMinusDays(posThrough, 29));
  }
  if (safeTo) exportQs.set("to", safeTo);
  else if (posThrough && view === "ledger") {
    exportQs.set("to", posThrough);
  }
  const exportHref = `/chairops/reconcile/export${exportQs.toString() ? `?${exportQs.toString()}` : ""}`;

  return (
    <div className="rc-app">
      <ReconcileSidebar
        rows={sidebar}
        activeBranchId={branchId}
        orgCumShortage={orgCumShortage}
        view={view}
      />

      <main className="rc-main">
        <header className="rc-header">
          <div>
            <div className="co-breadcrumb">
              <Link href="/chairops/dashboard">ChairOps</Link>
              <span>›</span>
              <span className="current">
                {isOrg ? "Reconcile รวม" : `Reconcile · ${branchName ?? ""}`}
              </span>
            </div>
            <h1 className="rc-title">
              {isOrg ? "ตรวจยอด · ทุกสาขารวม" : `ตรวจยอด · ${branchName ?? ""}`}
            </h1>
            <div
              className="text-3"
              style={{ fontSize: 12.5, marginTop: 4 }}
            >
              POS รายงาน 00:01–23:59 · แม่บ้านเก็บไม่ตรงเวลา · ระบบเทียบสะสมให้
            </div>
          </div>
          <div className="row gap-2">
            <a href={exportHref} className="btn btn-sm" download>
              <Download size={12} aria-hidden="true" /> Export CSV
            </a>
            <Link href={recomputeHref} className="btn btn-sm">
              <RefreshCcw size={12} aria-hidden="true" /> Recompute
            </Link>
          </div>
        </header>

        <FreshnessBar
          freshness={overview.freshness}
          context={isOrg ? "org" : "branch"}
        />

        <DriftHero overview={overview} label={heroLabel} />

        <ReconcileTabs baseHref={baseHref} active={view} />

        {view === "ledger" && (
          <LedgerDateFilter
            baseHref={baseHref}
            from={safeFrom ?? null}
            to={safeTo ?? null}
            posCoverThrough={posThrough}
          />
        )}

        {/* F1 (audit MISS-04 · 2026-06-02) — "ยังไม่มีสลิป" toggle. Chip is a
            simple URL-driven anchor so the page stays server-rendered. Only
            applies to the Ledger view. */}
        {view === "ledger" && (
          <div
            className="row gap-2"
            style={{ alignItems: "center", marginTop: 4 }}
          >
            <Link
              href={(() => {
                const usp = new URLSearchParams();
                if (safeFrom) usp.set("from", safeFrom);
                if (safeTo) usp.set("to", safeTo);
                const qs = usp.toString();
                return qs ? `${baseHref}?${qs}` : baseHref;
              })()}
              className="btn btn-sm"
              aria-pressed={!missingSlip}
              style={
                missingSlip
                  ? undefined
                  : {
                      background: "var(--surface-soft)",
                      borderColor: "var(--border-strong)",
                      fontWeight: 600,
                    }
              }
            >
              ทั้งหมด
            </Link>
            <Link
              href={(() => {
                const usp = new URLSearchParams();
                if (safeFrom) usp.set("from", safeFrom);
                if (safeTo) usp.set("to", safeTo);
                usp.set("missingSlip", "1");
                return `${baseHref}?${usp.toString()}`;
              })()}
              className="btn btn-sm"
              aria-pressed={!!missingSlip}
              title="แสดงเฉพาะวันที่มี CSV import และยังไม่มีสลิปฝาก"
              style={
                missingSlip
                  ? {
                      background: "#fef3c7",
                      borderColor: "#fcd34d",
                      color: "#92400e",
                      fontWeight: 600,
                    }
                  : undefined
              }
            >
              ยังไม่มีสลิป (CSV)
            </Link>
          </div>
        )}

        <div className="rc-body">
          {view === "ledger" && (
            <LedgerTab
              ledger={defaultedLedger}
              totals={totals}
              isOrg={isOrg}
              csvOnlyMissingSlip={missingSlip}
            />
          )}
          {view === "timeline" && <TimelineTab series={timeline} />}
          {view === "periods" && (
            <PeriodsTab periods={periods} branchId={branchId} />
          )}
        </div>
      </main>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
