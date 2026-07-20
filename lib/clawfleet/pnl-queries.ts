// ClawFleet — P&L (กำไร/ขาดทุน) query layer.
//
// หัวใจของธุรกิจ: เจ้าของขาดทุนเมื่อตู้ "จ่ายตุ๊กตาง่ายเกินไป".
// ตัวชี้วัดหลัก = "ค่าเฉลี่ยบาท/ตุ๊กตา 1 ตัว" (avgBahtPerDoll):
//
//   avgBahtPerDoll = เงินที่เก็บได้ / จำนวนตุ๊กตาที่ออกไป
//   profit         = เงินที่เก็บได้ − (ตุ๊กตาที่ออก × ต้นทุนตุ๊กตา/ตัว)
//
// ต้นทุนตุ๊กตา ~100-120฿ · ตั้งเครื่อง ~250฿ · จุดพอดี (sweet spot) 180-200฿/ตัว.
// ทุก threshold เป็นค่าคงที่ด้านล่าง (ปรับได้ที่เดียว).

import { prisma } from "@/lib/prisma";
import { CfSessionStatus, CfEventType } from "@/lib/generated/prisma/client";
import { requireSession, type Session } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";

// =============================================================
// FLAG BANDS — ปรับได้ตรงนี้ที่เดียว (tunable)
// =============================================================
/** ต่ำกว่านี้ = จ่ายง่ายไป กำไรน้อย/ขาดทุน */
export const AVG_LOW_MAX = 180;
/** 180–280 = พอดี (เขียว) */
export const AVG_GOOD_MAX = 280;
/** 280–350 = เริ่มตึง (เหลือง) */
export const AVG_AMBER_MAX = 350;
// มากกว่า AVG_AMBER_MAX = ตึงไป ตุ๊กตาไม่ออก ลูกค้าหนี (แดง)

export type PnlFlag = "LOW" | "GOOD" | "AMBER" | "HIGH" | "LOSS" | "NODATA";

export type PnlFlagInfo = {
  flag: PnlFlag;
  /** สีธง — map ตรงกับ Pill color + cf token (emerald/red/amber/slate) */
  tone: "emerald" | "red" | "amber" | "slate";
  label: string;
  /** ระดับความรุนแรงสำหรับเรียงแย่→ดี (มาก = แย่/น่าห่วงกว่า) */
  severity: number;
};

/**
 * ตัดสินธงจาก avgBahtPerDoll + profit.
 * - profit < 0 → LOSS เสมอ (แดง) ไม่สนใจ band
 * - avg < 180 → LOW (จ่ายง่ายไป · แดง)
 * - 180–280 → GOOD (พอดี · เขียว)
 * - 280–350 → AMBER (เริ่มตึง · เหลือง)
 * - > 350 → HIGH (ตึงไป · แดง)
 * - ไม่มีตุ๊กตาออก/ไม่มีต้นทุน → NODATA
 */
export function pnlFlag(avgBahtPerDoll: number | null, profit: number, hasCost: boolean): PnlFlagInfo {
  if (avgBahtPerDoll === null || !Number.isFinite(avgBahtPerDoll)) {
    return { flag: "NODATA", tone: "slate", label: "ยังไม่มีข้อมูล", severity: 1 };
  }
  if (hasCost && profit < 0) {
    return { flag: "LOSS", tone: "red", label: "ขาดทุน · จ่ายง่ายเกินไป", severity: 100 };
  }
  if (avgBahtPerDoll < AVG_LOW_MAX) {
    return { flag: "LOW", tone: "red", label: "จ่ายง่ายไป · กำไรน้อย/เสี่ยงขาดทุน", severity: 90 };
  }
  if (avgBahtPerDoll <= AVG_GOOD_MAX) {
    return { flag: "GOOD", tone: "emerald", label: "พอดี", severity: 10 };
  }
  if (avgBahtPerDoll <= AVG_AMBER_MAX) {
    return { flag: "AMBER", tone: "amber", label: "เริ่มตึง", severity: 40 };
  }
  return { flag: "HIGH", tone: "red", label: "ตึงไป · ตุ๊กตาไม่ออก ลูกค้าหนี", severity: 80 };
}

