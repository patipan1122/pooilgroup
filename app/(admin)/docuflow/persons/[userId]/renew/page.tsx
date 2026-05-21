// /docuflow/persons/[userId]/renew?type=<docType> — renew a person document
// Admin tier only. Canvas-aligned chrome.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { PERSON_DOC_TYPE_LABEL } from "../../types";
import { RenewDocForm } from "@/components/docuflow/renew-doc-form";
import { thaiDateLong } from "@/lib/utils/format";
import {
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
} from "@/components/docuflow/df-ui";

export const dynamic = "force-dynamic";

export default async function PersonDocRenewPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireSession();
  requireAdminTier(session.user.role);

  const { userId } = await params;
  const sp = await searchParams;
  const docType = sp.type || "license";

  const person = await prisma.user.findFirst({
    where: { id: userId, orgId: session.user.org_id },
    select: {
      id: true,
      name: true,
      role: true,
      employeeCode: true,
    },
  });
  if (!person) notFound();

  const currentLink = await prisma.personDocument.findFirst({
    where: {
      orgId: session.user.org_id,
      userId,
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

  const docTypeCfg = {
    label: PERSON_DOC_TYPE_LABEL[docType] ?? docType,
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
        href={`/docuflow/persons/${userId}`}
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
        กลับเอกสารบุคคล
      </Link>

      <DfPageHeader
        eyebrow={<DfEyebrow>ต่ออายุเอกสารบุคคล</DfEyebrow>}
        title={
          <>
            ต่ออายุ{" "}
            <span style={{ color: "var(--df-brand)" }}>{docTypeCfg.label}</span>
          </>
        }
        description={
          <>
            {person.name}
            {person.employeeCode && (
              <>
                {" "}<span style={{ color: "var(--df-muted)" }}>· {person.employeeCode}</span>
              </>
            )}{" "}
            · {person.role}
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
          entityType="person"
          entityId={userId}
          docType={docType}
          docTypeLabel={docTypeCfg.label}
          oldDocumentId={currentLink?.document.id ?? null}
          oldDocumentName={currentLink?.document.name ?? null}
          oldExpiryDate={oldExpiryFormatted}
          defaultName={`${docTypeCfg.label} - ${person.name}`}
          redirectTo={`/docuflow/persons/${userId}`}
        />
      </DfCard>
    </div>
  );
}
