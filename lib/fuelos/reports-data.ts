import { prisma } from "@/lib/prisma";
import { PRODUCT_LABELS, PRODUCT_ORDER } from "@/lib/fuelos/pricing";
import { isOverdue, daysSince } from "@/lib/fuelos/customers-data";
import { bkkStartOfToday, bkkStartOfMonth } from "@/lib/fuelos/utils/format";
import type { ProductType } from "@/lib/generated/prisma/enums";

const DAY = 864e5;

// ---------- ขอบเขตเวลา อิงเวลาไทย (ไม่ใช่ TZ ของ server) ----------
export function startOfToday(): Date {
  return bkkStartOfToday();
}

export function startOfMonth(): Date {
  return bkkStartOfMonth();
}

// ============================================================
// F3 — KPI ทีมขาย
// ============================================================

export type SalesKpiRow = {
  salesId: string;
  name: string;
  ordersCount: number;
  totalSales: number;
  totalProfit: number;
  quotesTotal: number; // ใบเสนอราคาที่ปิดผล (ไม่นับ PENDING) เดือนนี้
  quotesWon: number;
  winRate: number | null; // 0..1 ; null = ยังไม่มีใบปิดผล
};

export type KpiSummary = {
  avgFirstResponseMinutes: number | null; // เวลาเฉลี่ยตอบลูกค้าครั้งแรก (นาที)
  respondedConvCount: number; // จำนวนแชทที่ใช้คำนวณ
  unansweredCount: number; // แชทค้างตอบตอนนี้
  perSales: SalesKpiRow[];
};

export async function getKpiSummary(orgId: string): Promise<KpiSummary> {
  const monthStart = startOfMonth();

  const [convs, unansweredCount, ordersThisMonth, quotesThisMonth, users] =
    await Promise.all([
      // ประมาณเวลาตอบครั้งแรก: ใช้ lastInboundAt vs lastStaffReplyAt ที่ denormalized ไว้
      prisma.conversation.findMany({
        where: {
          orgId,
          lastInboundAt: { not: null },
          lastStaffReplyAt: { not: null },
        },
        select: { lastInboundAt: true, lastStaffReplyAt: true },
        take: 2000,
      }),
      prisma.conversation.count({ where: { orgId, isUnanswered: true } }),
      prisma.order.findMany({
        where: {
          orgId,
          createdAt: { gte: monthStart },
          status: { not: "CANCELLED" },
        },
        select: { salesId: true, subtotal: true, totalProfit: true },
      }),
      prisma.quote.findMany({
        where: { orgId, quoteDate: { gte: monthStart } },
        select: { salesId: true, status: true },
      }),
      prisma.fuelUser.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

  // --- avg first-response time ---
  // เฉพาะ conversation ที่พนักงานตอบ "หลัง" ลูกค้าพิมพ์ (reply ช้ากว่า inbound)
  let totalRespMs = 0;
  let respondedConvCount = 0;
  for (const c of convs) {
    if (!c.lastInboundAt || !c.lastStaffReplyAt) continue;
    const diff = c.lastStaffReplyAt.getTime() - c.lastInboundAt.getTime();
    if (diff > 0) {
      totalRespMs += diff;
      respondedConvCount += 1;
    }
  }
  const avgFirstResponseMinutes =
    respondedConvCount > 0
      ? Math.round(totalRespMs / respondedConvCount / 60000)
      : null;

  // --- per-sales aggregate ---
  const byId = new Map<string, SalesKpiRow>();
  for (const u of users) {
    byId.set(u.id, {
      salesId: u.id,
      name: u.name,
      ordersCount: 0,
      totalSales: 0,
      totalProfit: 0,
      quotesTotal: 0,
      quotesWon: 0,
      winRate: null,
    });
  }
  // กันกรณี order/quote ผูกกับ user ที่ inactive/ไม่อยู่ใน list
  function ensure(id: string): SalesKpiRow {
    let row = byId.get(id);
    if (!row) {
      row = {
        salesId: id,
        name: "(ไม่ทราบชื่อ)",
        ordersCount: 0,
        totalSales: 0,
        totalProfit: 0,
        quotesTotal: 0,
        quotesWon: 0,
        winRate: null,
      };
      byId.set(id, row);
    }
    return row;
  }

  for (const o of ordersThisMonth) {
    const row = ensure(o.salesId);
    row.ordersCount += 1;
    row.totalSales += Number(o.subtotal);
    row.totalProfit += Number(o.totalProfit);
  }

  for (const q of quotesThisMonth) {
    const row = ensure(q.salesId);
    if (q.status === "PENDING") continue; // ยังไม่ปิดผล → ไม่นับใน win-rate
    row.quotesTotal += 1;
    if (q.status === "WON") row.quotesWon += 1;
  }

  for (const row of byId.values()) {
    row.winRate = row.quotesTotal > 0 ? row.quotesWon / row.quotesTotal : null;
  }

  // แสดงเฉพาะคนที่มี activity เดือนนี้ + เรียงยอดขายมาก→น้อย
  const perSales = [...byId.values()]
    .filter((r) => r.ordersCount > 0 || r.quotesTotal > 0)
    .sort((a, b) => b.totalSales - a.totalSales);

  return {
    avgFirstResponseMinutes,
    respondedConvCount,
    unansweredCount,
    perSales,
  };
}

// ============================================================
// ลูกค้าผิดปกติ — เกินรอบซื้อ (reuse isOverdue จาก customers-data)
// ============================================================

export type AnomalyRow = {
  id: string;
  name: string;
  zone: string | null;
  owner: string | null;
  daysSince: number | null;
  normalCadence: number | null;
  lastOrderAt: Date | null;
};

export async function getOverdueCustomers(orgId: string): Promise<AnomalyRow[]> {
  const rows = await prisma.customer.findMany({
    where: {
      orgId,
      isActive: true,
      firstOrderAt: { not: null },
      lastOrderAt: { not: null },
      normalCadenceDays: { not: null },
    },
    select: {
      id: true,
      name: true,
      zone: true,
      firstOrderAt: true,
      lastOrderAt: true,
      normalCadenceDays: true,
      assignedSales: { select: { name: true } },
    },
    take: 500,
  });

  return rows
    .filter((c) => isOverdue(c))
    .map((c) => ({
      id: c.id,
      name: c.name,
      zone: c.zone,
      owner: c.assignedSales?.name ?? null,
      daysSince: daysSince(c.lastOrderAt),
      normalCadence: c.normalCadenceDays,
      lastOrderAt: c.lastOrderAt,
    }))
    .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0));
}