// =============================================================
// shared types
// =============================================================
export type PnlRange = { from: Date; to: Date };

export type BranchPnl = {
  branchId: string;
  name: string;
  code: string;
  area: string;
  /** เงินที่เก็บได้ (บาท) */
  revenue: number;
  /** จำนวนตุ๊กตาที่ออกไป */
  dollsOut: number;
  /** ต้นทุนตุ๊กตาที่ออก (บาท) */
  cost: number;
  /** กำไร (บาท) = revenue − cost */
  profit: number;
  /** ค่าเฉลี่ยบาท/ตัว (null ถ้าไม่มีตุ๊กตาออก) */
  avgBahtPerDoll: number | null;
  /** มีต้นทุนตั้งไว้ไหม (ถ้าไม่มี loadout เลย = false → ไม่คิด profit จริง) */
  hasCost: boolean;
  flag: PnlFlagInfo;
  /** จำนวนตู้ในสาขาที่ flag LOW/LOSS/HIGH (เสี่ยง) */
  riskyMachines: number;
  sessions: number;
};

export type MachinePnl = {
  machineId: string;
  code: string;
  nickname: string | null;
  revenue: number;
  dollsOut: number;
  cost: number;
  profit: number;
  avgBahtPerDoll: number | null;
  hasCost: boolean;
  flag: PnlFlagInfo;
  /** วันที่ตั้งค่าตู้ล่าสุด (loadout active effectiveFrom) · null = ยังไม่ตั้งค่า */
  lastConfiguredAt: Date | null;
  /** "N วันก่อน" หรือ "ยังไม่ตั้งค่า" */
  lastConfiguredLabel: string;
  /** ตั้งค่าเกิน 30 วัน + ธงแย่ = ควรโทรบอกพนักงาน */
  configStale: boolean;
  /** ใครเก็บรอบล่าสุด */
  lastCollectedBy: string | null;
  /** เก็บล่าสุดเมื่อไหร่ */
  lastCollectedAt: Date | null;
  lastCollectedLabel: string;
};

// =============================================================
// helpers
// =============================================================
/** offset เวลาไทย (Asia/Bangkok = UTC+7) เป็นมิลลิวินาที */
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * ต้นวัน (00:00:00.000 เวลาไทย) ของวันที่ "N วันก่อนวันนี้" คืนเป็น Date (UTC instant).
 *
 * ทำไมต้องมี: setHours(0,0,0,0) อิงเวลาเครื่อง — บน Vercel (UTC) จะตัดวันเพี้ยน 7 ชม.
 * (รอบที่เก็บ 01:00–07:00 เวลาไทยจะถูกนับเป็นเมื่อวาน). helper นี้ตัดวันตามเวลาไทยจริง.
 *
 * วิธี: เลื่อน now ไปเป็นเวลาไทย → floor ลงต้นวัน (UTC math) → เลื่อนกลับเป็น UTC instant.
 */
export function bangkokStartOfDay(daysAgo = 0): Date {
  const nowBkk = Date.now() + BKK_OFFSET_MS;
  const dayStartBkk = Math.floor(nowBkk / 86_400_000) * 86_400_000 - daysAgo * 86_400_000;
  return new Date(dayStartBkk - BKK_OFFSET_MS);
}

/** สิ้นวัน (23:59:59.999 เวลาไทย) ของวันนี้ คืนเป็น Date (UTC instant). */
export function bangkokEndOfToday(): Date {
  // ต้นวันพรุ่งนี้ (เวลาไทย) − 1ms = สิ้นวันนี้
  return new Date(bangkokStartOfDay(-1).getTime() - 1);
}

/**
 * ช่วงเวลา "N วันล่าสุด" ตามเวลาไทย (รวมวันนี้).
 * days=7 → from = ต้นวันของ 6 วันก่อน · to = สิ้นวันนี้ (รวม 7 วัน).
 */
