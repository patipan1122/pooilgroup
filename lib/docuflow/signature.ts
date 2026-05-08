// DocuFlow — Signature embedding (Capability I)
// ────────────────────────────────────────────────────────────────────
// Server-side flow that takes signed-image PNGs from R2, opens the
// original PDF (also in R2), and uses pdf-lib to draw each signature
// at its placement coordinates. Output is a brand-new PDF stored at
// `documents/{orgId}/{docId}/signed-{ts}.pdf` and every placement's
// `signedFileKey` is updated to point to it.
//
// Coordinate convention:
//   - UI stores normalized 0..1 ratios with TOP-LEFT origin (matches
//     what react-pdf renders / what HTML overlays use).
//   - pdf-lib uses BOTTOM-LEFT origin → `convertCoords` flips Y.
// ────────────────────────────────────────────────────────────────────

import { PDFDocument } from "pdf-lib";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { R2_BUCKET, r2 } from "@/lib/r2/client";
import { putObject } from "@/lib/r2/upload";
import { prisma } from "@/lib/prisma";

/**
 * Convert a UI-normalized rectangle (top-left origin, 0..1 ratios)
 * into pdf-lib's coordinate system (bottom-left origin, absolute pts).
 */
export function convertCoords(
  xRatio: number,
  yRatio: number,
  widthRatio: number,
  heightRatio: number,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const width = widthRatio * pageWidth;
  const height = heightRatio * pageHeight;
  const x = xRatio * pageWidth;
  // Flip Y: top-edge in UI → bottom-edge in pdf-lib.
  // UI top edge is yRatio*H from the top → that's (H - yRatio*H) from
  // the bottom. The image is drawn from its bottom-left corner, so we
  // subtract its height to get the bottom edge of the box.
  const y = pageHeight - yRatio * pageHeight - height;
  return { x, y, width, height };
}

/**
 * Download an R2 object as a Buffer. Streams the SDK response to a
 * Uint8Array so it can be passed directly into pdf-lib.embedPng or
 * loadPdf.
 */
async function downloadR2(key: string): Promise<Uint8Array> {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  const out = await r2.send(cmd);
  // SDK Body is a stream-like; use transformToByteArray when available.
  // The recent v3 SDK exposes transformToByteArray on the Body type.
  // Fall back to manual stream collection if not present.
  const body = out.Body as unknown as {
    transformToByteArray?: () => Promise<Uint8Array>;
  } | null;
  if (!body) throw new Error(`R2 object empty: ${key}`);
  if (typeof body.transformToByteArray === "function") {
    return body.transformToByteArray();
  }
  // Manual fallback (Node Readable)
  const chunks: Buffer[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of body as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Build the canonical R2 key for the FINAL signed PDF.
 * Uses a timestamp suffix so re-runs produce a fresh artifact and the
 * old one stays available for audit.
 */
export function buildSignedPdfKey(orgId: string, documentId: string): string {
  return `documents/${orgId}/${documentId}/signed-${Date.now()}.pdf`;
}

/**
 * Result of a successful embed run.
 */
export interface EmbedSignaturesResult {
  /** R2 key of the produced signed PDF. */
  signedFileKey: string;
  /** Number of signature placements that were successfully drawn. */
  placedCount: number;
  /** Total placements considered (including any that were skipped). */
  totalCount: number;
  /**
   * True if this call short-circuited because another concurrent run
   * already produced the signed PDF for this document version. Caller
   * should treat this as a no-op success (not an error).
   */
  skipped?: boolean;
}

/**
 * Generate the final signed PDF for a document.
 *
 * Reads every placement that already has `signedAt` + `signedImageKey`,
 * draws those signatures into the original PDF, uploads the result,
 * and stamps `signedFileKey` on every involved placement so the UI can
 * link to the same artifact.
 *
 * Idempotent — calling it twice for a fully-signed document just makes
 * a fresh artifact (older versions remain in R2).
 *
 * @returns null if the document does not exist or has no completed
 *          signatures yet.
 */
export async function embedSignatures(
  documentId: string,
  orgId: string,
): Promise<EmbedSignaturesResult | null> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, orgId, isActive: true },
    select: { id: true, fileKey: true },
  });
  if (!doc) return null;

  // Race guard #1 (fast path): if a concurrent signer already produced the
  // signed PDF for this document, short-circuit before doing any heavy work.
  const existingFast = await prisma.documentSignaturePlacement.findFirst({
    where: { orgId, documentId, signedFileKey: { not: null } },
    select: { signedFileKey: true },
  });
  if (existingFast?.signedFileKey) {
    return {
      signedFileKey: existingFast.signedFileKey,
      placedCount: 0,
      totalCount: 0,
      skipped: true,
    };
  }

  const placements = await prisma.documentSignaturePlacement.findMany({
    where: {
      orgId,
      documentId,
      signedAt: { not: null },
      signedImageKey: { not: null },
    },
    orderBy: { pageNumber: "asc" },
  });
  if (placements.length === 0) return null;

  // Load original PDF
  const pdfBytes = await downloadR2(doc.fileKey);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();

  let placed = 0;
  for (const p of placements) {
    if (!p.signedImageKey) continue;
    const pageIdx = p.pageNumber - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) {
      // Out-of-range page (doc replaced after placement?) — skip safely
      continue;
    }
    const page = pages[pageIdx];
    const { width: pw, height: ph } = page.getSize();

    // Embed signature image. We assume PNG output from the canvas
    // (matches our /sign endpoint contract).
    let img;
    try {
      const imgBytes = await downloadR2(p.signedImageKey);
      img = await pdfDoc.embedPng(imgBytes);
    } catch (err) {
      console.error(
        `[embedSignatures] failed to embed signature ${p.id}`,
        err,
      );
      continue;
    }

    const rect = convertCoords(
      p.xRatio,
      p.yRatio,
      p.widthRatio,
      p.heightRatio,
      pw,
      ph,
    );
    page.drawImage(img, rect);
    placed += 1;
  }

  if (placed === 0) {
    return {
      signedFileKey: "",
      placedCount: 0,
      totalCount: placements.length,
    };
  }

  const out = await pdfDoc.save();
  const signedKey = buildSignedPdfKey(orgId, documentId);
  await putObject(signedKey, Buffer.from(out), "application/pdf");

  // Race guard #2 (transactional): re-check inside the tx so two concurrent
  // signers that both passed the fast path don't both stamp signedFileKey.
  // We also scope the update to placements that have actually been signed —
  // unsigned placements must not get a stale signedFileKey pointing at a PDF
  // that doesn't include them yet.
  const txResult = await prisma.$transaction(async (tx) => {
    const existing = await tx.documentSignaturePlacement.findFirst({
      where: { orgId, documentId, signedFileKey: { not: null } },
      select: { signedFileKey: true },
    });
    if (existing?.signedFileKey) {
      return { skipped: true, signedFileKey: existing.signedFileKey };
    }
    await tx.documentSignaturePlacement.updateMany({
      where: { orgId, documentId, signedAt: { not: null } },
      data: { signedFileKey: signedKey },
    });
    return { skipped: false, signedFileKey: signedKey };
  });

  if (txResult.skipped) {
    return {
      signedFileKey: txResult.signedFileKey,
      placedCount: 0,
      totalCount: placements.length,
      skipped: true,
    };
  }

  return {
    signedFileKey: txResult.signedFileKey,
    placedCount: placed,
    totalCount: placements.length,
  };
}