// ============================================================
// F11 — กำไร/ขาดทุน (P&L)
// ============================================================

export type PnlTotals = {
  sales: number;
  cost: number;
  profit: number;
  ordersCount: number;
};

export type ProductBreakdownRow = {
  productType: ProductType;
  label: string;
  liters: number;
  sales: number;
  profit: number;
};

export type CustomerBreakdownRow = {
  customerId: string;
  name: string;
  zone: string | null;
  sales: number;
  profit: number;
};

export type SalesZoneBreakdownRow = {
  key: string;
  name: string;
  sales: number;
  profit: number;
};

export type PnlReport = {
  today: PnlTotals;
  month: PnlTotals;
  byProduct: ProductBreakdownRow[];
  topCustomers: CustomerBreakdownRow[]; // top 10 by profit (เดือนนี้)
  bySales: SalesZoneBreakdownRow[]; // เดือนนี้
  byZone: SalesZoneBreakdownRow[]; // เดือนนี้
};

export async function getPnlReport(orgId: string): Promise<PnlReport> {
  const todayStart = startOfToday();
  const monthStart = startOfMonth();

  const [todayOrders, monthOrders] = await Promise.all([
    prisma.order.findMany({
      where: {
        orgId,
        createdAt: { gte: todayStart },
        status: { not: "CANCELLED" },
      },
      select: { subtotal: true, totalCost: true, totalProfit: true },
    }),
    prisma.order.findMany({
      where: {
        orgId,
        createdAt: { gte: monthStart },
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        salesId: true,
        subtotal: true,
        totalCost: true,
        totalProfit: true,
        customer: { select: { id: true, name: true, zone: true } },
        sales: { select: { name: true } },
        items: {
          select: {
            productType: true,
            qtyLiters: true,
            lineTotal: true,
            lineProfit: true,
          },
        },
      },
    }),
  ]);

  const sumTotals = (
    list: { subtotal: unknown; totalCost: unknown; totalProfit: unknown }[],
  ): PnlTotals =>
    list.reduce(
      (acc, o) => {
        acc.sales += Number(o.subtotal);
        acc.cost += Number(o.totalCost);
        acc.profit += Number(o.totalProfit);
        acc.ordersCount += 1;
        return acc;
      },
      { sales: 0, cost: 0, profit: 0, ordersCount: 0 } as PnlTotals,
    );

  const today = sumTotals(todayOrders);
  const month = sumTotals(monthOrders);

  // --- by fuel product (sum OrderItem) ---
  const prodMap = new Map<string, ProductBreakdownRow>();
  for (const p of PRODUCT_ORDER) {
    prodMap.set(p, {
      productType: p,
      label: PRODUCT_LABELS[p] ?? p,
      liters: 0,
      sales: 0,
      profit: 0,
    });
  }
  for (const o of monthOrders) {
    for (const it of o.items) {
      const row = prodMap.get(it.productType);
      if (!row) continue;
      row.liters += Number(it.qtyLiters);
      row.sales += Number(it.lineTotal);
      row.profit += Number(it.lineProfit);
    }
  }
  const byProduct = [...prodMap.values()].filter((r) => r.liters > 0);

  // --- by customer (top 10 by profit) ---
  const custMap = new Map<string, CustomerBreakdownRow>();
  for (const o of monthOrders) {
    const c = o.customer;
    const row = custMap.get(c.id) ?? {
      customerId: c.id,
      name: c.name,
      zone: c.zone,
      sales: 0,
      profit: 0,
    };
    row.sales += Number(o.subtotal);
    row.profit += Number(o.totalProfit);
    custMap.set(c.id, row);
  }
  const topCustomers = [...custMap.values()]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 10);

  // --- by sales ---
  const salesMap = new Map<string, SalesZoneBreakdownRow>();
  for (const o of monthOrders) {
    const row = salesMap.get(o.salesId) ?? {
      key: o.salesId,
      name: o.sales?.name ?? "(ไม่ทราบชื่อ)",
      sales: 0,
      profit: 0,
    };
    row.sales += Number(o.subtotal);
    row.profit += Number(o.totalProfit);
    salesMap.set(o.salesId, row);
  }
  const bySales = [...salesMap.values()].sort((a, b) => b.sales - a.sales);

  // --- by zone ---
  const zoneMap = new Map<string, SalesZoneBreakdownRow>();
  for (const o of monthOrders) {
    const zone = o.customer.zone ?? "ไม่ระบุโซน";
    const row = zoneMap.get(zone) ?? { key: zone, name: zone, sales: 0, profit: 0 };
    row.sales += Number(o.subtotal);
    row.profit += Number(o.totalProfit);
    zoneMap.set(zone, row);
  }
  const byZone = [...zoneMap.values()].sort((a, b) => b.sales - a.sales);

  return { today, month, byProduct, topCustomers, bySales, byZone };
}

