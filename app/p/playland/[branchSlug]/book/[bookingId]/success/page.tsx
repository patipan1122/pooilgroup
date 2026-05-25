// Stripe success callback · marks booking as PAID

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { thb, fmtDateTime } from "@/lib/playland/format";
import { CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SuccessPage({ params, searchParams }: { params: Promise<{ branchSlug: string; bookingId: string }>; searchParams: Promise<{ session_id?: string }> }) {
  const { branchSlug, bookingId } = await params;
  const sp = await searchParams;
  const booking = await prisma.playlandBooking.findFirst({
    where: { id: bookingId },
    include: { branch: true, package: true },
  });
  if (!booking || booking.branch.slug !== branchSlug) notFound();

  // If stripe returned session_id, optimistically mark as PAID
  // (proper flow: stripe webhook does this · this is fallback for missing webhook)
  if (sp.session_id && booking.status === "PENDING") {
    await prisma.playlandBooking.update({
      where: { id: booking.id },
      data: { status: "PAID", paymentStatus: "paid", paymentRef: sp.session_id },
    });
    booking.status = "PAID";
  }

  return (
    <div style={{ maxWidth: 540, margin: "0 auto", padding: "48px 16px", textAlign: "center" }}>
      <CheckCircle2 size={64} color="var(--pl-ok)" style={{ margin: "0 auto 16px" }} />
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>จองสำเร็จ!</h1>
      <p style={{ color: "var(--pl-text-muted)", marginBottom: 24 }}>เก็บ booking code นี้ไว้แสดงที่ร้าน</p>

      <div className="pl-card" style={{ textAlign: "left" }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 1, textAlign: "center", color: "var(--pl-brand-dark)", marginBottom: 12 }}>{booking.bookingCode}</div>
        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <div><span style={{ color: "var(--pl-text-muted)" }}>สาขา:</span> {booking.branch.name}</div>
          <div><span style={{ color: "var(--pl-text-muted)" }}>แพคเกจ:</span> {booking.package.name}</div>
          <div><span style={{ color: "var(--pl-text-muted)" }}>วัน-เวลา:</span> {fmtDateTime(booking.slotStart)}</div>
          <div><span style={{ color: "var(--pl-text-muted)" }}>ลูกค้า:</span> {booking.customerName}</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>{thb(booking.amountCents)} {booking.status === "PAID" && <span className="pl-chip pl-chip-ok" style={{ marginLeft: 8 }}>ชำระแล้ว</span>}</div>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <Link href={`/p/playland/${branchSlug}/register-face?booking=${booking.id}`} className="pl-btn pl-btn-primary" style={{ padding: "10px 20px" }}>
          ลงทะเบียนหน้าก่อนมาถึงร้าน →
        </Link>
        <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 8 }}>
          ลงทะเบียนหน้าผ่านมือถือนี้ก่อน · ที่ร้านจะเข้าได้เลยโดยไม่ต้องลงทะเบียนใหม่
        </div>
      </div>
    </div>
  );
}
