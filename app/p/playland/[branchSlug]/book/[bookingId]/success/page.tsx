import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { thb, fmtDateTime } from "@/lib/playland/format";
import { CheckCircle2, ScanFace, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SuccessPage({ params, searchParams }: { params: Promise<{ branchSlug: string; bookingId: string }>; searchParams: Promise<{ session_id?: string }> }) {
  const { branchSlug, bookingId } = await params;
  const sp = await searchParams;
  const booking = await prisma.playlandBooking.findFirst({
    where: { id: bookingId },
    include: { branch: true, package: true },
  });
  if (!booking || booking.branch.slug !== branchSlug) notFound();

  if (sp.session_id && booking.status === "PENDING") {
    await prisma.playlandBooking.update({
      where: { id: booking.id },
      data: { status: "PAID", paymentStatus: "paid", paymentRef: sp.session_id },
    });
    booking.status = "PAID";
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "64px 20px", textAlign: "center" }}>
      <div style={{
        width: 80, height: 80, borderRadius: 40, margin: "0 auto 20px",
        background: "linear-gradient(135deg, var(--pl-ok-soft), #bbf7d0)",
        display: "grid", placeItems: "center",
        boxShadow: "0 8px 24px rgba(21, 128, 61, 0.15)",
      }}>
        <CheckCircle2 size={40} color="var(--pl-ok)" />
      </div>

      <div className="pl-eyebrow" style={{ marginBottom: 8 }}>BOOKING CONFIRMED</div>
      <h1 style={{ fontFamily: "var(--pl-font-display)", fontSize: "2.2rem", fontWeight: 500, letterSpacing: "-0.025em", marginBottom: 6 }}>เก็บ Booking Code นี้</h1>
      <p style={{ color: "var(--pl-text-muted)", marginBottom: 28 }}>แสดงที่เคาน์เตอร์เพื่อ check-in</p>

      <div className="pl-card pl-card-accent" style={{ textAlign: "left", marginBottom: 24 }}>
        <div style={{
          fontFamily: "var(--pl-font-display)",
          fontSize: "2.4rem", fontWeight: 600,
          letterSpacing: "0.06em",
          textAlign: "center",
          color: "var(--pl-brand-dark)",
          padding: "12px 0 16px",
          borderBottom: "1px dashed var(--pl-amber-400)",
          marginBottom: 14,
        }}>
          {booking.bookingCode}
        </div>
        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <Row label="สาขา" value={booking.branch.name} />
          <Row label="แพคเกจ" value={booking.package.name} />
          <Row label="วันเวลา" value={fmtDateTime(booking.slotStart)} />
          <Row label="ลูกค้า" value={booking.customerName} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
            <span className="pl-stat-value" style={{ fontSize: "1.5rem" }}>{thb(booking.amountCents)}</span>
            {booking.status === "PAID" && <span className="pl-chip pl-chip-ok">ชำระแล้ว</span>}
          </div>
        </div>
      </div>

      <Link href={`/p/playland/${branchSlug}/register-face?booking=${booking.id}`} className="pl-btn pl-btn-primary pl-btn-lg" style={{ width: "100%" }}>
        <ScanFace size={18} /> ลงทะเบียนหน้าก่อนมาถึง <ArrowRight size={14} />
      </Link>
      <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 10 }}>
        ลงทะเบียนผ่านมือถือนี้ก่อน · เข้าร้านสแกนหน้าได้เลย ไม่ต้องรอที่เคาน์เตอร์
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--pl-text-muted)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
