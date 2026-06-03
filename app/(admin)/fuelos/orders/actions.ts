"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";
import { isForwardStep } from "@/lib/fuelos/orders-data";
import type { OrderStatus } from "@/lib/generated/prisma/enums";

type ActionResult = { ok: true } | { ok: false; error: string };

// โหลดออเดอร์ของ org เดียวกัน (กัน cross-org)
async function loadOrder(orgId: string, id: string) {
  return prisma.order.findFirst({ where: { id, orgId } });
}

// เดินสถานะไปข้างหน้าทีละขั้น: AWAITING→DELIVERING→DELIVERED_UNPAID→CLOSED
export async function advanceOrderStatus(id: string, status: OrderStatus): Promise<ActionResult> {
  const user = await requireUser();
  const order = await loadOrder(user.orgId, id);
  if (!order) return { ok: false, error: "ไม่พบออเดอร์" };
  if (order.status === "CANCELLED") return { ok: false, error: "ออเดอร์ถูกยกเลิกแล้ว" };
  if (!isForwardStep(order.status, status)) return { ok: false, error: "เดินสถานะข้ามขั้นไม่ได้" };

  // ยืนยัน "ส่งถึง" = งานฝ่ายจัดส่ง → กันพนักงานขาย/คนอื่นกดยืนยันเอง
  if (status === "DELIVERED_UNPAID" && !atLeast(user.role, "DISPATCH") && order.driverId !== user.id) {
    return { ok: false, error: "เฉพาะฝ่ายจัดส่งหรือคนขับที่รับงานนี้เท่านั้นที่ยืนยันการส่งถึงได้" };
  }

  // ยืนยันจัดส่ง (ออกจาก AWAITING) → กันเกินวงเงินฝั่ง server (ไม่เชื่อ client)
  if (order.status === "AWAITING_CONFIRM" && status === "DELIVERING") {
    const cust = await prisma.customer.findFirst({
      where: { id: order.customerId, orgId: user.orgId },
      select: { creditLimit: true, creditUsed: true },
    });
    if (cust?.creditLimit != null) {
      const projected = Number(cust.creditUsed) + Number(order.subtotal);
      if (projected > Number(cust.creditLimit) && !order.creditOverride) {
        return { ok: false, error: "ยอดเกินวงเงินเครดิต — ต้องขออนุมัติก่อนจัดส่ง" };
      }
    }
  }

  if (status === "DELIVERED_UNPAID") {
    // ส่งถึง = หนี้เกิดจริง → บวก creditUsed แบบ atomic (กัน double-charge ถ้าถูกเรียกซ้ำ/ชนกับฝ่ายจัดส่ง)
    await prisma.$transaction(async (tx) => {
      const flipped = await tx.order.updateMany({
        where: { id, orgId: user.orgId, status: { not: "DELIVERED_UNPAID" } },
        data: { status, deliveredAt: new Date() },
      });
      if (flipped.count === 1) {
        await tx.customer.updateMany({
          where: { id: order.customerId, orgId: user.orgId },
          data: { creditUsed: { increment: Number(order.subtotal) } },
        });
      }
    });
  } else {
    await prisma.order.updateMany({ where: { id, orgId: user.orgId }, data: { status } });
  }

  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "ORDER_STATUS_ADVANCE",
    entity: "Order",
    entityId: id,
    meta: { from: order.status, to: status },
  });
  revalidatePath("/fuelos/orders");
  revalidatePath(`/fuelos/orders/${id}`);
  return { ok: true };
}

// ยกเลิกออเดอร์ (หลุดจากบอร์ด) — ปิดบิลแล้วยกเลิกไม่ได้
export async function cancelOrder(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const order = await loadOrder(user.orgId, id);
  if (!order) return { ok: false, error: "ไม่พบออเดอร์" };
  // เฉพาะหัวหน้าขายขึ้นไป หรือเซลล์เจ้าของออเดอร์ ถึงยกเลิกได้
  if (!atLeast(user.role, "SALES_HEAD") && order.salesId !== user.id) {
    return { ok: false, error: "ไม่มีสิทธิ์ยกเลิกออเดอร์นี้" };
  }
  if (order.status === "CLOSED") return { ok: false, error: "ปิดบิลแล้วยกเลิกไม่ได้" };
  if (order.status === "CANCELLED") return { ok: true };

  await prisma.order.updateMany({ where: { id, orgId: user.orgId }, data: { status: "CANCELLED" } });
  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "ORDER_CANCEL",
    entity: "Order",
    entityId: id,
    meta: { from: order.status },
  });
  revalidatePath("/fuelos/orders");
  revalidatePath(`/fuelos/orders/${id}`);
  return { ok: true };
}

