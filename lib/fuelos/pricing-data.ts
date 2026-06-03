import { prisma } from "@/lib/prisma";
import { PRODUCT_ORDER } from "@/lib/fuelos/pricing";

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export type PricingContext = {
  date: Date;
  depotName: string;
  costs: Record<string, number | null>; // product → ต้นทุนวันนี้
  zones: string[];
  margins: Record<string, Record<string, { base: number; min: number }>>; // zone → product → margin
};

export async function getPricingContext(
  orgId: string,
  depotName = "PTT",
): Promise<PricingContext> {
  const date = startOfToday();
  const [prices, marginRows] = await Promise.all([
    prisma.depotPrice.findMany({ where: { orgId, date, depotName } }),
    prisma.zoneMargin.findMany({ where: { orgId, isActive: true } }),
  ]);

  const costs: Record<string, number | null> = {};
  for (const p of PRODUCT_ORDER) costs[p] = null;
  for (const row of prices) costs[row.productType] = Number(row.costPerL);

  const zoneSet = new Set<string>();
  const margins: Record<string, Record<string, { base: number; min: number }>> = {};
  for (const m of marginRows) {
    zoneSet.add(m.zoneName);
    margins[m.zoneName] ??= {};
    margins[m.zoneName][m.productType] = {
      base: Number(m.baseMargin),
      min: Number(m.minMargin),
    };
  }
  return {
    date,
    depotName,
    costs,
    zones: [...zoneSet].sort(),
    margins,
  };
}

// ราคาขายต่อลิตรของลูกค้า (ต้นทุน + กำไรโซน + เซลล์บวกเพิ่ม)
export async function getCustomerSellPrices(
  orgId: string,
  zone: string | null,
  salesMargin = 0,
): Promise<Record<string, { cost: number; zoneMargin: number; sell: number } | null>> {
  const ctx = await getPricingContext(orgId);
  const out: Record<string, { cost: number; zoneMargin: number; sell: number } | null> = {};
  for (const p of PRODUCT_ORDER) {
    const cost = ctx.costs[p];
    // โซนมีแต่ไม่ได้ตั้ง margin ของสินค้านี้ → ใช้ค่า default 0.45 (กันขายต่ำกว่าทุน)
    const zm = zone ? ctx.margins[zone]?.[p]?.base ?? 0.45 : 0.45;
    if (cost == null) {
      out[p] = null;
    } else {
      out[p] = { cost, zoneMargin: zm, sell: Math.round((cost + zm + salesMargin) * 10000) / 10000 };
    }
  }
  return out;
}
