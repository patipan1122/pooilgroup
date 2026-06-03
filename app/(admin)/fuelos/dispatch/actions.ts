"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";

// เฉพาะฝ่ายจัดส่งขึ้นไป (DISPATCH/FINANCE/SALES_HEAD/ADMIN/OWNER) + คนขับ
// จัดรถได้เฉพาะ DISPATCH ขึ้นไป
async function requireDispatch() {
  const user = await requireUser();
  if (!atLeast(user.role, "DISPATCH")) {
    throw new Error("ไม่มีสิทธิ์จัดรถ (เฉพาะฝ่ายจัดส่งขึ้นไป)");
  }
  return user;
}

// จับรถให้ออเดอร์ → ออเดอร์เข้าสถานะ "กำลังจัดส่ง" + ล็อกวันส่ง
export async function assignTruck(
  orderId: string,
  truckId: string,
  scheduledDate: string,
): Promise<{ ok: boolean }> {
  const user = await requireDispatch();

  const order = await prisma.order.findFirst({
    where: { id: orderId, orgId: user.orgId },
    select: { id: true, status: true },
  });
  if (!order) throw new Error("ไม่พบออเดอร์");
  if (order.status !== "AWAITING_CONFIRM") throw new Error("ออเดอร์นี้จัดรถไปแล้ว");

  const truck = await prisma.truck.findFirst({
    where: { id: truckId, orgId: user.orgId, isActive: true },
    select: { id: true, currentDriverId: true },
  });
  if (!truck) throw new Error("ไม่พบรถ");

  await prisma.$transaction([
    prisma.order.updateMany({
      where: { id: orderId, orgId: user.orgId },
      data: {
        truckId,
        driverId: truck.currentDriverId ?? null,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        status: "DELIVERING",
      },
    }),
    prisma.truck.updateMany({ where: { id: truckId, orgId: user.orgId }, data: { status: "DISPATCHED" } }),
  ]);

  await audit({
    orgId: user.orgId, userId: user.id, action: "DISPATCH_ASSIGN",
    entity: "Order", entityId: orderId, meta: { truckId, scheduledDate },
  });
  revalidatePath("/fuelos/dispatch");
  return { ok: true };
}

// ยืนยันส่งถึง → DELIVERED_UNPAID + บันทึกเวลา/พิกัด/รูป + ปล่อยรถกลับว่าง
export async function markDelivered(
  orderId: string,
  lat?: number,
  lng?: number,
  photoKey?: string,
): Promise<{ ok: boolean }> {
  const user = await requireUser();

  const order = await prisma.order.findFirst({
    where: { id: orderId, orgId: user.orgId },
    select: { id: true, status: true, truckId: true, driverId: true, customerId: true, subtotal: true },
  });
  if (!order) throw new Error("ไม่พบออเดอร์");
  // ยืนยันส่งได้: ฝ่ายจัดส่งขึ้นไป หรือคนขับที่รับงานนี้
  const canDeliver = atLeast(user.role, "DISPATCH") || order.driverId === user.id;
  if (!canDeliver) throw new Error("ไม่มีสิทธิ์ยืนยันการส่ง");
  if (order.status !== "DELIVERING") throw new Error("ออเดอร์นี้ยังไม่ได้อยู่ระหว่างจัดส่ง");

  // ส่งถึง = หนี้เกิดจริง → บวก creditUsed แบบ atomic (กัน double-charge)
  await prisma.$transaction(async (tx) => {
    const flipped = await tx.order.updateMany({
      where: { id: orderId, orgId: user.orgId, status: "DELIVERING" },
      data: {
        status: "DELIVERED_UNPAID",
        deliveredAt: new Date(),
        ...(lat != null && Number.isFinite(lat) ? { deliveryLat: lat } : {}),
        ...(lng != null && Number.isFinite(lng) ? { deliveryLng: lng } : {}),
        ...(photoKey ? { deliveryPhotoKey: photoKey } : {}),
      },
    });
    if (flipped.count === 1) {
      await tx.customer.updateMany({
        where: { id: order.customerId, orgId: user.orgId },
        data: { creditUsed: { increment: Number(order.subtotal) } },
      });
    }
  });

  // ปล่อยรถกลับสถานะว่าง (IDLE) ถ้ารถคันนี้ไม่มีออเดอร์อื่นที่ยังส่งอยู่
  if (order.truckId) {
    const stillDelivering = await prisma.order.count({
      where: { orgId: user.orgId, truckId: order.truckId, status: "DELIVERING" },
    });
    if (stillDelivering === 0) {
      await prisma.truck.updateMany({ where: { id: order.truckId, orgId: user.orgId }, data: { status: "IDLE" } });
    }
  }

  await audit({
    orgId: user.orgId, userId: user.id, action: "DISPATCH_DELIVERED",
    entity: "Order", entityId: orderId, meta: { lat, lng, photoKey },
  });
  revalidatePath("/fuelos/dispatch");
  return { ok: true };
}
