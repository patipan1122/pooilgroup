// RentSpace — matrix (Excel-style) data builder for the yearly rent grid.
// One row per unit · one column per month · each cell = that unit's bill for that month.
import { prisma } from "@/lib/prisma";
import { toNum, tenantDisplayName } from "@/lib/rentspace/format";

export type MatrixUnit = {
  id: string;
  code: string;
  name: string | null;
  building: string | null;
  baseRent: number;
  tenantName: string | null;
};

export type MatrixCell = {
  period: string; // YYYY-MM
  rent: number;
  water: number;
  electric: number;
  other: number;
  lateFee: number;
  discount: number;
  vat: number;
  total: number;
  paid: number;
  status: string;
  billId: string;
};

export type RentMatrix = {
  units: MatrixUnit[];
  cells: Record<string, MatrixCell>; // key = `${unitId}|${YYYY-MM}`
  monthsTotals: number[]; // length 12, index 0 = ม.ค.
};

/**
 * Build the year matrix: every active unit (with its current tenant) × 12 months,
 * folding in any bills that exist for `${year}-MM`. Empty cell = no bill issued yet.
 */
export async function rentMatrix(
  orgId: string,
  projectId: string,
  year: number,
): Promise<RentMatrix> {
  const [unitRows, bills] = await Promise.all([
    prisma.rentalUnit.findMany({
      where: {
        orgId,
        projectId,
        isActive: true,
        status: { not: "inactive" },
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        building: true,
        baseRentThb: true,
        contracts: {
          where: { status: { in: ["active", "expiring"] } },
          orderBy: { startDate: "desc" },
          take: 1,
          select: {
            tenant: {
              select: {
                bizName: true,
                prefix: true,
                firstName: true,
                lastName: true,
                nickname: true,
              },
            },
          },
        },
      },
    }),
    prisma.rentalBill.findMany({
      where: { orgId, projectId, period: { startsWith: `${year}-` } },
      select: {
        id: true,
        unitId: true,
        period: true,
        status: true,
        rentAmount: true,
        electricAmount: true,
        waterAmount: true,
        otherAmount: true,
        lateFeeAmount: true,
        discountAmount: true,
        subtotal: true,
        vatAmount: true,
        totalAmount: true,
        paidAmount: true,
      },
    }),
  ]);

  const units: MatrixUnit[] = unitRows.map((u) => {
    const tenant = u.contracts[0]?.tenant ?? null;
    return {
      id: u.id,
      code: u.code,
      name: u.name,
      building: u.building,
      baseRent: toNum(u.baseRentThb),
      tenantName: tenant ? tenantDisplayName(tenant) : null,
    };
  });

  const cells: Record<string, MatrixCell> = {};
  const monthsTotals = new Array<number>(12).fill(0);

  for (const b of bills) {
    const cell: MatrixCell = {
      period: b.period,
      rent: toNum(b.rentAmount),
      water: toNum(b.waterAmount),
      electric: toNum(b.electricAmount),
      other: toNum(b.otherAmount),
      lateFee: toNum(b.lateFeeAmount),
      discount: toNum(b.discountAmount),
      vat: toNum(b.vatAmount),
      total: toNum(b.totalAmount),
      paid: toNum(b.paidAmount),
      status: b.status,
      billId: b.id,
    };
    cells[`${b.unitId}|${b.period}`] = cell;

    const monthIdx = Number(b.period.split("-")[1]) - 1; // YYYY-MM → 0..11
    if (monthIdx >= 0 && monthIdx < 12) monthsTotals[monthIdx] += cell.total;
  }

  return { units, cells, monthsTotals };
}
