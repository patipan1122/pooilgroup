// Cashier-side: mark a pending booking as PAID after seeing slip
// Authenticated · requires cashier role

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier } from "@/lib/playland/role-guard";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const booking = await prisma.playlandBooking.findFirst({ where: { id: bookingId, orgId: session.user.org_id } });
  if (!booking) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (booking.status !== "PENDING") return NextResponse.json({ ok: false, error: `status is ${booking.status}` }, { status: 400 });

  // ยืนยันแบบ race-safe: สำเร็จเฉพาะถ้ายัง PENDING อยู่ (กดยืนยันซ้ำ/พร้อมกัน → ครั้งที่ 2 ไม่เขียนทับ/ไม่บันทึกเงินซ้ำ)
  const confirmed = await prisma.playlandBooking.updateMany({
    where: { id: bookingId, orgId: session.user.org_id, status: "PENDING" },
    data: { status: "PAID", paymentStatus: "paid", confirmedByUserId: session.user.id, confirmedAt: new Date() },
  });
  if (confirmed.count !== 1) {
    return NextResponse.json({ ok: false, error: "booking ถูกยืนยันไปแล้ว (อาจมีคนกดพร้อมกัน)" }, { status: 409 });
  }

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id, branchId: booking.branchId, actorUserId: session.user.id, actorRole: session.user.role,
      action: "booking.confirm", entityType: "PlaylandBooking", entityId: bookingId, category: "money",
    },
  });
  return NextResponse.json({ ok: true });
}
