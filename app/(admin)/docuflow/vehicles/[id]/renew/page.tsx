// /docuflow/vehicles/[id]/renew?type=<docType> — renew a vehicle document
// Admin tier only. Shows current doc info + new file/expiry form.

import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { VEHICLE_DOC_TYPES } from "@/lib/vehicles/data";
import { BackButton } from "@/components/ui/back-button";
import { RenewDocForm } from "@/components/docuflow/renew-doc-form";
import { thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function VehicleDocRenewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireSession();
  requireAdminTier(session.user.role);

  const { id } = await params;
  const sp = await searchParams;
  const docType = sp.type || "registration";

  const vehicle = await prisma.vehicle.findFirst({
    where: { id, orgId: session.user.org_id },
    select: {
      id: true,
      licensePlate: true,
      vehicleType: true,
    },
  });
  if (!vehicle) notFound();

  // Find the most recent VehicleDocument of this docType
  const currentLink = await prisma.vehicleDocument.findFirst({
    where: {
      orgId: session.user.org_id,
      vehicleId: id,
      docType,
    },
    orderBy: { createdAt: "desc" },
    include: {
      document: {
        select: {
          id: true,
          name: true,
          isActive: true,
        },
      },
    },
  });

  const docTypeCfg = VEHICLE_DOC_TYPES[docType] ?? {
    label: docType,
    short: docType,
  };

  const oldExpiryFormatted = currentLink?.expiryDate
    ? thaiDateLong(new Date(currentLink.expiryDate))
    : null;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24">
      <BackButton />
      <header className="mb-6 mt-4 animate-fade-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · ต่ออายุเอกสารรถ
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          ต่ออายุ{" "}
          <span className="text-gradient-blue">{docTypeCfg.label}</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          รถ <span className="font-bold">{vehicle.licensePlate}</span> ·{" "}
          {vehicle.vehicleType}
        </p>
      </header>

      <RenewDocForm
        entityType="vehicle"
        entityId={id}
        docType={docType}
        docTypeLabel={docTypeCfg.label}
        oldDocumentId={currentLink?.document.id ?? null}
        oldDocumentName={currentLink?.document.name ?? null}
        oldExpiryDate={oldExpiryFormatted}
        defaultName={`${docTypeCfg.label} - ${vehicle.licensePlate}`}
        redirectTo={`/docuflow/vehicles/${id}`}
      />
    </div>
  );
}