export function bangkokRangeLastDays(days: number): PnlRange {
  return { from: bangkokStartOfDay(days - 1), to: bangkokEndOfToday() };
}

function defaultRange(filter?: PnlRange): PnlRange {
  if (filter) return filter;
  // default = วันนี้ (เวลาไทย) — ตัดวันตาม Asia/Bangkok ไม่อิงเวลาเครื่อง (Vercel=UTC เพี้ยน 7 ชม.)
  return { from: bangkokStartOfDay(0), to: bangkokEndOfToday() };
}

function daysAgo(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}
function daysAgoLabel(d: Date | null, missing: string): string {
  if (!d) return missing;
  const n = daysAgo(d);
  if (n <= 0) return "วันนี้";
  if (n === 1) return "เมื่อวาน";
  return `${n} วันก่อน`;
}

/** รวม org-scope + branch-scope จาก session (เหมือน v2-queries.ts) */
async function scope(session: Session): Promise<{ orgId: string; branchIds: string[] | "ALL" }> {
  const bs = await userBranchIds(session);
  return { orgId: session.user.org_id, branchIds: bs };
}

/** สถานะที่ถือว่า "ปิดรอบแล้ว เข้ารายงานได้" (รายได้/ต้นทุนจริง) */
const CLOSED_STATUSES: CfSessionStatus[] = [
  CfSessionStatus.CLOSED,
  CfSessionStatus.LOCKED,
  CfSessionStatus.ANOMALY_REVIEW,
];

/**
 * map: machineId → ต้นทุนตุ๊กตา/ตัว (เซ็นต์) จาก active loadout (effectiveTo = null).
 * ถ้าไม่มี loadout → ตู้นั้นไม่อยู่ใน map (= ยังไม่ตั้งต้นทุน).
 */
async function activeMachineCostMap(orgId: string, machineIds: string[]): Promise<Map<string, number>> {
  if (machineIds.length === 0) return new Map();
  const loadouts = await prisma.cfMachineLoadout.findMany({
    where: { orgId, machineId: { in: machineIds }, effectiveTo: null },
    select: {
      machineId: true,
      effectiveFrom: true,
      product: { select: { unitCostCents: true } },
    },
    orderBy: { effectiveFrom: "desc" },
  });
  const out = new Map<string, number>();
  for (const l of loadouts) {
    // เก็บ loadout ที่ effectiveFrom ใหม่สุดต่อ machine (กันมีหลาย active เพี้ยน)
    if (!out.has(l.machineId)) out.set(l.machineId, l.product.unitCostCents);
  }
  return out;
}

/** map: machineId → effectiveFrom ของ active loadout (ใช้สุดท้าย/ใหม่สุด) */
async function activeLoadoutDateMap(orgId: string, machineIds: string[]): Promise<Map<string, Date>> {
  if (machineIds.length === 0) return new Map();
  const loadouts = await prisma.cfMachineLoadout.findMany({
    where: { orgId, machineId: { in: machineIds }, effectiveTo: null },
    select: { machineId: true, effectiveFrom: true },
    orderBy: { effectiveFrom: "desc" },
  });
  const out = new Map<string, Date>();
  for (const l of loadouts) {
    if (!out.has(l.machineId)) out.set(l.machineId, l.effectiveFrom);
  }
  return out;
}

// =============================================================
// 1) Branch-level P&L
// =============================================================
/**
 * P&L รายสาขา (ตู้คีบ) ในช่วงเวลา (default = วันนี้).
 * เรียงแย่→ดี ตาม flag severity แล้วตามกำไรน้อยสุด (ให้ปัญหาขึ้นก่อน).
 */