// ============================================================
// CSV export — รายการออเดอร์ (per OrderItem line)
// ============================================================

export type OrderCsvRow = {
  date: Date;
  orderNo: string;
  customer: string;
  product: string;
  liters: number;
  sell: number; // ยอดขายของบรรทัด (lineTotal)
  cost: number; // ต้นทุน+ขนส่งของบรรทัด
  profit: number; // กำไรของบรรทัด
};

export async function getOrderCsvRows(orgId: string): Promise<OrderCsvRow[]> {
  const monthStart = startOfMonth();
  const orders = await prisma.order.findMany({
    where: {
      orgId,
      createdAt: { gte: monthStart },
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      orderNo: true,
      createdAt: true,
      customer: { select: { name: true } },
      items: {
        select: {
          productType: true,
          qtyLiters: true,
          costPerL: true,
          transportCostPerL: true,
          lineTotal: true,
          lineProfit: true,
        },
      },
    },
  });

  const rows: OrderCsvRow[] = [];
  for (const o of orders) {
    for (const it of o.items) {
      const liters = Number(it.qtyLiters);
      const cost = (Number(it.costPerL) + Number(it.transportCostPerL)) * liters;
      rows.push({
        date: o.createdAt,
        orderNo: o.orderNo,
        customer: o.customer.name,
        product: PRODUCT_LABELS[it.productType] ?? it.productType,
        liters,
        sell: Number(it.lineTotal),
        cost,
        profit: Number(it.lineProfit),
      });
    }
  }
  return rows;
}
