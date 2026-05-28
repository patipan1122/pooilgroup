// ClawFleet v2 — LEGACY real-data query layer (pre-migration).
//
// Reads the EXISTING group-based schema (no branch_id / cross-check snapshot
// columns / cf_deliveries — those require migration 20260528000001). Maps the
// live group-collection data into the v2 mockup types so the redesign shows REAL
// data before the migration lands.
//
// Cross-check semantics here are the GROUP coin-balance model the data actually
// supports: exchanger coins dispensed vs claw coins received (the real anti-fraud
// check). Once the migration + branch-shape seed run, lib/clawfleet/v2-queries.ts
// (per-claw cash model) takes over via the loader's new→legacy→mock order.
//
// Every query uses explicit `select` that avoids the not-yet-existing columns so
// it runs against the current DB.

import { prisma } from "@/lib/prisma";
import { requireSession, type Session } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import type {
  Anomaly, Machine, ActiveSession, ClosedSession, StockEntry, Delivery,
  TodaySummary, TrendDay, BranchPerf, InsightRow,
} from "./v2-data";
import { getV2Branches } from "./v2-queries";

const COIN_BAHT = 10;

const thaiTime = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok", hour12: false }).format(d);
const thaiDateShort = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" }).format(d);
const timeAgo = (d: Date) => {
  const hr = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (hr < 1) return "ไม่ถึงชม.";
  if (hr < 24) return `${hr} ชม.`;
  return `${Math.floor(hr / 24)} วัน`;
};
const firstChar = (s: string) => s.trim().charAt(0) || "?";

async function scope(session: Session) {
  return { orgId: session.user.org_id, branchIds: await userBranchIds(session) };
}
function branchAllowed(branchIds: string[] | "ALL", branchId: string | null, filter?: string): boolean {
  if (!branchId) return false;
  if (filter && filter !== "all" && branchId !== filter) return false;
  return branchIds === "ALL" || branchIds.includes(branchId);
}

// shared select for a session's CLAW events
const clawEventsSelect = {
  where: { eventType: "COLLECTION" as const },
  select: {
    coinMeterBefore: true, coinMeterAfter: true, cashCountedCents: true,
    dollMeterBefore: true, dollMeterAfter: true, stockBefore: true, stockAfter: true,
    refillQty: true, anomalyFlags: true, notes: true,
    photoMeterBeforeUrl: true, photoCashUrl: true, photoMeterAfterUrl: true, photoStockUrl: true,
    machine: { select: { code: true, nickname: true, kind: true } },
  },
};

function mapClawMachines(events: Array<{
  coinMeterBefore: number; coinMeterAfter: number;
  dollMeterBefore: number | null; dollMeterAfter: number | null;
  stockBefore: number | null; stockAfter: number | null; refillQty: number | null;
  anomalyFlags: string[]; notes: string | null;
  photoMeterBeforeUrl: string | null; photoCashUrl: string | null;
  photoMeterAfterUrl: string | null; photoStockUrl: string | null;
  machine: { code: string; nickname: string | null; kind: string };
}>): Machine[] {
  return events
    .filter((e) => e.machine.kind === "CLAW")
    .map((e): Machine => {
      const coinDelta = e.coinMeterAfter - e.coinMeterBefore;
      const photos = [e.photoMeterBeforeUrl, e.photoCashUrl, e.photoMeterAfterUrl, e.photoStockUrl].filter(Boolean).length;
      return {
        code: e.machine.code,
        name: e.machine.nickname ?? e.machine.code,
        meterBefore: e.coinMeterBefore,
        meterAfter: e.coinMeterAfter,
        coinRate: COIN_BAHT,
        prizeBefore: e.stockBefore ?? 0,
        prizeAfter: e.stockAfter ?? 0,
        refilled: e.refillQty ?? 0,
        skuMix: "",
        cashIn: coinDelta * COIN_BAHT, // coin throughput valued at ฿10/coin
        prizeMeterPrev: e.dollMeterBefore ?? 0,
        prizeMeterNow: e.dollMeterAfter ?? 0,
        photos,
        flag: e.anomalyFlags.length > 0,
        note: e.notes ?? undefined,
      };
    });
}

