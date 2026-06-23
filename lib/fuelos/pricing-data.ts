import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { PRODUCT_ORDER, PRODUCT_LABELS, round4 } from "@/lib/fuelos/pricing";
import { bkkStartOfToday } from "@/lib/fuelos/utils/format";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export type ZoneMarginCell = { base: number; min: number; transport: number };

export type PricingContext = {
  date: Date;
  depots: { id: string; name: string }[]; // คลัง (config + ที่มีราคาวันนี้)
  defaultDepot: string;
  costs: Record<string, number | null>; // ต้นทุนคลัง default (backward-compat สำหรับ quote/บอท)
  costsByDepot: Record<string, Record<string, number | null>>; // คลัง → product → ต้นทุน
  zones: string[];
  margins: Record<string, Record<string, ZoneMarginCell>>; // zone → product → {base,min,transport}
};

function emptyCosts(): Record<string, number | null> {
  return Object.fromEntries(PRODUCT_ORDER.map((p) => [p, null]));
}

export async function getPricingContext(orgId: string): Promise<PricingContext> {
  const date = startOfToday();
  const [depotRows, prices, marginRows] = await Promise.all([
    prisma.fuelDepot.findMany({
      where: { orgId, isActive: true },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.depotPrice.findMany({ where: { orgId, date } }),
    prisma.zoneMargin.findMany({ where: { orgId, isActive: true } }),
  ]);

  // รวมรายชื่อคลัง: config + คลังที่มีราคาวันนี้แต่ยังไม่ได้ตั้ง config
  const names = new Set<string>(depotRows.map((d) => d.name));
  for (const pr of prices) if (pr.depotName) names.add(pr.depotName);
  const depots: { id: string; name: string }[] =
    depotRows.length > 0
      ? depotRows
      : [...names].map((n) => ({ id: n, name: n }));
  if (depots.length === 0) depots.push({ id: "PTT", name: "PTT" }); // กันว่าง
  const defaultDepot = depots[0].name;

  const costsByDepot: Record<string, Record<string, number | null>> = {};
  for (const n of names) costsByDepot[n] = emptyCosts();
  costsByDepot[defaultDepot] ??= emptyCosts();
  for (const row of prices) {
    costsByDepot[row.depotName] ??= emptyCosts();
    costsByDepot[row.depotName][row.productType] = Number(row.costPerL);
  }
  const costs = costsByDepot[defaultDepot] ?? emptyCosts();

  const zoneSet = new Set<string>();
  const margins: Record<string, Record<string, ZoneMarginCell>> = {};
  for (const m of marginRows) {
    zoneSet.add(m.zoneName);
    margins[m.zoneName] ??= {};
    margins[m.zoneName][m.productType] = {
      base: Number(m.baseMargin),
      min: Number(m.minMargin),
      transport: Number(m.transportCost),
    };
  }

  return { date, depots, defaultDepot, costs, costsByDepot, zones: [...zoneSet].sort(), margins };
}

export type DepotHistoryRow = { key: string; date: Date; costs: Record<string, number> };
export type DepotHistory = {
  depots: string[];
  depot: string | null;
  products: { key: string; label: string }[];
  rows: DepotHistoryRow[]; // วันใหม่สุดอยู่บน
};

// ประวัติต้นทุนคลังย้อนหลัง (DepotPrice เก็บรายวันอยู่แล้ว · 1 แถว/คลัง/ผลิตภัณฑ์/วัน)
// → pivot เป็นตาราง (แถว=วัน · คอลัมน์=ผลิตภัณฑ์) ของคลังที่เลือก
export async function getDepotPriceHistory(
  orgId: string,
  depotName?: string,
  days = 90,
): Promise<DepotHistory> {
  const since = new Date(bkkStartOfToday().getTime() - days * 86_400_000);

  const depotRows = await prisma.depotPrice.findMany({
    where: { orgId },
    distinct: ["depotName"],
    select: { depotName: true },
    orderBy: { depotName: "asc" },
  });
  const depots = depotRows.map((d) => d.depotName);
  const products = PRODUCT_ORDER.map((p) => ({ key: p as string, label: PRODUCT_LABELS[p] ?? p }));
  if (depots.length === 0) return { depots, depot: null, products, rows: [] };

  const depot = depotName && depots.includes(depotName) ? depotName : depots[0];
  const snaps = await prisma.depotPrice.findMany({
    where: { orgId, depotName: depot, date: { gte: since } },
    orderBy: { date: "desc" },
  });

  const byDate = new Map<string, { date: Date; costs: Record<string, number> }>();
  for (const s of snaps) {
    const key = formatInTimeZone(s.date, TZ, "yyyy-MM-dd");
    if (!byDate.has(key)) byDate.set(key, { date: s.date, costs: {} });
    byDate.get(key)!.costs[s.productType] = Number(s.costPerL);
  }
  const rows: DepotHistoryRow[] = [...byDate.entries()].map(([key, v]) => ({
    key,
    date: v.date,
    costs: v.costs,
  }));

  return { depots, depot, products, rows };
}

// รายการคลังทั้งหมด (รวม inactive) — สำหรับ tab จัดการคลัง
export async function listDepots(orgId: string) {
  return prisma.fuelDepot.findMany({
    where: { orgId },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true, sort: true },
  });
}

// ราคาขายต่อลิตรของลูกค้า (ทุน + ขนส่งโซน + กำไรโซน + เซลล์บวกเพิ่ม)
export async function getCustomerSellPrices(
  orgId: string,
  zone: string | null,
  salesMargin = 0,
): Promise<Record<string, { cost: number; transport: number; zoneMargin: number; sell: number } | null>> {
  const ctx = await getPricingContext(orgId);
  const out: Record<string, { cost: number; transport: number; zoneMargin: number; sell: number } | null> = {};
  for (const p of PRODUCT_ORDER) {
    const cost = ctx.costs[p];
    const cell = zone ? ctx.margins[zone]?.[p] : undefined;
    const zm = cell?.base ?? 0.45;
    const tr = cell?.transport ?? 0;
    out[p] = cost == null ? null : { cost, transport: tr, zoneMargin: zm, sell: round4(cost + tr + zm + salesMargin) };
  }
  return out;
}
