// Public face registration via mobile web
// Mode 1: from booking (?booking=...) — link face to booking's pending member
// Mode 2: standalone — just upload face for future use

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MobileFaceRegister } from "@/components/playland/mobile-face-register";

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
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "32px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{branch.name} · ลงทะเบียนหน้าผ่านมือถือ</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 16px" }}>{booking ? `Booking ${booking.bookingCode}` : "ลงทะเบียนหน้าใหม่"}</h1>
      <MobileFaceRegister branchId={branch.id} bookingId={booking?.id} customerName={booking?.customerName ?? ""} customerPhone={booking?.customerPhone ?? ""} />
    </div>
  );
}
