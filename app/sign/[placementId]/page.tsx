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
//
// Auth-redirect: uses `getSession()` directly (not `requireSession()`)
// so an absent session round-trips back here via `/login?next=...`
// instead of landing on the generic post-login destination. This is
// localized to this one page — `requireSession()` itself is untouched
// and every other page that calls it keeps its existing behavior.
// ────────────────────────────────────────────────────────────────────

import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { getCachedAnalysis } from "@/lib/docuflow/ai-analyze";
import { getMySignatureUrl } from "@/lib/docuflow/my-signature";
import {
  SignerInterface,
  type SignerPlacementVm,
} from "@/components/docuflow/signer-interface";
import type { SignerPreviewPlacementVm } from "@/components/docuflow/signer-document-preview";
import { SignerRiskSummary } from "@/components/docuflow/signer-risk-summary";

export const dynamic = "force-dynamic";

export default async function SignerPage({
  params,
}: {
  params: Promise<{ placementId: string }>;
}) {
  const { placementId } = await params;

  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/sign/${placementId}`)}`);
  }
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

  const [pdfUrl, riskAnalysis, allPlacementRows, savedSignatureUrl] =
    await Promise.all([
      getSignedDownloadUrl(placement.document.fileKey).catch(() => null),
      getCachedAnalysis(placement.document.id, orgId).catch(() => null),
      // ALL placements on the document (not just this one) — the new
      // full-document preview needs to draw every signer's box.
      prisma.documentSignaturePlacement.findMany({
        where: { orgId, documentId: placement.documentId },
        orderBy: [{ pageNumber: "asc" }, { ordering: "asc" }],
        select: {
          id: true,
          pageNumber: true,
          xRatio: true,
          yRatio: true,
          widthRatio: true,
          heightRatio: true,
          placementType: true,
          signerName: true,
          signerUserId: true,
          signedAt: true,
        },
      }),
      getMySignatureUrl(session.user.id).catch(() => null),
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

  const allPlacements: SignerPreviewPlacementVm[] = allPlacementRows.map(
    (p) => ({
      id: p.id,
      pageNumber: p.pageNumber,
      xRatio: p.xRatio,
      yRatio: p.yRatio,
      widthRatio: p.widthRatio,
      heightRatio: p.heightRatio,
      placementType:
        (p.placementType as SignerPreviewPlacementVm["placementType"]) ??
        "signature",
      signerName: p.signerName,
      signerUserId: p.signerUserId,
      signedAt: p.signedAt ? p.signedAt.toISOString() : null,
    }),
  );

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
          placements={allPlacements}
          savedSignatureUrl={savedSignatureUrl}
          signerDisplayName={signerDisplayName}
        />
      </div>
    </div>
  );
}
