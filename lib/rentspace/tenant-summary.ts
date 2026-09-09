// RentSpace — สรุปยอดค่าเช่าต่อ "เจ้า" (ห้อง+ผู้เช่า) ในช่วงเดือนที่เลือก. ใช้ทำ
// รายงานสรุป/ใบวางบิลรวม (export). ตัดบิล void/draft ออกเหมือนหน้า matrix (Excel
// view) — กันตัวเลขไม่ตรงกับที่ CEO เห็นอยู่บนตารางเดิม.
import { prisma } from "@/lib/prisma";
import { tenantDisplayName, toNum } from "@/lib/rentspace/format";

export type TenantSummaryRow = {
  unitId: string;
  unitCode: string;
  unitName: string | null;
  tenantId: string;
  tenantName: string;
  billCount: number;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
};

export type TenantSummaryReport = {
  rows: TenantSummaryRow[];
  totals: { billCount: number; totalBilled: number; totalPaid: number; totalOutstanding: number };
};

/**
 * รวมยอดค่าเช่าต่อ "ห้อง+ผู้เช่า" จากบิลทั้งหมดในช่วง fromPeriod..toPeriod
 * (YYYY-MM ทั้งคู่, inclusive). ถ้าห้องเปลี่ยนผู้เช่ากลางช่วง จะแยกเป็นคนละแถว
 * (คนละคู่สัญญาจริง ไม่ควรรวมยอดเข้าด้วยกัน). เรียงตามลำดับห้องเดียวกับตาราง
 * Excel matrix (matrixSortOrder ที่ CEO จัดเอง).
 */
export async function tenantRentSummary(
  orgId: string,
  projectId: string,
  fromPeriod: string,
  toPeriod: string,
): Promise<TenantSummaryReport> {
  const bills = await prisma.rentalBill.findMany({
    where: {
      orgId,
      projectId,
      period: { gte: fromPeriod, lte: toPeriod },
      status: { notIn: ["void", "draft"] },
    },
    include: {
      unit: { select: { id: true, code: true, name: true, matrixSortOrder: true, sortOrder: true } },
      tenant: { select: { bizName: true, prefix: true, firstName: true, lastName: true, nickname: true } },
    },
  });

  const byKey = new Map<string, TenantSummaryRow>();
  // ลำดับห้องเดียวกับตาราง Excel matrix (matrixSortOrder) — เก็บแยกจาก row
  // เพื่อไม่ให้ field ภายในหลุดเข้าไปในทรง TenantSummaryRow ที่ export ออกไปใช้
  const sortKeyByKey = new Map<string, [number, number, string]>();

  for (const b of bills) {
    if (!b.unit || !b.tenant) continue; // defensive: FK ต้องมีเสมอ แต่กันพังถ้าข้อมูลเพี้ยน
    const key = `${b.unitId}|${b.tenantId}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        unitId: b.unitId,
        unitCode: b.unit.code,
        unitName: b.unit.name,
        tenantId: b.tenantId,
        tenantName: tenantDisplayName(b.tenant),
        billCount: 0,
        totalBilled: 0,
        totalPaid: 0,
        totalOutstanding: 0,
      };
      byKey.set(key, row);
      sortKeyByKey.set(key, [b.unit.matrixSortOrder ?? Number.MAX_SAFE_INTEGER, b.unit.sortOrder, b.unit.code]);
    }
    const billed = toNum(b.totalAmount);
    const paid = toNum(b.paidAmount);
    row.billCount += 1;
    row.totalBilled += billed;
    row.totalPaid += paid;
    row.totalOutstanding += billed - paid;
  }

  const rows = [...byKey.entries()]
    .sort(([keyA], [keyB]) => {
      const a = sortKeyByKey.get(keyA)!;
      const b = sortKeyByKey.get(keyB)!;
      if (a[0] !== b[0]) return a[0] - b[0];
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[2].localeCompare(b[2]);
    })
    .map(([, row]) => row);

  const totals = rows.reduce(
    (acc, r) => ({
      billCount: acc.billCount + r.billCount,
      totalBilled: acc.totalBilled + r.totalBilled,
      totalPaid: acc.totalPaid + r.totalPaid,
      totalOutstanding: acc.totalOutstanding + r.totalOutstanding,
    }),
    { billCount: 0, totalBilled: 0, totalPaid: 0, totalOutstanding: 0 },
  );

  return { rows, totals };
}
