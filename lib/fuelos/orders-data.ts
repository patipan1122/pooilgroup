import { prisma } from "@/lib/prisma";
import type { OrderStatus } from "@/lib/generated/prisma/enums";

// 4 คอลัมน์บอร์ด Kanban (ไม่รวม CANCELLED — ออเดอร์ที่ยกเลิกหลุดจากบอร์ด)
export const BOARD_STATUSES: OrderStatus[] = [
  "AWAITING_CONFIRM",
  "DELIVERING",
  "DELIVERED_UNPAID",
  "CLOSED",
];

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; tone: string; column?: string }
> = {
  AWAITING_CONFIRM: { label: "รอจัดส่ง", tone: "bg-surface-2 text-zinc-600", column: "รอจัดส่ง" },
  DELIVERING: { label: "กำลังส่ง", tone: "bg-info/10 text-info", column: "กำลังส่ง" },
  DELIVERED_UNPAID: { label: "ส่งแล้ว/รอเก็บเงิน", tone: "bg-warning/15 text-warning", column: "ส่งแล้ว/รอเก็บเงิน" },
  CLOSED: { label: "ปิดบิล", tone: "bg-leaf-100 text-leaf-700", column: "ปิดบิล" },
  CANCELLED: { label: "ยกเลิก", tone: "bg-danger/10 text-danger" },
};

// ลำดับ flow การเดินสถานะ (เดินหน้าได้ทีละขั้น)
const STATUS_FLOW: OrderStatus[] = [
  "AWAITING_CONFIRM",
  "DELIVERING",
  "DELIVERED_UNPAID",
  "CLOSED",
];

export function nextStatus(s: OrderStatus): OrderStatus | null {
  const i = STATUS_FLOW.indexOf(s);
  if (i < 0 || i >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[i + 1];
}

export function isForwardStep(from: OrderStatus, to: OrderStatus): boolean {
  const a = STATUS_FLOW.indexOf(from);
  const b = STATUS_FLOW.indexOf(to);
  return a >= 0 && b >= 0 && b === a + 1;
}

export type BoardCard = {
  id: string;
  orderNo: string;
  customerName: string;
  totalLiters: number;
  subtotal: number;
  profit: number;
  scheduledDate: Date | null;
  status: OrderStatus;
};

// ดึงออเดอร์ทั้งหมดบนบอร์ด → จัดกลุ่มตามสถานะ
export async function listOrdersBoard(orgId: string) {
  const rows = await prisma.order.findMany({
    where: { orgId, status: { in: BOARD_STATUSES } },
    orderBy: [{ scheduledDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 500,
    include: {
      customer: { select: { name: true } },
      items: { select: { qtyLiters: true } },
    },
  });

  const cards: BoardCard[] = rows.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    customerName: o.customer.name,
    totalLiters: o.items.reduce((s, it) => s + Number(it.qtyLiters), 0),
    subtotal: Number(o.subtotal),
    profit: Number(o.totalProfit),
    scheduledDate: o.scheduledDate,
    status: o.status,
  }));

  const columns = BOARD_STATUSES.map((status) => ({
    status,
    label: ORDER_STATUS_META[status].column ?? ORDER_STATUS_META[status].label,
    cards: cards.filter((c) => c.status === status),
  }));

  return { columns, total: cards.length };
}

// รายละเอียดออเดอร์ + ลูกค้า + items + การอนุมัติเครดิต + รถที่เลือกได้
export async function getOrder(orgId: string, id: string) {
  const order = await prisma.order.findFirst({
    where: { id, orgId },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          legalName: true,
          zone: true,
          phone: true,
          creditLimit: true,
          creditUsed: true,
          paymentTerms: true,
        },
      },
      location: { select: { name: true, address: true } },
      sales: { select: { name: true } },
      truck: { select: { id: true, plate: true, status: true } },
      items: true,
      approval: {
        include: {
          requestedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!order) return null;

  const trucks = await prisma.truck.findMany({
    where: { orgId, isActive: true },
    orderBy: { plate: "asc" },
    select: { id: true, plate: true, status: true, capacityLiters: true },
  });

  const subtotal = Number(order.subtotal);
  const creditLimit = order.customer.creditLimit ? Number(order.customer.creditLimit) : null;
  const creditUsed = Number(order.customer.creditUsed);

  // วงเงินที่จะใช้ "รวมออเดอร์นี้" (ออเดอร์ยังเปิดอยู่ → ยอดนี้ยังไม่ถูกบวกใน creditUsed)
  const projectedUsed = creditUsed + subtotal;
  const overLimit = creditLimit != null && projectedUsed > creditLimit;
  const amountOver = overLimit && creditLimit != null ? Math.round((projectedUsed - creditLimit) * 100) / 100 : 0;

  return {
    order,
    trucks,
    credit: {
      creditLimit,
      creditUsed,
      subtotal,
      projectedUsed,
      overLimit,
      amountOver,
      overrideApproved: order.creditOverride,
    },
  };
}