export async function getBranchPnl(filter?: PnlRange): Promise<BranchPnl[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const range = defaultRange(filter);

  // 1. สาขาตู้คีบในขอบเขตของ user
  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(branchIds === "ALL" ? {} : { id: { in: branchIds } }),
    },
    select: { id: true, name: true, code: true, province: true, region: true },
    orderBy: { code: "asc" },
  });
  if (branches.length === 0) return [];
  const branchIdSet = new Set(branches.map((b) => b.id));

  // 2. ตู้คีบทั้งหมด → ผูก machine → branch + เตรียม cost map
  const machines = await prisma.cfMachine.findMany({
    where: { orgId, kind: "CLAW", isActive: true, branchId: { in: branches.map((b) => b.id) } },
    select: { id: true, branchId: true },
  });
  const machineToBranch = new Map(machines.map((m) => [m.id, m.branchId]));
  const costMap = await activeMachineCostMap(orgId, machines.map((m) => m.id));

  // 3. รอบที่ปิดแล้วในช่วง + events (รายตู้)
  const sessions = await prisma.cfCollectionSession.findMany({
    where: {
      orgId,
      status: { in: CLOSED_STATUSES },
      closedAt: { gte: range.from, lte: range.to },
    },
    select: {
      id: true,
      branchId: true,
      group: { select: { branchId: true } },
      events: {
        // นับ COLLECTION + INITIAL/ตั้งต้น: baseline cash = รายได้ (ให้สรุปสาขาตรงกับรายรอบ drill-in
        // ที่ fallback totalCashCents อยู่แล้ว → ปิดบั๊ก "สรุป ≠ Σ รายรอบ" · CEO 2026-07-20 D-025)
        where: { eventType: { in: [CfEventType.COLLECTION, CfEventType.INITIAL] } },
        select: { machineId: true, eventType: true, cashCountedCents: true, dollMeterBefore: true, dollMeterAfter: true },
      },
    },
  });

  // 4. รวมยอดต่อสาขา + ต่อตู้ (ตู้ใช้นับ riskyMachines)
  //    revCents     = รายได้รวม (COLLECTION + ยอดตั้งต้น) → ใช้โชว์ "รายได้/กำไร" ให้ตรง deposit/matrix
  //    collRevCents = เฉพาะรอบเก็บจริง → ใช้คิด บาท/ตุ๊กตา (avg) + ธงเสี่ยง เท่านั้น
  //    (ยอดตั้งต้นเป็นเงินก้อนเดียวตอนรับตู้ · ถ้าปนเข้าอัตราต่อตัว จะกลบตู้ขาดทุนให้ดูเขียว · D-025)
  type Agg = { revCents: number; collRevCents: number; dolls: number; costCents: number; hasCost: boolean; sessions: number };
  const branchAgg = new Map<string, Agg>();
  const machineAgg = new Map<string, Agg>(); // machineId → agg (สำหรับธงรายตู้)

  const ensure = (m: Map<string, Agg>, k: string): Agg => {
    let a = m.get(k);
    if (!a) { a = { revCents: 0, collRevCents: 0, dolls: 0, costCents: 0, hasCost: false, sessions: 0 }; m.set(k, a); }
    return a;
  };

  for (const s of sessions) {
    const bId = s.branchId ?? s.group?.branchId ?? null;
    if (!bId || !branchIdSet.has(bId)) continue;
    const bAgg = ensure(branchAgg, bId);
    bAgg.sessions += 1;
    for (const e of s.events) {
      // ผูก event → branch ของ machine (กัน machine ย้ายสาขา) · ถ้าไม่เจอใช้ bId
      const evBranch = machineToBranch.get(e.machineId) ?? bId;
      if (!branchIdSet.has(evBranch)) continue;
      // ตุ๊กตาออก + ต้นทุนต่อตัว = เฉพาะรอบเก็บจริง · INITIAL/ตั้งต้น นับเฉพาะเงิน (มิเตอร์สะสม ≠ ตุ๊กตาปล่อยจริง)
      const dolls = e.eventType === CfEventType.COLLECTION
        ? Math.max(0, (e.dollMeterAfter ?? 0) - (e.dollMeterBefore ?? 0))
        : 0;
      const unitCost = costMap.get(e.machineId);
      const cost = unitCost != null ? dolls * unitCost : 0;
      const collRev = e.eventType === CfEventType.COLLECTION ? e.cashCountedCents : 0;
      const ba = ensure(branchAgg, evBranch);
      ba.revCents += e.cashCountedCents;
      ba.collRevCents += collRev;
      ba.dolls += dolls;
      ba.costCents += cost;
      if (unitCost != null) ba.hasCost = true;

      const ma = ensure(machineAgg, e.machineId);
      ma.revCents += e.cashCountedCents;
      ma.collRevCents += collRev;
      ma.dolls += dolls;
      ma.costCents += cost;
      if (unitCost != null) ma.hasCost = true;
    }
  }

  // 5. นับ riskyMachines ต่อสาขา (ตู้ที่ flag LOW/LOSS/HIGH)
  const riskyByBranch = new Map<string, number>();
  for (const [mId, ma] of machineAgg) {
    const bId = machineToBranch.get(mId);
    if (!bId) continue;
    // ธงเสี่ยง = ผลงาน "รอบเก็บจริง" เท่านั้น (ยอดตั้งต้นไม่นับ กันกลบตู้ขาดทุน)
    const avg = ma.dolls > 0 ? (ma.collRevCents / 100) / ma.dolls : null;
    const profit = (ma.collRevCents - ma.costCents) / 100;
    const f = pnlFlag(avg, profit, ma.hasCost);
    if (f.flag === "LOW" || f.flag === "LOSS" || f.flag === "HIGH") {
      riskyByBranch.set(bId, (riskyByBranch.get(bId) ?? 0) + 1);
    }
  }

  // 6. ประกอบผลลัพธ์
  const result: BranchPnl[] = branches.map((b) => {
    const a = branchAgg.get(b.id) ?? { revCents: 0, collRevCents: 0, dolls: 0, costCents: 0, hasCost: false, sessions: 0 };
    const revenue = a.revCents / 100; // รายได้โชว์ = รวมยอดตั้งต้น (ตรงกับ deposit/matrix)
    const collRevenue = a.collRevCents / 100; // เฉพาะรอบเก็บจริง → คิดอัตราต่อตัว + ธง
    const cost = a.costCents / 100;
    const profit = revenue - cost;
    // บาท/ตุ๊กตา + ธงเสี่ยง = รอบเก็บจริงเท่านั้น (ยอดตั้งต้นไม่ปนอัตราต่อตัว)
    const avg = a.dolls > 0 ? collRevenue / a.dolls : null;
    const flag = pnlFlag(avg, collRevenue - cost, a.hasCost);
    return {
      branchId: b.id,
      name: b.name,
      code: b.code,
      area: b.province ?? b.region ?? "—",
      revenue,
      dollsOut: a.dolls,
      cost,
      profit,
      avgBahtPerDoll: avg,
      hasCost: a.hasCost,
      flag,
      riskyMachines: riskyByBranch.get(b.id) ?? 0,
      sessions: a.sessions,
    };
  });

  // เรียงแย่→ดี: severity มากก่อน, แล้วกำไรน้อยก่อน
  result.sort((x, y) => {
    if (y.flag.severity !== x.flag.severity) return y.flag.severity - x.flag.severity;
    return x.profit - y.profit;
  });
  return result;
}

