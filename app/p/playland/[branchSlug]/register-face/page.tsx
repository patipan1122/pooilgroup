// Public face register — mobile-optimized hero · LIFF-friendly
// Per [[playland-workshop-decisions]]: lets parent register face from home so
// arrival at branch is just a quick scan, not paperwork.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MobileFaceRegister } from "@/components/playland/mobile-face-register";
import { ScanFace, ShieldCheck, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MobileFaceRegisterPage({ params, searchParams }: { params: Promise<{ branchSlug: string }>; searchParams: Promise<{ booking?: string }> }) {
  const { branchSlug } = await params;
  const sp = await searchParams;
  const branch = await prisma.playlandBranch.findFirst({ where: { slug: branchSlug, active: true } });
  if (!branch) notFound();

  let booking = null;
  if (sp.booking) {
    booking = await prisma.playlandBooking.findFirst({
      where: { id: sp.booking, branchId: branch.id },
      include: { package: true },
    });
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "32px 20px 80px" }}>
      <header style={{ marginBottom: 28 }}>
        <div className="pl-eyebrow" style={{ marginBottom: 6 }}>{branch.name} · ลงทะเบียนหน้า</div>
        <h1 style={{
          fontFamily: "var(--pl-font-display)",
          fontSize: "2rem", fontWeight: 500,
          letterSpacing: "-0.025em", lineHeight: 1.1,
        }}>
          {booking ? "ลงทะเบียนหน้าก่อนมาถึงร้าน" : "ลงทะเบียนหน้าใหม่"}
        </h1>
        {booking && (
          <div style={{ marginTop: 10, padding: "10px 14px", background: "var(--pl-amber-50)", borderRadius: 10, fontSize: 13, color: "var(--pl-amber-900)" }}>
            <code style={{ fontFamily: "var(--pl-font-mono)", fontWeight: 600 }}>{booking.bookingCode}</code>
            <span style={{ marginLeft: 8 }}>· {booking.package.name}</span>
          </div>
        )}
      </header>

      {/* Trust benefits — show why customer should do this */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 28 }}>
        <Benefit icon={<ScanFace size={16} />} label="เข้าเร็ว" hint="สแกนหน้า 3 วินาที" />
        <Benefit icon={<Clock size={16} />} label="ไม่ต้องรอ" hint="ข้ามคิวเคาน์เตอร์" />
        <Benefit icon={<ShieldCheck size={16} />} label="ปลอดภัย" hint="ขอลบได้ทุกเมื่อ" />
      </div>

      <MobileFaceRegister
        branchId={branch.id}
        bookingId={booking?.id}
        customerName={booking?.customerName ?? ""}
        customerPhone={booking?.customerPhone ?? ""}
      />
    </div>
  );
}

function Benefit({ icon, label, hint }: { icon: React.ReactNode; label: string; hint: string }) {
  return (
    <div style={{ textAlign: "center", padding: "12px 6px", background: "var(--pl-paper)", border: "1px solid var(--pl-line)", borderRadius: 12 }}>
      <div style={{ display: "inline-flex", padding: 8, borderRadius: 999, background: "var(--pl-amber-50)", color: "var(--pl-amber-700)", marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--pl-text-muted)", marginTop: 2 }}>{hint}</div>
    </div>
  );
}
