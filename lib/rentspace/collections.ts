// RentSpace — ห้องค้างชำระ (AR collection worklist) data fetcher.
// Rooms that still owe money, grouped by unit, sorted by amount owed (desc).
import { prisma } from "@/lib/prisma";
import { periodLabel, tenantDisplayName, toNum } from "@/lib/rentspace/format";

export type OverdueBill = {
  id: string;
  period: string;
  label: string;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  status: string;
  dueDate: string | null; // ISO yyyy-mm-dd for client serialization
  contractId: string | null;
};

export type OverdueUnit = {
  unitId: string;
  code: string;
  name: string | null;
  tenantName: string;
  totalOutstanding: number;
  bills: OverdueBill[];
};

/**
 * Every room in a project with unpaid bills (issued / partial / overdue),
 * grouped by unit, each room's bills oldest-first, rooms sorted by amount owed.
 * Optional `search` filters by unit code OR tenant name (case-insensitive, JS-side).
 * Always scoped by orgId + projectId (no cross-company leak).
 */
export async function overdueUnits(
  orgId: string,
  projectId: string,
  search?: string,
): Promise<OverdueUnit[]> {
  const bills = await prisma.rentalBill.findMany({
    where: {
      orgId,
      projectId,
      status: { in: ["issued", "partial", "overdue"] },
    },
    orderBy: [{ unitId: "asc" }, { period: "asc" }],
    include: {
      unit: { select: { id: true, code: true, name: true, status: true } },
      contract: { include: { tenant: true } },
    },
  });

  // group by unit
  const byUnit = new Map<string, OverdueUnit>();
  for (const b of bills) {
    if (!b.unit) continue; // defensive: bill without a unit is non-actionable here
    const outstanding = toNum(b.totalAmount) - toNum(b.paidAmount);
    if (outstanding <= 0) continue; // fully paid but not yet marked → not a collection target

    let room = byUnit.get(b.unit.id);
    if (!room) {
      room = {
        unitId: b.unit.id,
        code: b.unit.code,
        name: b.unit.name,
        tenantName: b.contract?.tenant ? tenantDisplayName(b.contract.tenant) : "—",
        totalOutstanding: 0,
        bills: [],
      };
      byUnit.set(b.unit.id, room);
    }
    // first contract/tenant we meet for the room wins (already null-safe default "—")
    if (room.tenantName === "—" && b.contract?.tenant) {
      room.tenantName = tenantDisplayName(b.contract.tenant);
    }
    room.bills.push({
      id: b.id,
      period: b.period,
      label: periodLabel(b.period),
      totalAmount: toNum(b.totalAmount),
      paidAmount: toNum(b.paidAmount),
      outstanding,
      status: b.status as string,
      dueDate: b.dueDate ? b.dueDate.toISOString().slice(0, 10) : null,
      contractId: b.contractId ?? null,
    });
    room.totalOutstanding += outstanding;
  }

  let rooms = [...byUnit.values()];

  // search filter (JS-side, case-insensitive) on code OR tenant name
  const q = (search ?? "").trim().toLowerCase();
  if (q) {
    rooms = rooms.filter(
      (r) =>
        r.code.toLowerCase().includes(q) || r.tenantName.toLowerCase().includes(q),
    );
  }

  rooms.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  return rooms;
}

/** Summary across rooms: number of rooms owing + grand total outstanding. */
export function collectionsSummary(rooms: OverdueUnit[]): {
  roomCount: number;
  grandTotal: number;
} {
  return {
    roomCount: rooms.length,
    grandTotal: rooms.reduce((s, r) => s + r.totalOutstanding, 0),
  };
}
