import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicBookingForm } from "@/components/playland/public-booking-form";
import { MapPin, Phone } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PublicBookingPage({ params }: { params: Promise<{ branchSlug: string }> }) {
  const { branchSlug } = await params;
  const branch = await prisma.playlandBranch.findFirst({
    where: { slug: branchSlug, active: true },
    select: { id: true, orgId: true, name: true, slug: true, address: true, phone: true },
  });
  if (!branch) notFound();

  const packages = await prisma.playlandPackage.findMany({
    where: { orgId: branch.orgId, active: true, OR: [{ branchId: branch.id }, { branchId: null }] },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "48px 20px 80px" }}>
      <header style={{ marginBottom: 32, paddingBottom: 24, borderBottom: "1px solid var(--pl-line)" }}>
        <div className="pl-eyebrow" style={{ marginBottom: 8 }}>PLAYLAND · จองออนไลน์</div>
        <h1 style={{ fontFamily: "var(--pl-font-display)", fontSize: "2.4rem", fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: 12 }}>{branch.name}</h1>
        <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--pl-text-muted)" }}>
          {branch.address && <span><MapPin size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />{branch.address}</span>}
          {branch.phone && <span><Phone size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />{branch.phone}</span>}
        </div>
      </header>

      {packages.length === 0 ? (
        <div className="pl-card pl-empty">
          <div className="pl-empty-icon">⏳</div>
          <div className="pl-empty-title">ยังไม่มี package เปิดขาย</div>
          <div className="pl-empty-message">โปรดติดต่อสาขาโดยตรง</div>
        </div>
      ) : (
        <PublicBookingForm
          branchId={branch.id}
          branchSlug={branch.slug}
          packages={packages.map((p) => ({ id: p.id, name: p.name, description: p.description, type: p.type, minutes: p.minutes, price: p.price }))}
        />
      )}
    </div>
  );
}
