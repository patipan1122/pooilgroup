// ClawFleet v2 — server data loaders with 3-tier real-data preference.
//
// Resolution order per loader:
//   1. NEW branch model (lib/clawfleet/v2-queries.ts · per-claw cash) — works once
//      migration 20260528000001 + branch-shape seed are applied.
//   2. LEGACY group model (lib/clawfleet/v2-queries-legacy.ts) — reads the EXISTING
//      group-collection data (real anomalies/sessions/stock) using only columns that
//      exist pre-migration. This is what renders REAL data today.
//   3. MOCK showcase (lib/clawfleet/v2-data.ts) — only if the DB has no data at all.
//
// So the v2 pages show real data now (group model), and automatically upgrade to
// the per-claw cash model after the migration lands — no code change needed.
//
// TODO[v2-wire-db]: once migration applied + verified in prod, the legacy + mock
// tiers can be dropped.

import * as Q from "./v2-queries";
import * as L from "./v2-queries-legacy";
import {
  BRANCHES, ANOMALIES, ACTIVE_SESSIONS, CLOSED_TODAY, BRANCH_STOCK, DELIVERIES,
  TODAY, TREND_7D, BRANCH_PERF, INSIGHTS_ROWS,
  type Branch, type Anomaly, type ActiveSession, type ClosedSession,
  type StockEntry, type Delivery, type TodaySummary, type TrendDay,
  type BranchPerf, type InsightRow,
} from "./v2-data";

const inScope = (filter: string | undefined, branchId: string) =>
  !filter || filter === "all" || branchId === filter;

/** try a sequence of async producers, return the first non-empty (by `len`), else the last. */
async function firstNonEmpty<T>(
  producers: Array<() => Promise<T>>,
  len: (v: T) => number,
  fallback: T,
): Promise<T> {
  let last: T = fallback;
  for (const p of producers) {
    try {
      const v = await p();
      if (len(v) > 0) return v;
      last = v;
    } catch {
      /* try next tier */
    }
  }
  return last;
}

export async function loadBranches(): Promise<Branch[]> {
  return firstNonEmpty<Branch[]>(
    [() => Q.getV2Branches()],
    (v) => v.length,
    BRANCHES,
  );
}

export async function loadAnomalies(filter?: string): Promise<Anomaly[]> {
  return firstNonEmpty<Anomaly[]>(
    [() => Q.listV2Anomalies(filter), () => L.legacyAnomalies(filter)],
    (v) => v.length,
    ANOMALIES.filter((a) => inScope(filter, a.branchId)),
  );
}

export async function loadHubData(filter?: string): Promise<{
  today: TodaySummary; trend7d: TrendDay[]; branchPerf: BranchPerf[];
  activeSessions: ActiveSession[]; closedToday: ClosedSession[];
}> {
  const mock = {
    today: TODAY, trend7d: TREND_7D,
    branchPerf: BRANCH_PERF.filter((b) => inScope(filter, b.id)),
    activeSessions: ACTIVE_SESSIONS.filter((s) => inScope(filter, s.branchId)),
    closedToday: CLOSED_TODAY.filter((c) => inScope(filter, c.branchId)),
  };
  // "has data" = any session activity (closed or open)
  const hasData = (d: { closedToday: unknown[]; activeSessions: unknown[]; branchPerf: BranchPerf[] }) =>
    d.closedToday.length + d.activeSessions.length + d.branchPerf.reduce((a, b) => a + b.sessions, 0);
  return firstNonEmpty(
    [() => Q.getV2HubData(filter), () => L.legacyHubData(filter)],
    hasData,
    mock,
  );
}

export async function loadInsights(filter?: string, days = 7): Promise<InsightRow[]> {
  return firstNonEmpty<InsightRow[]>(
    [() => Q.getV2Insights(filter, days), () => L.legacyInsights(filter, days)],
    (v) => v.length,
    INSIGHTS_ROWS.filter((r) => inScope(filter, r.branchId)),
  );
}

export async function loadBranchStock(branchId: string): Promise<{
  stock: StockEntry[]; deliveries: Delivery[];
}> {
  const mock = {
    stock: BRANCH_STOCK[branchId] ?? [],
    deliveries: DELIVERIES.filter((d) => d.branchId === branchId),
  };
  return firstNonEmpty(
    [() => Q.getV2BranchStock(branchId), () => L.legacyBranchStock(branchId)],
    (v) => v.stock.length,
    mock,
  );
}