// =============================================================
export async function legacyAnomalies(filter?: string): Promise<Anomaly[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const rows = await prisma.cfCollectionSession.findMany({
    where: { orgId, status: "ANOMALY_REVIEW" },
    select: {
      sessionCode: true, openedAt: true, closedAt: true,
      exchangerCoinsOut: true, clawCoinsIn: true, coinVarianceBps: true,
      totalCashCents: true, anomalyFlags: true,
      openedBy: { select: { name: true } },
      group: { select: { branchId: true } },
      events: clawEventsSelect,
    },
    orderBy: { closedAt: "desc" },
    take: 50,
  });

  return rows
    .filter((s) => branchAllowed(branchIds, s.group?.branchId ?? null, filter))
    .map((s): Anomaly => {
      const expectedCash = (s.exchangerCoinsOut ?? 0) * COIN_BAHT;
      const actualCash = (s.clawCoinsIn ?? 0) * COIN_BAHT;
      const gap = Math.max(0, expectedCash - actualCash);
      const gapPct = Math.abs((s.coinVarianceBps ?? 0) / 100);
      const machines = mapClawMachines(s.events);
      const prizeMeterOut = machines.reduce((a, m) => a + (m.prizeMeterNow - m.prizeMeterPrev), 0);
      const prizeCountedOut = machines.reduce((a, m) => a + (m.prizeBefore + m.refilled - m.prizeAfter), 0);
      const opened = s.openedAt;
      const closed = s.closedAt ?? s.openedAt;
      const durMin = Math.max(1, Math.round((closed.getTime() - opened.getTime()) / 60000));
      return {
        id: s.sessionCode,
        branchId: s.group?.branchId ?? "",
        severity: gapPct > 25 ? "P0" : "P1",
        type: "cash_short",
        typeLabel: "เหรียญขาด",
        reason: s.anomalyFlags[0] ?? "ตู้คีบรับเหรียญน้อยกว่าที่ตู้แลกจ่าย",
        expectedCash,
        actualCash,
        gap,
        gapPct,
        prizeExpected: prizeMeterOut,
        prizeActual: prizeCountedOut,
        prizeGap: prizeMeterOut - prizeCountedOut,
        sessionStart: thaiTime(opened),
        sessionEnd: thaiTime(closed),
        duration: `${durMin} นาที`,
        timeAgo: timeAgo(closed),
        timestamp: `${thaiTime(closed)} · ${thaiDateShort(closed)}`,
        staff: s.openedBy.name,
        staffAvatar: firstChar(s.openedBy.name),
        machines,
      };
    });
}

// =============================================================
export async function legacyHubData(filter?: string): Promise<{
  today: TodaySummary; trend7d: TrendDay[]; branchPerf: BranchPerf[];
  activeSessions: ActiveSession[]; closedToday: ClosedSession[];
}> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const since = new Date(); since.setDate(since.getDate() - 7);

  const [closedRows, openRows, branches] = await Promise.all([
    prisma.cfCollectionSession.findMany({
      where: { orgId, status: { in: ["CLOSED", "ANOMALY_REVIEW", "LOCKED"] }, closedAt: { gte: since } },
      select: {
        sessionCode: true, closedAt: true, totalCashCents: true, status: true,
        openedById: true, openedBy: { select: { name: true } },
        group: { select: { branchId: true } }, _count: { select: { events: true } },
        events: { where: { eventType: "COLLECTION" }, select: { dollMeterBefore: true, dollMeterAfter: true, machine: { select: { kind: true } } } },
      },
      orderBy: { closedAt: "desc" },
    }),
    prisma.cfCollectionSession.findMany({
      where: { orgId, status: "OPEN" },
      select: {
        sessionCode: true, openedAt: true, openedById: true, openedBy: { select: { name: true } },
        group: { select: { branchId: true, _count: { select: { machines: true } } } },
        _count: { select: { events: true } },
      },
      orderBy: { openedAt: "asc" },
    }),
    getV2Branches(),
  ]);

  const inScope = (bid: string | null) => branchAllowed(branchIds, bid, filter);
  const closed = closedRows.filter((r) => inScope(r.group?.branchId ?? null));
  const open = openRows.filter((r) => inScope(r.group?.branchId ?? null));
  const prizeOf = (evs: Array<{ dollMeterBefore: number | null; dollMeterAfter: number | null; machine: { kind: string } }>) =>
    evs.filter((e) => e.machine.kind === "CLAW").reduce((a, e) => a + ((e.dollMeterAfter ?? 0) - (e.dollMeterBefore ?? 0)), 0);

  const revenue = closed.reduce((a, r) => a + r.totalCashCents, 0) / 100;
  const prizesOut = closed.reduce((a, r) => a + prizeOf(r.events), 0);
  const anomaliesOpen = closed.filter((r) => r.status === "ANOMALY_REVIEW").length;

  const today: TodaySummary = {
    revenue, yesterdayRevenue: 0,
    sessions: closed.length, sessionsExpected: branches.length,
    anomaliesOpen, stockAlerts: 0,
    staffActive: new Set([...closed, ...open].map((r) => r.openedById)).size,
    staffTotal: branches.length, prizesOut,
  };

  const trend7d: TrendDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - i);
    const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
    const dayRows = closed.filter((r) => r.closedAt && r.closedAt >= d0 && r.closedAt < d1);
    trend7d.push({
      day: new Intl.DateTimeFormat("th-TH", { weekday: "narrow", timeZone: "Asia/Bangkok" }).format(d0),
      date: thaiDateShort(d0),
      revenue: dayRows.reduce((a, r) => a + r.totalCashCents, 0) / 100,
      anomaly: dayRows.filter((r) => r.status === "ANOMALY_REVIEW").length,
      today: i === 0,
    });
  }

  const branchPerf: BranchPerf[] = branches.map((b) => {
    const rows = closed.filter((r) => r.group?.branchId === b.id);
    return {
      id: b.id, revenue: rows.reduce((a, r) => a + r.totalCashCents, 0) / 100, change: 0,
      sessions: rows.length, anomaly: rows.filter((r) => r.status === "ANOMALY_REVIEW").length,
      prizeOut: rows.reduce((a, r) => a + prizeOf(r.events), 0),
      status: rows.some((r) => r.status === "ANOMALY_REVIEW") ? "attention" : "ok",
    };
  });

  const activeSessions: ActiveSession[] = open.map((s) => {
    const total = s.group?._count.machines ?? s._count.events;
    const elapsedMs = Date.now() - s.openedAt.getTime();
    return {
      id: s.sessionCode, branchId: s.group?.branchId ?? "", machines: total, done: s._count.events,
      staff: s.openedBy.name, staffAvatar: firstChar(s.openedBy.name),
      elapsed: `${Math.floor(elapsedMs / 3_600_000)} ชม. ${Math.floor((elapsedMs % 3_600_000) / 60000)} นาที`,
      startedAt: thaiTime(s.openedAt), stale: elapsedMs > 3 * 3_600_000,
    };
  });

  const closedToday: ClosedSession[] = closed.filter((r) => r.status === "CLOSED").slice(0, 8).map((s) => ({
    id: s.sessionCode, branchId: s.group?.branchId ?? "", revenue: Math.round(s.totalCashCents / 100),
    machines: s._count.events, prizeOut: prizeOf(s.events),
    staff: s.openedBy.name, staffAvatar: firstChar(s.openedBy.name),
    closedAt: s.closedAt ? thaiTime(s.closedAt) : "—",
  }));

  return { today, trend7d, branchPerf, activeSessions, closedToday };
}

