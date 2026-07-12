// ClawOS — Dashboard/Branches aggregate queries (server-only).
//
// แยกออกมาจาก pnl-queries เพื่อ:
//  1) นับ "ตู้จริง" ต่อสาขา (cfMachine.count) — เลิกใช้ riskyMachines+sessions ที่ผิดเลขคณิต
//  2) กราฟกำไร/ต้นทุนรายวัน (จาก cfCollectionEvent จริง)
//  3) สินค้าใกล้หมดทั้งร้าน (reuse getCfStockOverview รายสาขา → รวม)
//  4) per-machine status dots (จาก cfMachine จริง: isActive + lastDollStock vs reorder)
//  5) fleet summary (ตู้ทั้งหมด / ต้องเติม / เสีย)
//
// ทุก query filter ด้วย orgId + branch-scope ของ user (multi-tenant) ตาม pattern เดียวกับ pnl-queries.ts.

import { prisma } from "@/lib/prisma";
import { CfSessionStatus } from "@/lib/generated/prisma/client";
import { requireSession, type Session } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import { getCfBranchStockProducts, type CfStockProductRow } from "./stock-queries";
import { bangkokStartOfDay } from "./pnl-queries";

/** เกณฑ์ "ต้องเติมตุ๊กตา" — ตู้ที่ตุ๊กตาในตู้เหลือน้อย (mirror lastDollStock) */
const MACHINE_REFILL_LEVEL = 8;

async function scope(session: Session): Promise<{ orgId: string; branchIds: string[] | "ALL" }> {
  const bs = await userBranchIds(session);
  return { orgId: session.user.org_id, branchIds: bs };
}

const CLOSED_STATUSES: CfSessionStatus[] = [
  CfSessionStatus.CLOSED,
  CfSessionStatus.LOCKED,
  CfSessionStatus.ANOMALY_REVIEW,
];

// =============================================================
// per-machine status — ใช้ render dots จริงในหน้า Branches
// =============================================================
/** สถานะตู้ 1 ตัว: ดี / เตือน(ตุ๊กตาใกล้หมด) / เสีย(ปิดใช้งาน) */
export type MachineDotStatus = "good" | "warn" | "broken";

export type BranchMachineInfo = {
  /** จำนวนตู้คีบจริงในสาขา (active) */
  count: number;
  /** สถานะรายตู้ (สำหรับ dots) — เรียงตาม code */
  dots: MachineDotStatus[];
  /** ตู้ที่ตุ๊กตาในตู้ใกล้หมด (ต้องเติม) */
  refillCount: number;
};

// =============================================================
// 1) Machine counts + per-machine status ต่อสาขา (REAL)
// =============================================================
/**
 * นับตู้คีบจริงต่อสาขา + สถานะรายตู้ + fleet summary ทั้งร้าน.
 * แทนที่ proxy เดิม (riskyMachines + sessions) ที่ไม่มีความหมายเชิงเลขคณิต.
 *
 * - count       : cfMachine ที่ kind=CLAW, isActive=true ในสาขา
 * - refillCount : ตู้ที่ lastDollStock <= MACHINE_REFILL_LEVEL (ตุ๊กตาในตู้ใกล้หมด)
 * - dots        : สถานะรายตู้ (good / warn=ต้องเติม / broken=ปิดใช้งาน) สำหรับ render dots
 */
