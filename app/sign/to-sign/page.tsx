// /sign/to-sign — "เซ็นทีละหลายฉบับ" (bulk sign) list page
// ────────────────────────────────────────────────────────────────────
// CEO Pinpoint #7 scope expansion (2026-10-13): the real ask behind "เซ็น
// ผ่านลิงก์ LINE" turned out to be "เซ็นครั้งเดียว ใช้ซ้ำได้ทุกฉบับ" — a
// saved signature (already live, see lib/docuflow/my-signature.ts) plus a
// way to sign MANY documents in one sitting instead of opening each one
// individually via /sign/[placementId].
//
// Route placement: deliberately a SIBLING of /sign/[placementId]
// (app/sign/to-sign/, not app/(admin)/docuflow/to-sign/) so it inherits
// the exact same access level as the single-document signer flow —
// `getSession()` only, no DocuFlow module-access gate. This matters
// because an externally-invited signer (invite-document-signer-button.tsx)
// gets an account scoped to ONE document and does NOT necessarily have
// DocuFlow module access — if this page lived under app/(admin)/docuflow/
// it would inherit that layout's `userHasModuleAccess` gate and 403 that
// signer. Next.js resolves the static `/sign/to-sign` segment before the
// dynamic `/sign/[placementId]` one, so there's no routing collision.
//
// Lists every DISTINCT document where the caller has ≥1 unsigned
// `signature`-type placement (auto-fill date/name/text placements are
// excluded — same reasoning /sign/[placementId] already uses: nothing
// for a human to act on there, and the sign endpoint would 400 on them).
// ────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getMySignatureUrl } from "@/lib/docuflow/my-signature";
import {
  ToSignList,
  type ToSignDocumentVm,
} from "@/components/docuflow/to-sign-list";

export const dynamic = "force-dynamic";

export default async function ToSignPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/sign/to-sign")}`);
  }
  const orgId = session.user.org_id;

  const [placementRows, savedSignatureUrl] = await Promise.all([
    prisma.documentSignaturePlacement.findMany({
      where: {
        orgId,
        signerUserId: session.user.id,
        signedAt: null,
        placementType: "signature",
        document: { isActive: true },
      },
      select: {
        id: true,
        documentId: true,
        pageNumber: true,
        label: true,
        document: {
          select: {
            id: true,
            name: true,
            uploadedAt: true,
            mimeType: true,
          },
        },
      },
      orderBy: [
        { document: { uploadedAt: "desc" } },
        { pageNumber: "asc" },
        { ordering: "asc" },
      ],
    }),
    getMySignatureUrl(session.user.id).catch(() => null),
  ]);

  // Group placements → one row per document (a document can carry more
  // than one placement for the same signer, e.g. page 1 and page 3).
  // Map preserves insertion order, and the query above already sorted by
  // document.uploadedAt desc, so the grouped list keeps that ordering.
  const grouped = new Map<string, ToSignDocumentVm>();
  for (const row of placementRows) {
    if (!row.document) continue;
    // Signing UI only ever handled PDFs — mirrors the same guard
    // /sign/[placementId]/page.tsx uses before rendering react-pdf.
    if (row.document.mimeType && row.document.mimeType !== "application/pdf") {
      continue;
    }
    const placement = {
      id: row.id,
      pageNumber: row.pageNumber,
      label: row.label,
    };
    const existing = grouped.get(row.documentId);
    if (existing) {
      existing.placements.push(placement);
    } else {
      grouped.set(row.documentId, {
        documentId: row.documentId,
        documentName: row.document.name,
        uploadedAt: row.document.uploadedAt.toISOString(),
        placements: [placement],
      });
    }
  }
  const documents = Array.from(grouped.values());

  return (
    <div className="min-h-dvh bg-zinc-50">
      <div className="max-w-2xl mx-auto p-3 sm:p-6 pb-24">
        <ToSignList documents={documents} savedSignatureUrl={savedSignatureUrl} />
      </div>
    </div>
  );
}