// =============================================================
// 2) Machine-level P&L (drill-in ในสาขา)
// =============================================================
/**
 * P&L รายตู้ในสาขาเดียว + "ตั้งค่าล่าสุดเมื่อไหร่" + "ใครเก็บล่าสุด".
 * เรียงแย่→ดีตาม flag severity.
 */
export async function getMachinePnl(branchId: string, filter?: PnlRange): Promise<{
  branch: { id: string; name: string; code: string; area: string } | null;
  machines: MachinePnl[];
}> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const range = defaultRange(filter);

  // org + branch-scope guard
  if (branchIds !== "ALL" && !branchIds.includes(branchId)) {
    return { branch: null, machines: [] };
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true, name: true, code: true, province: true, region: true },
  });
  if (!branch) return { branch: null, machines: [] };

  const machines = await prisma.cfMachine.findMany({
    where: { orgId, branchId, kind: "CLAW", isActive: true },
    select: { id: true, code: true, nickname: true },
    orderBy: { code: "asc" },
  });
  if (machines.length === 0) {
    return {
      branch: { id: branch.id, name: branch.name, code: branch.code, area: branch.province ?? branch.region ?? "—" },
      machines: [],
    };
  }
  const machineIds = machines.map((m) => m.id);

  const [costMap, dateMap, events] = await Promise.all([
    activeMachineCostMap(orgId, machineIds),
    activeLoadoutDateMap(orgId, machineIds),
    prisma.cfCollectionEvent.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        eventType: "COLLECTION",
        collectedAt: { gte: range.from, lte: range.to },
        // เฉพาะ event ที่อยู่ในรอบที่ปิดแล้ว
        session: { status: { in: CLOSED_STATUSES } },
      },
      select: {
        machineId: true,
        cashCountedCents: true,
        dollMeterBefore: true,
        dollMeterAfter: true,
        collectedAt: true,
        collectedBy: { select: { name: true } },
      },
      orderBy: { collectedAt: "desc" },
    }),
  ]);

  type Agg = {
    revCents: number; dolls: number; costCents: number; hasCost: boolean;
    lastBy: string | null; lastAt: Date | null;
  };
  const agg = new Map<string, Agg>();
  const ensure = (k: string): Agg => {
    let a = agg.get(k);
    if (!a) { a = { revCents: 0, dolls: 0, costCents: 0, hasCost: false, lastBy: null, lastAt: null }; agg.set(k, a); }
    return a;
  };
  for (const e of events) {
    const a = ensure(e.machineId);
    const dolls = Math.max(0, (e.dollMeterAfter ?? 0) - (e.dollMeterBefore ?? 0));
    const unitCost = costMap.get(e.machineId);
    a.revCents += e.cashCountedCents;
    a.dolls += dolls;
    if (unitCost != null) { a.costCents += dolls * unitCost; a.hasCost = true; }
    // events มาเรียง desc แล้ว → ตัวแรกที่เจอต่อ machine = ล่าสุด
    if (!a.lastAt) { a.lastAt = e.collectedAt; a.lastBy = e.collectedBy?.name ?? null; }
  }

  const out: MachinePnl[] = machines.map((m) => {
    const a = agg.get(m.id) ?? { revCents: 0, dolls: 0, costCents: 0, hasCost: false, lastBy: null, lastAt: null };
    const revenue = a.revCents / 100;
    const cost = a.costCents / 100;
    const profit = revenue - cost;
    const avg = a.dolls > 0 ? revenue / a.dolls : null;
    const flag = pnlFlag(avg, profit, a.hasCost);
    const lastConfiguredAt = dateMap.get(m.id) ?? null;
    const configStale =
      lastConfiguredAt != null &&
      daysAgo(lastConfiguredAt) > 30 &&
      (flag.flag === "LOW" || flag.flag === "LOSS" || flag.flag === "HIGH");
    return {
      machineId: m.id,
      code: m.code,
      nickname: m.nickname,
      revenue,
      dollsOut: a.dolls,
      cost,
      profit,
      avgBahtPerDoll: avg,
      hasCost: a.hasCost,
      flag,
      lastConfiguredAt,
      lastConfiguredLabel: daysAgoLabel(lastConfiguredAt, "ยังไม่ตั้งค่า"),
      configStale,
      lastCollectedBy: a.lastBy,
      lastCollectedAt: a.lastAt,
      lastCollectedLabel: daysAgoLabel(a.lastAt, "ยังไม่เก็บ"),
    };
  });

  out.sort((x, y) => {
    if (y.flag.severity !== x.flag.severity) return y.flag.severity - x.flag.severity;
    return x.profit - y.profit;
  });

  return {
    branch: { id: branch.id, name: branch.name, code: branch.code, area: branch.province ?? branch.region ?? "—" },
    machines: out,
  };
}

