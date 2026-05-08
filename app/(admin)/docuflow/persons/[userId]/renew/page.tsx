// /docuflow/persons/[userId]/renew?type=<docType> — renew a person document
// Admin tier only. Shows current doc info + new file/expiry form.

import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { PERSON_DOC_TYPE_LABEL } from "../../types";
import { BackButton } from "@/components/ui/back-button";
import { RenewDocForm } from "@/components/docuflow/renew-doc-form";
import { thaiDateLong } from "@/lib/utils/format";

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
    <div className="p-3 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24">
      <BackButton />
      <header className="mb-6 mt-4 animate-fade-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · ต่ออายุเอกสารบุคคล
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          ต่ออายุ{" "}
          <span className="text-gradient-blue">{docTypeCfg.label}</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          {person.name}{" "}
          {person.employeeCode && (
            <span className="text-zinc-500">· {person.employeeCode}</span>
          )}{" "}
          · {person.role}
        </p>
      </header>

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
    </div>
  );
}
