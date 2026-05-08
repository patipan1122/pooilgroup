// /sign/[placementId] — Public-ish signer page
// ────────────────────────────────────────────────────────────────────
// Loads the placement + its document, validates that:
//   - placement exists and is in the caller's org
//   - if placement.signerUserId is set, caller's user.id matches
//   - if only signerName is set, any signed-in user in the same org
//     can sign (link-based access — caller still has to be logged in
//     via Pooilgroup auth so we have an audit trail)
//
// We require login universally because Pooilgroup's audit log + multi-
// tenant isolation depend on having a session. For external counter-
// parties, the workflow is to invite them as a `viewer` user first
// (out of scope for this MVP; the same model still works once that
// flow is added).
// ────────────────────────────────────────────────────────────────────

import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { getCachedAnalysis } from "@/lib/docuflow/ai-analyze";
import {
  SignerInterface,
  type SignerPlacementVm,
} from "@/components/docuflow/signer-interface";
import { SignerRiskSummary } from "@/components/docuflow/signer-risk-summary";

export const dynamic = "force-dynamic";

export default async function SignerPage({
  params,
}: {
  params: Promise<{ placementId: string }>;
}) {
  const { placementId } = await params;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const placement = await prisma.documentSignaturePlacement.findFirst({
    where: { id: placementId, orgId },
    include: {
      document: {
        select: {
          id: true,
          name: true,
          fileKey: true,
          mimeType: true,
          isActive: true,
        },
      },
      signerUser: { select: { id: true, name: true } },
    },
  });

  if (!placement || !placement.document?.isActive) notFound();
  if (
    placement.document.mimeType &&
    placement.document.mimeType !== "application/pdf"
  ) {
    notFound();
  }

  // Auto-fill placements (date / name / text) are stamped by the system
  // at embed time — there is nothing for a human to do on this page.
  // Send the user back to the document detail.
  if (placement.placementType && placement.placementType !== "signature") {
    redirect(`/docuflow/documents/${placement.documentId}`);
  }

  // Auth:
  //   - signerUserId set → locks the link to that exact user
  //   - signerUserId null → fallback (typically counterparty handled by admin):
  //     restrict to admin tier to prevent any logged-in org user from signing
  //     sensitive admin docs via an open placement.
  if (placement.signerUserId) {
    if (placement.signerUserId !== session.user.id) {
      redirect("/403");
    }
  } else if (!isAdminTier(session.user.role)) {
    redirect("/403");
  }

  const [pdfUrl, riskAnalysis] = await Promise.all([
    getSignedDownloadUrl(placement.document.fileKey).catch(() => null),
    getCachedAnalysis(placement.document.id, orgId).catch(() => null),
  ]);
  if (!pdfUrl) notFound();

  const vm: SignerPlacementVm = {
    id: placement.id,
    documentId: placement.documentId,
    pageNumber: placement.pageNumber,
    xRatio: placement.xRatio,
    yRatio: placement.yRatio,
    widthRatio: placement.widthRatio,
    heightRatio: placement.heightRatio,
    placementType:
      (placement.placementType as
        | "signature"
        | "date"
        | "name"
        | "text") ?? "signature",
    autoFillValue: placement.autoFillValue,
    signerRole: placement.signerRole,
    label: placement.label,
    signedAt: placement.signedAt ? placement.signedAt.toISOString() : null,
    signerName: placement.signerName,
  };

  const signerDisplayName =
    placement.signerUser?.name ||
    placement.signerName ||
    session.user.name ||
    "ผู้เซ็น";

  return (
    <div className="min-h-dvh bg-zinc-50">
      <div className="max-w-2xl mx-auto p-3 sm:p-6 pb-24">
        <SignerRiskSummary analysis={riskAnalysis} />
        <SignerInterface
          documentId={placement.document.id}
          documentName={placement.document.name}
          pdfUrl={pdfUrl}
          placement={vm}
          signerDisplayName={signerDisplayName}
        />
      </div>
    </div>
  );
}
