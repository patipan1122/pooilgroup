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

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import * as Q from "./v2-queries";
import * as L from "./v2-queries-legacy";
// mock runtime data (BRANCHES/ANOMALIES/TODAY/…) ถูกถอดออกแล้ว — fallback ทุก loader
// เป็น empty-state จริง (ห้ามโชว์ยอดปลอมในแอปการเงิน). เก็บไว้แค่ "type" สำหรับ typing.
import type {
  Branch, Anomaly, ActiveSession, ClosedSession,
  SessionDetail,
  StockEntry, Delivery, TodaySummary, TrendDay,
  BranchPerf, InsightRow,
} from "./v2-data";

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
  // ⚠️ fallback = [] (ไม่ใช่ mock): org จริงที่ไม่มีข้อมูลต้องเห็น empty-state จริง
  // ห้ามโชว์สาขา/ยอดปลอมในแอปการเงิน (mock สาขา → คลิก → getMachinePnl 404)
  return firstNonEmpty<Branch[]>(
    [() => Q.getV2Branches()],
    (v) => v.length,
    [],
  );
}

export async function loadAnomalies(filter?: string): Promise<Anomaly[]> {
  // ⚠️ fallback = [] (ไม่ใช่ mock): empty org → ไม่มี anomaly ปลอม
  return firstNonEmpty<Anomaly[]>(
    [() => Q.listV2Anomalies(filter), () => L.legacyAnomalies(filter)],
    (v) => v.length,
    [],
  );
}

/**
 * ไส้ใน anomaly เดียว (drill-in จาก Anomaly inbox).
 * real-DB tier ก่อน · ถ้าไม่เจอ fallback หา mock ที่ id ตรง (showcase env).
 */
export async function loadAnomaly(sessionCode: string): Promise<Anomaly | null> {
  try {
    const real = await Q.getV2Anomaly(sessionCode);
    if (real) return real;
  } catch {
    /* real-DB tier ล้ม → คืน null (ไม่ fallback หา mock) */
  }
  // ⚠️ ไม่ fallback mock: empty org → ไม่เจอ → notFound (ไม่โชว์ anomaly ปลอม)
  return null;
}

/**
 * ไส้ในรอบเดียว (drill-in จาก Operations).
 * มีแค่ real-DB tier — ถ้าไม่เจอ (mock-only env / sessionCode ผิด) คืน null → page โชว์ notFound.
 */
export async function loadSessionDetail(sessionCode: string): Promise<SessionDetail | null> {
  try {
    return await Q.getV2SessionDetail(sessionCode);
  } catch {
    return null;
  }
}

export async function loadHubData(filter?: string): Promise<{
  today: TodaySummary; trend7d: TrendDay[]; branchPerf: BranchPerf[];
  activeSessions: ActiveSession[]; closedToday: ClosedSession[];
}> {
  // ⚠️ fallback = EMPTY hub (ไม่ใช่ mock): empty org → hero โชว์ ฿0 จริง ไม่ใช่ยอดปลอม
  const emptyToday: TodaySummary = {
    revenue: 0,
    yesterdayRevenue: 0,
    sessions: 0,
    sessionsExpected: 0,
    anomaliesOpen: 0,
    stockAlerts: 0,
    staffActive: 0,
    staffTotal: 0,
    prizesOut: 0,
  };
  const empty = {
    today: emptyToday,
    trend7d: [] as TrendDay[],
    branchPerf: [] as BranchPerf[],
    activeSessions: [] as ActiveSession[],
    closedToday: [] as ClosedSession[],
  };
  // "has data" = any session activity (closed or open)
  const hasData = (d: { closedToday: unknown[]; activeSessions: unknown[]; branchPerf: BranchPerf[] }) =>
    d.closedToday.length + d.activeSessions.length + d.branchPerf.reduce((a, b) => a + b.sessions, 0);
  return firstNonEmpty(
    [() => Q.getV2HubData(filter), () => L.legacyHubData(filter)],
    hasData,
    empty,
  );
}

export async function loadInsights(filter?: string, days = 7): Promise<InsightRow[]> {
  // ⚠️ fallback = [] (ไม่ใช่ mock): empty org → ตารางวิเคราะห์ว่างจริง
  return firstNonEmpty<InsightRow[]>(
    [() => Q.getV2Insights(filter, days), () => L.legacyInsights(filter, days)],
    (v) => v.length,
    [],
  );
}

/**
 * นับ badge เมนูแบบเบา ๆ (REAL · ไม่ hardcode):
 *   - openSessions = รอบที่กำลังเก็บ (status OPEN) ในสาขาที่ user เห็น
 *   - anomalies    = รอบที่รอตรวจ (status ANOMALY_REVIEW)
 * scope ด้วย org + branch ของ user (เหมือน loaders อื่น) · ถ้า query พังคืน 0/0
 * (badge หายไป ดีกว่าโชว์เลขปลอม).
 */
export async function loadNavCounts(): Promise<{ openSessions: number; anomalies: number }> {
  try {
    const session = await requireSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);
    const branchWhere = branchIds === "ALL" ? {} : { branchId: { in: branchIds } };

    const [openSessions, anomalies] = await Promise.all([
      prisma.cfCollectionSession.count({ where: { orgId, status: "OPEN", ...branchWhere } }),
      prisma.cfCollectionSession.count({ where: { orgId, status: "ANOMALY_REVIEW", ...branchWhere } }),
    ]);
    return { openSessions, anomalies };
  } catch {
    return { openSessions: 0, anomalies: 0 };
  }
}

export async function loadBranchStock(branchId: string): Promise<{
  stock: StockEntry[]; deliveries: Delivery[];
}> {
  // ⚠️ fallback = ว่าง (ไม่ใช่ mock): empty org → ไม่มีสต๊อก/การส่งของปลอม
  const empty = { stock: [] as StockEntry[], deliveries: [] as Delivery[] };
  return firstNonEmpty(
    [() => Q.getV2BranchStock(branchId), () => L.legacyBranchStock(branchId)],
    (v) => v.stock.length,
    empty,
  );
}
