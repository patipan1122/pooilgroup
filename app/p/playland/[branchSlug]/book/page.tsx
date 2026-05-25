// Public booking form — no auth
// Slug-based branch lookup → public package list → contact info → Stripe/PromptPay

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicBookingForm } from "@/components/playland/public-booking-form";

export const dynamic = "force-dynamic";

export default async function PublicBookingPage({ params }: { params: Promise<{ branchSlug: string }> }) {
  const { branchSlug } = await params;
  const branch = await prisma.playlandBranch.findFirst({
    where: { slug: branchSlug, active: true },
    select: { id: true, orgId: true, name: true, slug: true, address: true, phone: true },
  });
  if (!branch) notFound();

  const packages = await prisma.playlandPackage.findMany({
    where: {
      orgId: branch.orgId,
      active: true,
      OR: [{ branchId: branch.id }, { branchId: null }],
    },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: "var(--pl-text-muted)", letterSpacing: 0.5 }}>PLAYLAND ONLINE BOOKING</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 6px" }}>{branch.name}</h1>
        {branch.address && <div style={{ fontSize: 14, color: "var(--pl-text-muted)" }}>{branch.address}</div>}
        {branch.phone && <div style={{ fontSize: 14, color: "var(--pl-text-muted)" }}>{branch.phone}</div>}
      </header>

      {packages.length === 0 ? (
        <div className="pl-card pl-empty">ยังไม่มี package เปิดขาย</div>
      ) : (
        <PublicBookingForm
          branchId={branch.id}
          branchSlug={branch.slug}
          packages={packages.map((p) => ({
            id: p.id, name: p.name, description: p.description, type: p.type, minutes: p.minutes, price: p.price,
          }))}
        />
      )}
    </div>
  );
}