export async function getBranchMachineInfo(): Promise<{
  byBranch: Map<string, BranchMachineInfo>;
  fleet: { totalMachines: number; activeMachines: number; needRefill: number; broken: number };
}> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);

  // ดึงตู้คีบทุกตัว (รวม inactive เพื่อรู้ว่า "ตู้เสีย"=ปิดใช้งาน) ในขอบเขต user
  const machines = await prisma.cfMachine.findMany({
    where: {
      orgId,
      kind: "CLAW",
      ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
    },
    select: { id: true, branchId: true, code: true, isActive: true, lastDollStock: true },
    orderBy: { code: "asc" },
  });

  const byBranch = new Map<string, BranchMachineInfo>();
  let totalMachines = 0;
  let activeMachines = 0;
  let needRefill = 0;
  let broken = 0;

  for (const m of machines) {
    let info = byBranch.get(m.branchId);
    if (!info) {
      info = { count: 0, dots: [], refillCount: 0 };
      byBranch.set(m.branchId, info);
    }
    totalMachines += 1;

    let status: MachineDotStatus;
    if (!m.isActive) {
      status = "broken";
      broken += 1;
    } else {
      activeMachines += 1;
      info.count += 1; // นับเฉพาะตู้ที่ยังใช้งาน เป็น "จำนวนตู้" ของสาขา
      if (m.lastDollStock <= MACHINE_REFILL_LEVEL) {
        status = "warn";
        info.refillCount += 1;
        needRefill += 1;
      } else {
        status = "good";
      }
    }
    info.dots.push(status);
  }

  return {
    byBranch,
    fleet: { totalMachines, activeMachines, needRefill, broken },
  };
}

// =============================================================
// 2) Daily P&L (รายได้ / ต้นทุน / กำไร รายวัน) — REAL
// =============================================================
export type DailyPnlPoint = {
  /** วันที่ (เลขวันแบบสั้น เช่น "24") */
  d: string;
  /** ISO yyyy-mm-dd (Asia/Bangkok) */
  iso: string;
  /** กำไรสุทธิ (พันบาท · "k") เพื่อ render กราฟตาม design เดิม */
  profit: number;
  /** ต้นทุนตุ๊กตา (พันบาท · "k") */
  cost: number;
};

/**
 * รายได้/ต้นทุน/กำไร รายวัน N วันล่าสุด (จาก cfCollectionEvent ในรอบที่ปิดแล้ว).
 * ต้นทุน = ตุ๊กตาออก × ต้นทุน/ตัว (active loadout). หน่วยกราฟ = พันบาท (k).
 * ถ้าไม่มี event เลย → คืน [] (client จะ fallback ตัวอย่าง).
 */
export async function getDailyPnl(days = 7): Promise<DailyPnlPoint[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);

  // ต้นวันของ (days-1) วันก่อน ตามเวลาไทย (Asia/Bangkok) — ไม่อิงเวลาเครื่อง (Vercel=UTC เพี้ยน 7 ชม.)
  const from = bangkokStartOfDay(days - 1);

  // ตู้คีบในขอบเขต → cost map (ต้นทุน/ตัว จาก active loadout)
  const machines = await prisma.cfMachine.findMany({
    where: {
      orgId,
      kind: "CLAW",
      ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
    },
    select: { id: true },
  });
  const machineIds = machines.map((m) => m.id);
  if (machineIds.length === 0) return [];

  const loadouts = await prisma.cfMachineLoadout.findMany({
    where: { orgId, machineId: { in: machineIds }, effectiveTo: null },
    select: { machineId: true, effectiveFrom: true, product: { select: { unitCostCents: true } } },
    orderBy: { effectiveFrom: "desc" },
  });
  const costMap = new Map<string, number>();
  for (const l of loadouts) {
    if (!costMap.has(l.machineId)) costMap.set(l.machineId, l.product.unitCostCents);
  }

  const events = await prisma.cfCollectionEvent.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      eventType: "COLLECTION",
      collectedAt: { gte: from },
      session: { status: { in: CLOSED_STATUSES } },
    },
    select: { machineId: true, cashCountedCents: true, dollMeterBefore: true, dollMeterAfter: true, collectedAt: true },
  });
  if (events.length === 0) return [];

  // key = yyyy-mm-dd ตามเวลาไทย → รวมรายได้/ต้นทุนต่อวัน
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  type DayAgg = { revCents: number; costCents: number };
  const agg = new Map<string, DayAgg>();
  for (const e of events) {
    const iso = fmt.format(e.collectedAt); // "2026-06-24"
    let a = agg.get(iso);
    if (!a) { a = { revCents: 0, costCents: 0 }; agg.set(iso, a); }
    a.revCents += e.cashCountedCents;
    const dolls = Math.max(0, (e.dollMeterAfter ?? 0) - (e.dollMeterBefore ?? 0));
    const unitCost = costMap.get(e.machineId);
    if (unitCost != null) a.costCents += dolls * unitCost;
  }

  // สร้างซีรีส์ครบทุกวัน (เติม 0 วันที่ไม่มี event) เรียงเก่า→ใหม่
  // ใช้ต้นวันเวลาไทยเป็นฐาน แล้ว +12 ชม. ก่อน format เพื่อกันปัดพลาดที่ขอบเที่ยงคืน UTC
  const out: DailyPnlPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayMid = new Date(bangkokStartOfDay(i).getTime() + 12 * 60 * 60 * 1000);
    const iso = fmt.format(dayMid);
    const a = agg.get(iso) ?? { revCents: 0, costCents: 0 };
    // กำไรจริง (ให้ติดลบได้เพื่อสะท้อนวันขาดทุน — หัวใจของโปรแกรมกันโกง)
    const profitK = (a.revCents - a.costCents) / 100 / 1000;
    const costK = a.costCents / 100 / 1000;
    out.push({
      d: String(Number(iso.slice(8, 10))), // วันที่ (ตัด 0 นำหน้า)
      iso,
      profit: Math.round(profitK * 10) / 10,
      cost: Math.round(costK * 10) / 10,
    });
  }
  return out;
}

