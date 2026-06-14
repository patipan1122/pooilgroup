// RentSpace — server-side data fetchers (RSC only; layout gates access).
import { prisma } from "@/lib/prisma";
import { currentPeriod, toNum } from "@/lib/rentspace/format";

/** The pilot project for an org — first active project, auto-created none. */
export async function getPrimaryProject(orgId: string) {
  return prisma.rentalProject.findFirst({
    where: { orgId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listProjects(orgId: string) {
  return prisma.rentalProject.findMany({
    where: { orgId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getProject(orgId: string, projectId: string) {
  return prisma.rentalProject.findFirst({ where: { id: projectId, orgId } });
}

/** Units of a project with their active contract + tenant + outstanding bill state. */
export async function listUnitsWithState(orgId: string, projectId: string) {
  const units = await prisma.rentalUnit.findMany({
    where: { orgId, projectId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    include: {
      contracts: {
        where: { status: { in: ["active", "expiring"] } },
        orderBy: { startDate: "desc" },
        take: 1,
        include: { tenant: true },
      },
      bills: {
        where: { status: { in: ["issued", "partial", "overdue"] } },
        select: { id: true, totalAmount: true, paidAmount: true, status: true, period: true },
      },
    },
  });
  return units.map((u) => {
    const contract = u.contracts[0] ?? null;
    const outstanding = u.bills.reduce(
      (s, b) => s + (toNum(b.totalAmount) - toNum(b.paidAmount)),
      0,
    );
    const hasOverdue = u.bills.some((b) => b.status === "overdue");
    return {
      ...u,
      contract,
      tenant: contract?.tenant ?? null,
      outstanding,
      hasOverdue,
    };
  });
}

export async function getUnitDetail(orgId: string, unitId: string) {
  return prisma.rentalUnit.findFirst({
    where: { id: unitId, orgId },
    include: {
      project: true,
      contracts: {
        orderBy: { startDate: "desc" },
        include: { tenant: true, deposits: true },
      },
      meters: { include: { readings: { orderBy: { period: "desc" }, take: 6 } } },
      bills: {
        orderBy: { period: "desc" },
        take: 12,
        include: { payments: true },
      },
    },
  });
}

export async function listTenants(orgId: string, search?: string) {
  return prisma.rentalTenant.findMany({
    where: {
      orgId,
      isActive: true,
      ...(search
        ? {
            OR: [
              { bizName: { contains: search, mode: "insensitive" } },
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { idCardNo: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { contracts: { where: { status: "active" }, include: { unit: true } } },
  });
}

export async function getTenant(orgId: string, id: string) {
  return prisma.rentalTenant.findFirst({
    where: { id, orgId },
    include: {
      contracts: { include: { unit: true, project: true }, orderBy: { startDate: "desc" } },
    },
  });
}

export async function listContracts(orgId: string, projectId?: string) {
  return prisma.rentalContract.findMany({
    where: { orgId, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { unit: true, tenant: true, project: true },
  });
}

export async function getContract(orgId: string, id: string) {
  return prisma.rentalContract.findFirst({
    where: { id, orgId },
    include: { unit: true, tenant: true, project: true, template: true, deposits: true },
  });
}

export async function getContractBySignToken(token: string) {
  return prisma.rentalContract.findUnique({
    where: { signToken: token },
    include: { unit: true, tenant: true, project: true, template: true },
  });
}

/** All เงินประกัน movements across the org — newest first, with unit + tenant for display. */
export async function listDeposits(orgId: string) {
  return prisma.rentalDeposit.findMany({
    where: { orgId },
    orderBy: { occurredOn: "desc" },
    include: { contract: { include: { unit: true, tenant: true } } },
  });
}

export async function listTemplates(orgId: string) {
  return prisma.rentalContractTemplate.findMany({
    where: { orgId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

/** Meter board: every active unit + this-period readings for both kinds. */
export async function meterBoard(orgId: string, projectId: string, period: string) {
  const units = await prisma.rentalUnit.findMany({
    where: { orgId, projectId, isActive: true, status: { not: "inactive" } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    include: {
      meters: { include: { readings: { where: { period }, take: 1 } } },
      contracts: { where: { status: { in: ["active", "expiring"] } }, take: 1, include: { tenant: true } },
    },
  });
  return units;
}

export async function listBills(orgId: string, opts: { projectId?: string; status?: string; period?: string } = {}) {
  return prisma.rentalBill.findMany({
    where: {
      orgId,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.status ? { status: opts.status as never } : {}),
      ...(opts.period ? { period: opts.period } : {}),
    },
    orderBy: [{ period: "desc" }, { billNo: "desc" }],
    include: { unit: true, tenant: true, payments: true, discounts: true },
    take: 500,
  });
}

export async function getBill(orgId: string, id: string) {
  return prisma.rentalBill.findFirst({
    where: { id, orgId },
    include: {
      unit: true,
      tenant: true,
      project: true,
      contract: true,
      items: { orderBy: { sort: "asc" } },
      payments: { orderBy: { paidOn: "desc" } },
      discounts: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function listPayments(orgId: string, limit = 300) {
  return prisma.rentalPayment.findMany({
    where: { orgId },
    orderBy: { paidOn: "desc" },
    take: limit,
    include: { bill: { include: { unit: true, tenant: true } } },
  });
}

export async function pendingDiscounts(orgId: string) {
  return prisma.rentalDiscount.findMany({
    where: { orgId, status: "pending" },
    orderBy: { createdAt: "asc" },
    include: { bill: { include: { unit: true, tenant: true } } },
  });
}

/** Overview KPIs for the dashboard. */
export async function projectKpis(orgId: string, projectId: string) {
  const period = currentPeriod();
  const [units, occupied, vacant, overdueBills, thisMonthBills] = await Promise.all([
    prisma.rentalUnit.count({ where: { orgId, projectId, isActive: true } }),
    prisma.rentalUnit.count({ where: { orgId, projectId, isActive: true, status: "occupied" } }),
    prisma.rentalUnit.count({ where: { orgId, projectId, isActive: true, status: "vacant" } }),
    prisma.rentalBill.findMany({
      where: { orgId, projectId, status: { in: ["issued", "partial", "overdue"] } },
      select: { totalAmount: true, paidAmount: true, status: true },
    }),
    prisma.rentalBill.findMany({
      where: { orgId, projectId, period },
      select: { totalAmount: true, paidAmount: true },
    }),
  ]);
  const outstanding = overdueBills.reduce(
    (s, b) => s + (toNum(b.totalAmount) - toNum(b.paidAmount)),
    0,
  );
  const overdueCount = overdueBills.filter((b) => b.status === "overdue").length;
  const billedThisMonth = thisMonthBills.reduce((s, b) => s + toNum(b.totalAmount), 0);
  const collectedThisMonth = thisMonthBills.reduce((s, b) => s + toNum(b.paidAmount), 0);
  return { units, occupied, vacant, outstanding, overdueCount, billedThisMonth, collectedThisMonth, period };
}

/** Billing-cycle status for the current period (จดมิเตอร์ → ออกบิล → รับชำระ). */
export async function billingCycle(orgId: string, projectId: string, period = currentPeriod()) {
  // billable = units with an active/expiring contract
  const contracts = await prisma.rentalContract.findMany({
    where: { orgId, projectId, status: { in: ["active", "expiring"] } },
    select: { unitId: true },
  });
  const unitIds = [...new Set(contracts.map((c) => c.unitId))];
  const total = unitIds.length;

  const [readUnits, bills] = await Promise.all([
    prisma.rentalMeterReading.findMany({
      where: { orgId, period, unitId: { in: unitIds.length ? unitIds : ["00000000-0000-0000-0000-000000000000"] } },
      select: { unitId: true },
      distinct: ["unitId"],
    }),
    prisma.rentalBill.findMany({
      where: { orgId, projectId, period, status: { not: "void" } },
      select: { status: true },
    }),
  ]);
  const metersDone = readUnits.length;
  const billsDone = bills.filter((b) => b.status !== "draft").length;
  const paidCount = bills.filter((b) => b.status === "paid").length;
  return { period, total, metersDone, billsDone, paidCount };
}
