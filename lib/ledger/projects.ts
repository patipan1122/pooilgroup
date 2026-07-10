import "server-only";
import { prisma } from "@/lib/prisma";

// LedgerLine — โครงการชั่วคราว (job-costing · F2) read helpers. company-scoped เสมอ
// (Pooil ≠ JPS · [[feedback-ledger-query-must-filter-companyid]]). writes อยู่ใน _actions.ts.

export type LedgerProjectRow = {
  id: string;
  name: string;
  status: string; // active | archived
  budgetTotal: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  note: string | null;
};

function toRow(p: {
  id: string;
  name: string;
  status: string;
  budgetTotal: unknown;
  startedAt: Date | null;
  endedAt: Date | null;
  note: string | null;
}): LedgerProjectRow {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    budgetTotal: p.budgetTotal == null ? null : Number(p.budgetTotal),
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    note: p.note,
  };
}

/** โครงการทั้งหมดของบริษัท (active ก่อน · เรียงใหม่→เก่า). includeArchived=false = เฉพาะที่ยังทำอยู่. */
export async function listLedgerProjects(
  orgId: string,
  companyId: string,
  opts?: { includeArchived?: boolean },
): Promise<LedgerProjectRow[]> {
  const rows = await prisma.ledgerProject.findMany({
    where: {
      orgId,
      companyId,
      ...(opts?.includeArchived ? {} : { status: "active" }),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      status: true,
      budgetTotal: true,
      startedAt: true,
      endedAt: true,
      note: true,
    },
  });
  return rows.map(toRow);
}

/** โครงการเดียว (ตรวจ company scope). null = ไม่พบ/คนละบริษัท. */
export async function getLedgerProject(
  orgId: string,
  companyId: string,
  id: string,
): Promise<LedgerProjectRow | null> {
  const p = await prisma.ledgerProject.findFirst({
    where: { id, orgId, companyId },
    select: {
      id: true,
      name: true,
      status: true,
      budgetTotal: true,
      startedAt: true,
      endedAt: true,
      note: true,
    },
  });
  return p ? toRow(p) : null;
}
