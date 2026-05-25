import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { thb, fmtDateTime } from "@/lib/playland/format";
import { Wallet, Phone, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ branchSlug: string; bookingId: string }> }) {
  const { branchSlug, bookingId } = await params;
  const booking = await prisma.playlandBooking.findFirst({
    where: { id: bookingId },
    include: { branch: true, package: true },
  });
  if (!booking || booking.branch.slug !== branchSlug) notFound();

  return (
    <div style={{ maxWidth: 540, margin: "0 auto", padding: "48px 20px" }}>
      <div className="pl-eyebrow" style={{ marginBottom: 8 }}>BOOKING · รอชำระเงิน</div>
      <h1 style={{ fontFamily: "var(--pl-font-display)", fontSize: "2.2rem", fontWeight: 500, letterSpacing: "-0.025em", marginBottom: 4 }}>{booking.bookingCode}</h1>
      <div style={{ color: "var(--pl-text-muted)", fontSize: 13, marginBottom: 24 }}>หมดอายุ 30 นาทีหลังจองหากไม่ชำระ</div>

      <div className="pl-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <Row label="สาขา" value={booking.branch.name} />
          <Row label="แพคเกจ" value={booking.package.name} />
          <Row label="วันเวลา" value={fmtDateTime(booking.slotStart)} />
          <Row label="ลูกค้า" value={`${booking.customerName} · ${booking.customerPhone}`} />
          <div className="pl-divider" />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: "var(--pl-text-muted)", fontSize: 12, fontFamily: "var(--pl-font-mono)" }}>ยอดชำระ</span>
            <span className="pl-stat-value" style={{ fontSize: "1.85rem" }}>{thb(booking.amountCents)}</span>
          </div>
        </div>
      </div>

      <div className="pl-card pl-card-accent">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
          <Wallet size={18} color="var(--pl-amber-700)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontFamily: "var(--pl-font-display)", fontWeight: 500, fontSize: "1rem", marginBottom: 4 }}>วิธีชำระเงิน</div>
            <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.7, color: "var(--pl-amber-900)" }}>
              <li>โอนเงิน <b className="pl-num">{thb(booking.amountCents)}</b> ตาม QR/เลขบัญชีของร้าน</li>
              <li>ส่ง slip ใน LINE หรือมาแสดงที่ร้าน</li>
              <li>เจ้าหน้าที่ confirm booking ภายใน 30 นาที</li>
            </ol>
          </div>
        </div>
      </div>

      {booking.branch.phone && (
        <a href={`tel:${booking.branch.phone}`} className="pl-btn pl-btn-lg" style={{ width: "100%", marginTop: 16 }}>
          <Phone size={14} /> โทรหาสาขา {booking.branch.phone}
        </a>
      )}

      <Link href={`/p/playland/${branchSlug}/book`} className="pl-btn pl-btn-ghost" style={{ width: "100%", marginTop: 8 }}>
        ← กลับไปจองใหม่
      </Link>
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
