// Shared "เอกสารรอเซ็น" (pending-signature) query — single source of truth
// for the Prisma query + grouping logic used by BOTH:
//   - app/sign/to-sign/page.tsx (web bulk-sign page)
//   - app/api/telegram/webapp/to-sign/route.ts (Telegram Mini App)
// ────────────────────────────────────────────────────────────────────
// Extracted 2026-10-16 (DocuFlow Telegram Mini App) so the two callers
// can never drift into two different definitions of "what's pending" —
// see [[feedback-one-rule-two-copies-drifts-2026-09-23]] for why a
// copy-pasted query/filter is a recurring bug class here.
//
// Lists every DISTINCT document where `userId` has ≥1 unsigned
// `signature`-type placement (auto-fill date/name/text placements are
// excluded — nothing for a human to act on there, and the sign endpoint
// 400s on them anyway). Only PDFs are included — the signing UI never
// handled any other mime type.
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

export interface ToSignPlacementVm {
  id: string;
  pageNumber: number;
  label: string | null;
}

export interface ToSignDocumentVm {
  documentId: string;
  documentName: string;
  /** ISO timestamp */
  uploadedAt: string;
  placements: ToSignPlacementVm[];
}

export async function getToSignDocuments(
  orgId: string,
  userId: string,
): Promise<ToSignDocumentVm[]> {
  const placementRows = await prisma.documentSignaturePlacement.findMany({
    where: {
      orgId,
      signerUserId: userId,
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
  });

  // Group placements → one row per document (a document can carry more
  // than one placement for the same signer, e.g. page 1 and page 3).
  // Map preserves insertion order, and the query above already sorted by
  // document.uploadedAt desc, so the grouped list keeps that ordering.
  const grouped = new Map<string, ToSignDocumentVm>();
  for (const row of placementRows) {
    if (!row.document) continue;
    // Signing UI only ever handled PDFs.
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
  return Array.from(grouped.values());
}
