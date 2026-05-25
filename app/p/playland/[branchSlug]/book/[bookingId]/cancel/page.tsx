import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { XCircle, ArrowLeft, RotateCcw } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CancelPage({ params }: { params: Promise<{ branchSlug: string; bookingId: string }> }) {
  const { branchSlug, bookingId } = await params;
  const booking = await prisma.playlandBooking.findFirst({
    where: { id: bookingId },
    include: { branch: true, package: true },
  });
  // booking may exist as PENDING still (cancel just means payment flow aborted)
  if (!booking || booking.branch.slug !== branchSlug) notFound();

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "64px 20px", textAlign: "center" }}>
      <div style={{
        width: 80, height: 80, borderRadius: 40, margin: "0 auto 20px",
        background: "linear-gradient(135deg, var(--pl-danger-soft), #fecaca)",
        display: "grid", placeItems: "center",
        boxShadow: "0 8px 24px rgba(220, 38, 38, 0.12)",
      }}>
        <XCircle size={40} color="var(--pl-danger)" />
      </div>

      <div className="pl-eyebrow" style={{ marginBottom: 8 }}>การชำระเงินถูกยกเลิก</div>
      <h1 style={{ fontFamily: "var(--pl-font-display)", fontSize: "2rem", fontWeight: 500, letterSpacing: "-0.025em", marginBottom: 8 }}>
        ยังไม่มีการเรียกเก็บเงิน
      </h1>
      <p style={{ color: "var(--pl-text-muted)", marginBottom: 24, lineHeight: 1.55 }}>
        การจอง <code style={{ background: "var(--pl-ink-100)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--pl-font-mono)", fontSize: 12 }}>{booking.bookingCode}</code> ยัง <b>ไม่ confirmed</b> · ระบบจะเก็บไว้ 30 นาที · ลองจ่ายใหม่ได้
      </p>

      <div className="pl-card pl-card-accent" style={{ textAlign: "left", marginBottom: 20 }}>
        <div className="pl-eyebrow" style={{ marginBottom: 8 }}>การจองนี้ยังรออยู่</div>
        <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <Row label="สาขา" value={booking.branch.name} />
          <Row label="แพคเกจ" value={booking.package.name} />
          <Row label="วันเวลา" value={new Date(booking.slotStart).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} />
          <Row label="ลูกค้า" value={booking.customerName} />
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <Link href={`/p/playland/${branchSlug}/book/${booking.id}/pay`} className="pl-btn pl-btn-primary pl-btn-lg">
          <RotateCcw size={16} /> ลองชำระอีกครั้ง
        </Link>
        <Link href={`/p/playland/${branchSlug}/book`} className="pl-btn pl-btn-ghost">
          <ArrowLeft size={14} /> จองใหม่ตั้งแต่แรก
        </Link>
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