// =============================================================
// 3) Low-stock ทั้งร้าน (รวมทุกสาขา) — REAL (reuse getCfStockOverview)
// =============================================================
export type DashboardLowStock = {
  name: string;
  loc: string; // ชื่อสาขา
  qty: number; // คงคลังในสาขา
  /** สีตามความรุนแรง (แดง=หมด/ติดลบ · เหลือง=ใกล้หมด) */
  color: string;
};

/**
 * สินค้าใกล้หมดทั่วทุกสาขา (เรียงน้อยสุดก่อน · เอา top N).
 * เกณฑ์ + ยอดที่โชว์ = NET "บนชั้น" (warehouse − inMachines) = ของที่หยิบมาโหลดตู้ได้จริง.
 * เดิมใช้ gross (warehouse) → ของ 100 ตัวแต่โหลดเข้าตู้ 98 (เหลือ 2 บนชั้น) จะไม่เตือน = พลาด.
 * ดึงรายสินค้าตรงจาก getCfBranchStockProducts (มีทั้ง warehouse+inMachines) แล้วกรองด้วย net.
 */
export async function getDashboardLowStock(limit = 6): Promise<DashboardLowStock[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);

  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(branchIds === "ALL" ? {} : { id: { in: branchIds } }),
    },
    select: { id: true, name: true },
  });
  if (branches.length === 0) return [];

  const perBranch = await Promise.all(
    branches.map(async (b) => ({ branch: b, products: await getCfBranchStockProducts(orgId, b.id) })),
  );

  const items: (DashboardLowStock & { net: number })[] = [];
  for (const { branch, products } of perBranch) {
    for (const p of products as CfStockProductRow[]) {
      const net = p.warehouse - p.inMachines; // บนชั้น = พร้อมโหลด
      if (net > p.reorderLevel) continue; // ไม่ใกล้หมด (คิดจากบนชั้นจริง ไม่ใช่ gross)
      items.push({
        name: p.name,
        loc: branch.name,
        qty: net, // โชว์ยอดบนชั้น (ตรงกับเกณฑ์ที่ใช้ตัดสิน)
        net,
        // หมด/ติดลบ = แดง · ใกล้หมด (<=reorder) = เหลือง
        color: net <= 0 ? "#B42318" : "#B45309",
      });
    }
  }

  items.sort((a, b) => a.net - b.net);
  return items.slice(0, limit).map(({ net: _net, ...rest }) => rest);
}
