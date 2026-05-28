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
} from "@/lib/chairops/queries/reconcile-v2";
import { ReconcileSidebar } from "./reconcile-sidebar";
import {
  FreshnessBar,
  DriftHero,
  ReconcileTabs,
  LedgerTab,
  TimelineTab,
  PeriodsTab,
} from "./reconcile-views";

export type ReconcileView = "ledger" | "timeline" | "periods";

export function normalizeView(raw: string | undefined): ReconcileView {
  return raw === "timeline" || raw === "periods" ? raw : "ledger";
}

export async function ReconcileShell({
  orgId,
  branchId,
  branchName,
  view,
}: {
  orgId: string;
  /** null = org-level "ทุกสาขารวม" view */
  branchId: string | null;
  branchName: string | null;
  view: ReconcileView;
}) {
  const isOrg = branchId === null;
  const baseHref = isOrg
    ? "/chairops/reconcile"
    : `/chairops/reconcile/${branchId}`;

  // Sidebar + overview always load. The active tab's dataset loads on demand.
  const [sidebar, overview, ledger, timeline, periods] = await Promise.all([
    getReconcileSidebar({ orgId }),
    getReconcileOverview({ orgId, branchId: branchId ?? undefined }),
    view === "ledger"
      ? getReconcileLedger({ orgId, branchId: branchId ?? undefined, take: 200 })
      : Promise.resolve([]),
    view === "timeline"
      ? getReconcileTimeline({ orgId, branchId: branchId ?? undefined, days: 60 })
      : Promise.resolve([]),
    view === "periods"
      ? getReconcilePeriods({ orgId, branchId: branchId ?? undefined })
      : Promise.resolve([]),
  ]);

  const orgCumDrift = sidebar.reduce((s, r) => s + r.cumDrift, 0);
  const heroLabel = isOrg
    ? "CUMULATIVE DRIFT รวมทุกสาขา"
    : `CUMULATIVE DRIFT · ${branchName ?? ""}`;
  const recomputeHref = isOrg
    ? "/chairops/reconcile?recompute=1"
    : `${baseHref}?recompute=1`;
  const exportHref = isOrg
    ? "/chairops/reconcile/export"
    : `/chairops/reconcile/export?branchId=${branchId}`;

  return (
    <div className="rc-app">
      <ReconcileSidebar
        rows={sidebar}
        activeBranchId={branchId}
        orgCumDrift={orgCumDrift}
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

        <div className="rc-body">
          {view === "ledger" && <LedgerTab ledger={ledger} isOrg={isOrg} />}
          {view === "timeline" && <TimelineTab series={timeline} />}
          {view === "periods" && (
            <PeriodsTab periods={periods} branchId={branchId} />
          )}
        </div>
      </main>
    </div>
  );
}
