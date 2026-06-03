import { prisma } from "@/lib/prisma";
import type { PaymentStatus, ChequeStatus } from "@/lib/generated/prisma/enums";

// ---------- credit (tab 1) ----------
export type CreditRow = {
  id: string;
  name: string;
  zone: string | null;
  creditLimit: number | null;
  creditUsed: number;
  pct: number; // 0-100 (null limit → 0)
  paymentTerms: number | null;
  over90: boolean;
};

// รายชื่อลูกค้า + วงเงินเครดิต → เรียงตาม % ใช้ไปมาก→น้อย (ตัวเสี่ยงขึ้นก่อน)
export async function listCredit(orgId: string): Promise<CreditRow[]> {
  const rows = await prisma.customer.findMany({
    where: { orgId, isActive: true },
    orderBy: { name: "asc" },
    take: 500,
    select: {
      id: true,
      name: true,
      zone: true,
      creditLimit: true,
      creditUsed: true,
      paymentTerms: true,
    },
  });

  return rows
    .map((c) => {
      const limit = c.creditLimit != null ? Number(c.creditLimit) : null;
      const used = Number(c.creditUsed);
      const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
      return {
        id: c.id,
        name: c.name,
        zone: c.zone,
        creditLimit: limit,
        creditUsed: used,
        pct,
        paymentTerms: c.paymentTerms,
        over90: limit != null && used / limit > 0.9,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

// ---------- payments (tab 2) ----------
export type PaymentRow = {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  method: string;
  paymentDate: Date;
  reference: string | null;
  status: PaymentStatus;
  orderNo: string | null;
  hasOrder: boolean;
  verifiedByName: string | null;
  verifiedAt: Date | null;
};

// PENDING ขึ้นก่อนเสมอ (งานที่ต้องทำ) → แล้วเรียงตามวันที่ล่าสุด
export async function listPayments(orgId: string): Promise<PaymentRow[]> {
  const rows = await prisma.payment.findMany({
    where: { orgId },
    orderBy: [{ status: "asc" }, { paymentDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      customer: { select: { name: true } },
      order: { select: { orderNo: true } },
      verifiedBy: { select: { name: true } },
    },
  });

  // status asc = PENDING < REJECTED < VERIFIED ตามลำดับตัวอักษร enum;
  // จัดให้ PENDING มาก่อนแบบชัดเจน
  const order: Record<PaymentStatus, number> = { PENDING: 0, REJECTED: 1, VERIFIED: 2 };
  return rows
    .map((p) => ({
      id: p.id,
      customerId: p.customerId,
      customerName: p.customer.name,
      amount: Number(p.amount),
      method: p.method,
      paymentDate: p.paymentDate,
      reference: p.reference,
      status: p.status,
      orderNo: p.order?.orderNo ?? null,
      hasOrder: !!p.orderId,
      verifiedByName: p.verifiedBy?.name ?? null,
      verifiedAt: p.verifiedAt,
    }))
    .sort((a, b) => order[a.status] - order[b.status]);
}

// ---------- cheques (tab 3) ----------
export type ChequeRow = {
  id: string;
  customerId: string;
  customerName: string;
  chequeNumber: string;
  bank: string;
  amount: number;
  dueDate: Date;
  status: ChequeStatus;
  clearedAt: Date | null;
  bouncedReason: string | null;
};

// เช็คที่ใกล้ถึงกำหนด (PENDING) ขึ้นก่อน → เรียงตาม dueDate
export async function listCheques(orgId: string): Promise<ChequeRow[]> {
  const rows = await prisma.cheque.findMany({
    where: { orgId },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    take: 200,
    include: { customer: { select: { name: true } } },
  });

  const order: Record<ChequeStatus, number> = { PENDING: 0, BOUNCED: 1, CLEARED: 2 };
  return rows
    .map((c) => ({
      id: c.id,
      customerId: c.customerId,
      customerName: c.customer.name,
      chequeNumber: c.chequeNumber,
      bank: c.bank,
      amount: Number(c.amount),
      dueDate: c.dueDate,
      status: c.status,
      clearedAt: c.clearedAt,
      bouncedReason: c.bouncedReason,
    }))
    .sort((a, b) => order[a.status] - order[b.status]);
}

// ---------- customer dropdown (forms) ----------
export type CustomerOption = { id: string; name: string };

export async function listCustomerOptions(orgId: string): Promise<CustomerOption[]> {
  const rows = await prisma.customer.findMany({
    where: { orgId, isActive: true },
    orderBy: { name: "asc" },
    take: 500,
    select: { id: true, name: true },
  });
  return rows;
}

// สรุปยอดบนหัวหน้า
export async function getFinanceSummary(orgId: string) {
  const [pendingPayments, pendingCheques] = await Promise.all([
    prisma.payment.count({ where: { orgId, status: "PENDING" } }),
    prisma.cheque.count({ where: { orgId, status: "PENDING" } }),
  ]);
  return { pendingPayments, pendingCheques };
}