// =============================================================
// 3) Org-wide P&L roll-up (hero) — รวมทุกสาขาในขอบเขต
// =============================================================
export type PnlSummary = {
  revenue: number;
  cost: number;
  profit: number;
  dollsOut: number;
  avgBahtPerDoll: number | null;
  sessions: number;
  riskyBranches: number;
  hasCost: boolean;
};

// =============================================================
// 4) Collection history — รอบที่ปิดแล้วของสาขา (drill-in)
// =============================================================
export type BranchSessionRow = {
  sessionCode: string;
  closedAt: Date | null;
  closedLabel: string;
  staff: string;
  revenue: number;
  dollsOut: number;
  cost: number;
  profit: number;
  hasCost: boolean;
  anomaly: boolean;
};

/** ประวัติการเก็บเงิน (รอบที่ปิดแล้ว) ของสาขา · ใหม่สุดก่อน */
export async function getBranchSessionHistory(branchId: string, take = 20): Promise<BranchSessionRow[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  if (branchIds !== "ALL" && !branchIds.includes(branchId)) return [];

  // ตู้ในสาขา → cost map
  const machines = await prisma.cfMachine.findMany({
    where: { orgId, branchId, kind: "CLAW", isActive: true },
    select: { id: true },
  });
  const costMap = await activeMachineCostMap(orgId, machines.map((m) => m.id));

  const rows = await prisma.cfCollectionSession.findMany({
    where: {
      orgId,
      status: { in: CLOSED_STATUSES },
      OR: [{ branchId }, { group: { branchId } }],
    },
    select: {
      sessionCode: true,
      closedAt: true,
      status: true,
      totalCashCents: true,
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      events: {
        where: { eventType: "COLLECTION" },
        select: { machineId: true, cashCountedCents: true, dollMeterBefore: true, dollMeterAfter: true },
      },
    },
    orderBy: { closedAt: "desc" },
    take,
  });

  return rows.map((s): BranchSessionRow => {
    let revCents = 0, dolls = 0, costCents = 0, hasCost = false;
    for (const e of s.events) {
      revCents += e.cashCountedCents;
      const d = Math.max(0, (e.dollMeterAfter ?? 0) - (e.dollMeterBefore ?? 0));
      dolls += d;
      const uc = costMap.get(e.machineId);
      if (uc != null) { costCents += d * uc; hasCost = true; }
    }
    // ถ้าไม่มี event ใช้ totalCashCents เป็น fallback รายได้
    const revenue = (revCents || s.totalCashCents) / 100;
    const cost = costCents / 100;
    return {
      sessionCode: s.sessionCode,
      closedAt: s.closedAt,
      closedLabel: daysAgoLabel(s.closedAt, "—"),
      staff: s.closedBy?.name ?? s.openedBy?.name ?? "—",
      revenue,
      dollsOut: dolls,
      cost,
      profit: revenue - cost,
      hasCost,
      anomaly: s.status === CfSessionStatus.ANOMALY_REVIEW,
    };
  });
}

/** สรุปภาพรวมจาก branch P&L (reuse getBranchPnl เพื่อไม่ query ซ้ำตรรกะ) */
export function summarizeBranchPnl(branches: BranchPnl[]): PnlSummary {
  const revenue = branches.reduce((s, b) => s + b.revenue, 0);
  const cost = branches.reduce((s, b) => s + b.cost, 0);
  const dollsOut = branches.reduce((s, b) => s + b.dollsOut, 0);
  const sessions = branches.reduce((s, b) => s + b.sessions, 0);
  const hasCost = branches.some((b) => b.hasCost);
  const riskyBranches = branches.filter(
    (b) => b.flag.flag === "LOW" || b.flag.flag === "LOSS" || b.flag.flag === "HIGH",
  ).length;
  return {
    revenue,
    cost,
    profit: revenue - cost,
    dollsOut,
    avgBahtPerDoll: dollsOut > 0 ? revenue / dollsOut : null,
    sessions,
    riskyBranches,
    hasCost,
  };
}
