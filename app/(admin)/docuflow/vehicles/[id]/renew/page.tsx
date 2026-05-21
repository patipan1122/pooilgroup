// /docuflow/vehicles/[id]/renew?type=<docType> — renew a vehicle document
// Admin tier only. Shows current doc info + new file/expiry form.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { VEHICLE_DOC_TYPES } from "@/lib/vehicles/data";
import { RenewDocForm } from "@/components/docuflow/renew-doc-form";
import { thaiDateLong } from "@/lib/utils/format";
import {
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
} from "@/components/docuflow/df-ui";

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
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <Link
        href={`/docuflow/vehicles/${id}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--df-muted)",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={14} />
        กลับเอกสารรถ
      </Link>

      <DfPageHeader
        eyebrow={<DfEyebrow>ต่ออายุเอกสารรถ</DfEyebrow>}
        title={
          <>
            ต่ออายุ <span style={{ color: "var(--df-brand)" }}>{docTypeCfg.label}</span>
          </>
        }
        description={
          <>
            รถ <b className="df-tnum">{vehicle.licensePlate}</b> · {vehicle.vehicleType}
            {oldExpiryFormatted && (
              <>
                {" "}· <DfPill tone="warn" small>หมดอายุเดิม {oldExpiryFormatted}</DfPill>
              </>
            )}
          </>
        }
      />

      <DfCard padding={24} className="df-fade-up df-fade-up-100">
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
      </DfCard>
    </div>
  );
}
