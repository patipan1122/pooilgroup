// ClawFleet v2 — server data loaders with graceful fallback.
//
// Each loader tries the real DB query (lib/clawfleet/v2-queries.ts). If that
// throws (e.g. the branch-model migration 20260528000001 is not yet applied, so
// the new columns/table don't exist) OR returns empty, it falls back to the
// mock showcase data (lib/clawfleet/v2-data.ts). This keeps the v2 pages working
// as a design preview before the migration lands, then flips to real data
// automatically afterwards once seeded.
//
// TODO[v2-wire-db]: once migration is applied + branch-shape demo seeded and
// verified in prod, the mock fallback can be removed.

import * as Q from "./v2-queries";
import {
  BRANCHES,
  ANOMALIES,
  ACTIVE_SESSIONS,
  CLOSED_TODAY,
  BRANCH_STOCK,
  DELIVERIES,
  TODAY,
  TREND_7D,
  BRANCH_PERF,
  INSIGHTS_ROWS,
  type Branch,
  type Anomaly,
  type ActiveSession,
  type ClosedSession,
  type StockEntry,
  type Delivery,
  type TodaySummary,
  type TrendDay,
  type BranchPerf,
  type InsightRow,
} from "./v2-data";

const inScope = (filter: string | undefined, branchId: string) =>
  !filter || filter === "all" || branchId === filter;

export async function loadBranches(): Promise<Branch[]> {
  try {
    const rows = await Q.getV2Branches();
    return rows.length ? rows : BRANCHES;
  } catch {
    return BRANCHES;
  }
}

export async function loadAnomalies(filter?: string): Promise<Anomaly[]> {
  try {
    const rows = await Q.listV2Anomalies(filter);
    return rows.length ? rows : ANOMALIES.filter((a) => inScope(filter, a.branchId));
  } catch {
    return ANOMALIES.filter((a) => inScope(filter, a.branchId));
  }
}

export async function loadHubData(filter?: string): Promise<{
  today: TodaySummary;
  trend7d: TrendDay[];
  branchPerf: BranchPerf[];
  activeSessions: ActiveSession[];
  closedToday: ClosedSession[];
}> {
  const mock = () => ({
    today: TODAY,
    trend7d: TREND_7D,
    branchPerf: BRANCH_PERF.filter((b) => inScope(filter, b.id)),
    activeSessions: ACTIVE_SESSIONS.filter((s) => inScope(filter, s.branchId)),
    closedToday: CLOSED_TODAY.filter((c) => inScope(filter, c.branchId)),
  });
  try {
    const real = await Q.getV2HubData(filter);
    // if DB has no closed/active sessions yet, show the mock showcase instead of empty
    if (real.closedToday.length === 0 && real.activeSessions.length === 0) return mock();
    return real;
  } catch {
    return mock();
  }
}

export async function loadInsights(filter?: string, days = 7): Promise<InsightRow[]> {
  try {
    const rows = await Q.getV2Insights(filter, days);
    return rows.length ? rows : INSIGHTS_ROWS.filter((r) => inScope(filter, r.branchId));
  } catch {
    return INSIGHTS_ROWS.filter((r) => inScope(filter, r.branchId));
  }
}

export async function loadBranchStock(branchId: string): Promise<{
  stock: StockEntry[];
  deliveries: Delivery[];
}> {
  const mock = () => ({
    stock: BRANCH_STOCK[branchId] ?? [],
    deliveries: DELIVERIES.filter((d) => d.branchId === branchId),
  });
  try {
    const real = await Q.getV2BranchStock(branchId);
    return real.stock.length ? real : mock();
  } catch {
    return mock();
  }
}
