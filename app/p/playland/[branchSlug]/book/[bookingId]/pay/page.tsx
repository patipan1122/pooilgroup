// Fallback payment page when Stripe isn't configured
// Shows booking summary + "I have paid via PromptPay slip" button for staff to confirm later

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { thb, fmtDateTime } from "@/lib/playland/format";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ branchSlug: string; bookingId: string }> }) {
  const { branchSlug, bookingId } = await params;
  const booking = await prisma.playlandBooking.findFirst({
    where: { id: bookingId },
    include: { branch: true, package: true },
  });
  if (!booking || booking.branch.slug !== branchSlug) notFound();

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>BOOKING</div>
      <h1 style={{ margin: "4px 0 16px" }}>{booking.bookingCode}</h1>

      <div className="pl-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <div><span style={{ color: "var(--pl-text-muted)" }}>สาขา:</span> {booking.branch.name}</div>
          <div><span style={{ color: "var(--pl-text-muted)" }}>แพคเกจ:</span> {booking.package.name}</div>
          <div><span style={{ color: "var(--pl-text-muted)" }}>วัน-เวลา:</span> {fmtDateTime(booking.slotStart)}</div>
          <div><span style={{ color: "var(--pl-text-muted)" }}>ลูกค้า:</span> {booking.customerName} · {booking.customerPhone}</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>{thb(booking.amountCents)}</div>
        </div>
      </div>

      <div className="pl-card" style={{ background: "var(--pl-brand-soft)", color: "var(--pl-brand-ink)", marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>วิธีชำระเงิน</div>
        <ol style={{ paddingLeft: 18, margin: 0, fontSize: 14, lineHeight: 1.7 }}>
          <li>โอนเงินตามจำนวน <b>{thb(booking.amountCents)}</b> มาที่บัญชี/QR ของร้าน</li>
          <li>ส่ง slip ใน LINE หรือมาแสดงที่ร้าน</li>
          <li>เจ้าหน้าที่จะ confirm booking ภายใน 30 นาที</li>
          <li>ระบบจะ expire booking ถ้าไม่ confirm ใน 30 นาที</li>
        </ol>
      </div>

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <Link href={`/p/playland/${branchSlug}/book`} className="pl-btn">← กลับไปจองใหม่</Link>
      </div>
    </div>
  );
}