// =============================================================
export async function legacyInsights(filter?: string, days = 7): Promise<InsightRow[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const since = new Date(); since.setDate(since.getDate() - days);
  const rows = await prisma.cfCollectionSession.findMany({
    where: { orgId, status: { in: ["CLOSED", "ANOMALY_REVIEW", "LOCKED"] }, closedAt: { gte: since } },
    select: {
      sessionCode: true, closedAt: true, status: true,
      exchangerCoinsOut: true, clawCoinsIn: true, totalCashCents: true,
      openedBy: { select: { name: true } }, group: { select: { branchId: true } },
      events: { where: { eventType: "COLLECTION" }, select: { dollMeterBefore: true, dollMeterAfter: true, machine: { select: { kind: true } } } },
    },
    orderBy: { closedAt: "desc" }, take: 200,
  });
  return rows
    .filter((s) => branchAllowed(branchIds, s.group?.branchId ?? null, filter))
    .map((s): InsightRow => {
      const closed = s.closedAt ?? new Date();
      const review = s.status === "ANOMALY_REVIEW";
      const prizeOut = s.events.filter((e) => e.machine.kind === "CLAW").reduce((a, e) => a + ((e.dollMeterAfter ?? 0) - (e.dollMeterBefore ?? 0)), 0);
      return {
        time: `${thaiDateShort(closed)} ${thaiTime(closed)}`,
        id: s.sessionCode, branchId: s.group?.branchId ?? "", staff: s.openedBy.name,
        expectedCash: (s.exchangerCoinsOut ?? 0) * COIN_BAHT || Math.round(s.totalCashCents / 100),
        actualCash: (s.clawCoinsIn ?? 0) * COIN_BAHT || Math.round(s.totalCashCents / 100),
        prizeOut, status: review ? "review" : "ok", severity: review ? "P1" : undefined,
      };
    });
}

// =============================================================
export async function legacyBranchStock(branchId: string): Promise<{ stock: StockEntry[]; deliveries: Delivery[] }> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const [products, movements, machines] = await Promise.all([
    prisma.cfProduct.findMany({ where: { orgId, isActive: true } }),
    prisma.cfStockMovement.findMany({ where: { orgId, branchId } }),
    prisma.cfMachine.findMany({ where: { orgId, branchId, kind: "CLAW", isActive: true }, select: { lastDollStock: true } }),
  ]);
  const inMachineTotal = machines.reduce((a, m) => a + m.lastDollStock, 0);
  const stock: StockEntry[] = products.map((p) => {
    const movs = movements.filter((m) => m.productId === p.id);
    const warehouse = movs.filter((m) => !m.machineId).reduce((a, m) => a + m.qty, 0);
    const lastRecv = movs.filter((m) => m.type === "RECEIVE").sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    return {
      sku: p.sku, name: p.name, warehouse: Math.max(0, warehouse),
      inMachines: Math.round(inMachineTotal / Math.max(1, products.length)),
      lastDelivery: lastRecv ? timeAgo(lastRecv.occurredAt) + "ก่อน" : "—",
      velocity: 4, cost: Math.round(p.unitCostCents / 100),
    };
  });
  return { stock, deliveries: [] }; // cf_deliveries table needs migration
}