// มอบหมายรถ + วันนัดส่ง
export async function assignTruck(
  id: string,
  truckId: string | null,
  scheduledDate: string | null,
): Promise<ActionResult> {
  const user = await requireUser();
  const order = await loadOrder(user.orgId, id);
  if (!order) return { ok: false, error: "ไม่พบออเดอร์" };

  // กันเลือกรถข้ามองค์กร
  if (truckId) {
    const truck = await prisma.truck.findFirst({ where: { id: truckId, orgId: user.orgId, isActive: true } });
    if (!truck) return { ok: false, error: "ไม่พบรถที่เลือก" };
  }

  await prisma.order.updateMany({
    where: { id, orgId: user.orgId },
    data: {
      truckId: truckId || null,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
    },
  });
  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "ORDER_ASSIGN_TRUCK",
    entity: "Order",
    entityId: id,
    meta: { truckId, scheduledDate },
  });
  revalidatePath("/fuelos/orders");
  revalidatePath(`/fuelos/orders/${id}`);
  return { ok: true };
}

// ขออนุมัติขายเกินวงเงิน → สร้าง CreditApproval(PENDING)
export async function requestCreditApproval(orderId: string, note: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!atLeast(user.role, "SALES")) return { ok: false, error: "ไม่มีสิทธิ์ขออนุมัติ" };
  const order = await prisma.order.findFirst({
    where: { id: orderId, orgId: user.orgId },
    include: { customer: { select: { creditLimit: true, creditUsed: true } } },
  });
  if (!order) return { ok: false, error: "ไม่พบออเดอร์" };

  const creditLimit = order.customer.creditLimit ? Number(order.customer.creditLimit) : null;
  if (creditLimit == null) return { ok: false, error: "ลูกค้ารายนี้ไม่ได้ตั้งวงเงินเครดิต" };

  const projectedUsed = Number(order.customer.creditUsed) + Number(order.subtotal);
  const amountOver = Math.round((projectedUsed - creditLimit) * 100) / 100;
  if (amountOver <= 0) return { ok: false, error: "ยอดออเดอร์ยังไม่เกินวงเงิน ไม่ต้องขออนุมัติ" };

  // กันรีเซ็ตคำขอที่อนุมัติไปแล้วกลับเป็น PENDING
  const existing = await prisma.creditApproval.findFirst({ where: { orderId, orgId: user.orgId }, select: { status: true } });
  if (existing?.status === "APPROVED") return { ok: false, error: "ออเดอร์นี้ได้รับอนุมัติแล้ว" };

  // 1 ออเดอร์ = 1 คำขอ (orderId unique) → upsert กลับมาเป็น PENDING ได้ถ้าเคยถูกปฏิเสธ
  await prisma.creditApproval.upsert({
    where: { orderId },
    create: {
      orgId: user.orgId,
      orderId,
      requestedById: user.id,
      status: "PENDING",
      amountOver,
      note: note || null,
    },
    update: {
      status: "PENDING",
      requestedById: user.id,
      amountOver,
      note: note || null,
      approvedById: null,
      actedAt: null,
    },
  });
  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "CREDIT_APPROVAL_REQUEST",
    entity: "CreditApproval",
    entityId: orderId,
    meta: { amountOver },
  });
  revalidatePath(`/fuelos/orders/${orderId}`);
  return { ok: true };
}

// อนุมัติ/ปฏิเสธคำขอขายเกินวงเงิน (เฉพาะ OWNER ขึ้นไป)
export async function actCreditApproval(orderId: string, approve: boolean): Promise<ActionResult> {
  const user = await requireUser();
  if (!atLeast(user.role, "OWNER")) {
    return { ok: false, error: "เฉพาะเจ้าของกิจการ (OWNER) เท่านั้นที่อนุมัติได้" };
  }
  const approval = await prisma.creditApproval.findFirst({
    where: { orderId, orgId: user.orgId },
  });
  if (!approval) return { ok: false, error: "ไม่พบคำขออนุมัติ" };
  if (approval.status !== "PENDING") return { ok: false, error: "คำขอนี้ถูกดำเนินการไปแล้ว" };

  await prisma.$transaction([
    prisma.creditApproval.update({
      where: { orderId },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        approvedById: user.id,
        actedAt: new Date(),
      },
    }),
    // อนุมัติ → ปลดล็อกขายเกินวงเงินบนออเดอร์ (scope orgId กันข้ามองค์กร)
    prisma.order.updateMany({
      where: { id: orderId, orgId: user.orgId },
      data: { creditOverride: approve },
    }),
  ]);
  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: approve ? "CREDIT_APPROVAL_APPROVE" : "CREDIT_APPROVAL_REJECT",
    entity: "CreditApproval",
    entityId: orderId,
    meta: { amountOver: Number(approval.amountOver) },
  });
  revalidatePath(`/fuelos/orders/${orderId}`);
  return { ok: true };
}
