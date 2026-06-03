import { prisma } from "@/lib/prisma";
import { PRODUCT_ORDER, round4 } from "@/lib/fuelos/pricing";

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
