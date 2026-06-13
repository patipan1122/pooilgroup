// RentSpace — billing engine (server-only). Shared by the monthly cron and
// the manual "ออกบิล" action. Idempotent per (contractId, period); race-safe
// bill numbering via unique-constraint retry (per [[ledgerline-arch-review-86fixes]]).
import { prisma } from "@/lib/prisma";
import { prevPeriod, toNum } from "@/lib/rentspace/format";
import type { Prisma } from "@/lib/generated/prisma/client";

type Contract = Prisma.RentalContractGetPayload<{ include: { project: true; unit: true } }>;

export type RentScheduleEntry = { fromPeriod: string; amount: number };

/** effective monthly rent for a period, honouring rentSchedule escalation */
export function effectiveRent(contract: Contract, period: string): number {
  const base = toNum(contract.rentAmountThb);
  const sched = contract.rentSchedule as unknown as RentScheduleEntry[] | null;
  if (!Array.isArray(sched) || sched.length === 0) return base;
  const applicable = sched
    .filter((e) => e && e.fromPeriod && e.fromPeriod <= period)
    .sort((a, b) => (a.fromPeriod < b.fromPeriod ? -1 : 1));
  return applicable.length ? toNum(applicable[applicable.length - 1].amount) : base;
}

/** INV{YYYYMM}{seq6} — unique per org. Computes next seq from existing bills. */
async function nextBillNo(orgId: string, period: string): Promise<string> {
  const prefix = `INV${period.replace("-", "")}`;
  const last = await prisma.rentalBill.findFirst({
    where: { orgId, billNo: { startsWith: prefix } },
    orderBy: { billNo: "desc" },
    select: { billNo: true },
  });
  const lastSeq = last ? Number(last.billNo.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(6, "0")}`;
}

function dueDateFor(period: string, dueDay: number): Date {
  const [y, m] = period.split("-").map(Number);
  const day = Math.min(Math.max(dueDay || 5, 1), 28);
  return new Date(Date.UTC(y, m - 1, day));
}

function issueDateFor(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

export type BuiltBill = {
  rentAmount: number;
  electricAmount: number;
  waterAmount: number;
  lateFeeAmount: number;
  items: { kind: string; label: string; qty: number; unitPrice: number; amount: number; sort: number }[];
  notes: string[];
};

/** Compute amounts + line items for one contract+period (reads meters + prior bill). */
export async function buildBill(contract: Contract, period: string): Promise<BuiltBill> {
  const notes: string[] = [];
  const items: BuiltBill["items"] = [];

  // 1) rent
  const rentAmount = effectiveRent(contract, period);
  items.push({ kind: "rent", label: "ค่าเช่า", qty: 1, unitPrice: rentAmount, amount: rentAmount, sort: 1 });

  // 2) electric + water from meter readings of this period
  const readings = await prisma.rentalMeterReading.findMany({
    where: { unitId: contract.unitId, period },
  });
  const elec = readings.find((r) => r.kind === "electric");
  const water = readings.find((r) => r.kind === "water");
  const electricAmount = elec ? toNum(elec.amountThb) : 0;
  const waterAmount = water ? toNum(water.amountThb) : 0;
  if (elec) {
    items.push({
      kind: "electric",
      label: `ค่าไฟ ${toNum(elec.usage)} หน่วย × ${toNum(elec.ratePerUnit)}`,
      qty: toNum(elec.usage),
      unitPrice: toNum(elec.ratePerUnit),
      amount: electricAmount,
      sort: 2,
    });
  } else notes.push("ยังไม่ได้จดมิเตอร์ไฟเดือนนี้");
  if (water) {
    items.push({
      kind: "water",
      label: `ค่าน้ำ ${toNum(water.usage)} หน่วย × ${toNum(water.ratePerUnit)}`,
      qty: toNum(water.usage),
      unitPrice: toNum(water.ratePerUnit),
      amount: waterAmount,
      sort: 3,
    });
  } else notes.push("ยังไม่ได้จดมิเตอร์น้ำเดือนนี้");

  // 3) late fee from prior unpaid bill
  let lateFeeAmount = 0;
  const prior = await prisma.rentalBill.findFirst({
    where: {
      contractId: contract.id,
      period: prevPeriod(period),
      status: { in: ["issued", "partial", "overdue"] },
    },
  });
  if (prior) {
    const outstanding = toNum(prior.totalAmount) - toNum(prior.paidAmount);
    if (outstanding > 0 && contract.lateFeeType !== "none") {
      if (contract.lateFeeType === "fixed") lateFeeAmount = toNum(contract.lateFeeValue);
      else if (contract.lateFeeType === "percent_total")
        lateFeeAmount = Math.round(outstanding * (toNum(contract.lateFeeValue) / 100) * 100) / 100;
      else if (contract.lateFeeType === "per_day") {
        const days = Math.max(
          0,
          Math.floor((Date.now() - new Date(prior.dueDate).getTime()) / 86400000),
        );
        const capped = Math.min(days, 60);
        lateFeeAmount = capped * toNum(contract.lateFeeValue);
      }
      if (lateFeeAmount > 0) {
        items.push({
          kind: "late_fee",
          label: `ค่าปรับล่าช้า (บิลค้าง ${prevPeriod(period)})`,
          qty: 1,
          unitPrice: lateFeeAmount,
          amount: lateFeeAmount,
          sort: 4,
        });
        notes.push(`มีบิลค้างจ่าย ${prevPeriod(period)} → คิดค่าปรับ`);
      }
    }
  }

  return { rentAmount, electricAmount, waterAmount, lateFeeAmount, items, notes };
}

/** Recompute subtotal/vat/total/status from items + approved discounts + payments. */
export async function recomputeBillTotals(billId: string): Promise<void> {
  const bill = await prisma.rentalBill.findUnique({
    where: { id: billId },
    include: { discounts: true },
  });
  if (!bill) return;
  const discountAmount = bill.discounts
    .filter((d) => d.status === "approved")
    .reduce((s, d) => s + toNum(d.computedAmount), 0);
  const subtotal =
    toNum(bill.rentAmount) +
    toNum(bill.electricAmount) +
    toNum(bill.waterAmount) +
    toNum(bill.otherAmount) +
    toNum(bill.lateFeeAmount) -
    discountAmount;
  const vatPercentRow = await prisma.rentalContract.findUnique({
    where: { id: bill.contractId },
    select: { vatPercent: true },
  });
  const vatPercent = toNum(vatPercentRow?.vatPercent);
  const vatAmount = Math.round(subtotal * (vatPercent / 100) * 100) / 100;
  const totalAmount = subtotal + vatAmount;
  const paid = toNum(bill.paidAmount);
  let status = bill.status;
  if (bill.status !== "void" && bill.status !== "draft") {
    if (paid >= totalAmount && totalAmount > 0) status = "paid";
    else if (paid > 0) status = "partial";
    else if (new Date(bill.dueDate).getTime() < Date.now()) status = "overdue";
    else status = "issued";
  }
  await prisma.rentalBill.update({
    where: { id: billId },
    data: { discountAmount, subtotal, vatAmount, totalAmount, status },
  });
}

/**
 * Create (or return existing) a bill for one contract+period. Idempotent via
 * @@unique([contractId, period]); race-safe billNo via retry on P2002.
 */
export async function createBillForContract(
  contract: Contract,
  period: string,
  opts: { actorId?: string | null; auto?: boolean; issue?: boolean } = {},
): Promise<{ created: boolean; billId: string }> {
  const existing = await prisma.rentalBill.findUnique({
    where: { contractId_period: { contractId: contract.id, period } },
    select: { id: true },
  });
  if (existing) return { created: false, billId: existing.id };

  const built = await buildBill(contract, period);
  const vatPercent = toNum(contract.vatPercent);
  const subtotal =
    built.rentAmount + built.electricAmount + built.waterAmount + built.lateFeeAmount;
  const vatAmount = Math.round(subtotal * (vatPercent / 100) * 100) / 100;
  const totalAmount = subtotal + vatAmount;
  const status = opts.issue === false ? "draft" : "issued";

  for (let attempt = 0; attempt < 5; attempt++) {
    const billNo = await nextBillNo(contract.orgId, period);
    try {
      const bill = await prisma.rentalBill.create({
        data: {
          orgId: contract.orgId,
          projectId: contract.projectId,
          unitId: contract.unitId,
          contractId: contract.id,
          tenantId: contract.tenantId,
          billNo,
          period,
          issueDate: issueDateFor(period),
          dueDate: dueDateFor(period, contract.rentDueDay),
          status,
          rentAmount: built.rentAmount,
          electricAmount: built.electricAmount,
          waterAmount: built.waterAmount,
          lateFeeAmount: built.lateFeeAmount,
          subtotal,
          vatAmount,
          totalAmount,
          note: built.notes.join(" · ") || null,
          autoGenerated: !!opts.auto,
          createdBy: opts.actorId ?? null,
          items: { create: built.items },
        },
      });
      return { created: true, billId: bill.id };
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "P2002") {
        const msg = String((e as { message?: string })?.message ?? "");
        // contract+period clash → another worker created it; return that one
        if (msg.includes("contract_id") || msg.includes("contractId")) {
          const row = await prisma.rentalBill.findUnique({
            where: { contractId_period: { contractId: contract.id, period } },
            select: { id: true },
          });
          if (row) return { created: false, billId: row.id };
        }
        // billNo clash → retry with a fresh sequence
        continue;
      }
      throw e;
    }
  }
  throw new Error("ออกบิลไม่สำเร็จ — เลขบิลชนกันหลายครั้ง");
}
