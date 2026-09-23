// DocuFlow — export a document to Google Drive (Track B Item 11)
// ────────────────────────────────────────────────────────────────────
// Reuses the EXISTING Google Drive connection already set up for this org
// (via ChairOps) — no new OAuth, no new consent screen. Opt-in, per-document
// action triggered by an admin (see app/api/docuflow/[id]/drive-export).
//
// One-way snapshot, NOT a two-way sync: every call uploads a fresh copy and
// overwrites the tracked Document.drive* columns. Editing the file in Drive
// never flows back into this system.
//
// Failure modes never touch R2 (the system of record) — worst case is the
// admin sees an error toast and can retry.
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/r2/upload";
import {
  ensureFolder,
  getDriveSession,
  uploadBytes,
} from "@/lib/chairops/storage/drive";
import { audit } from "@/lib/audit/log";

/** Flat, dedicated folder for DocuFlow exports under the connection's root —
 *  mirrors `lib/dc/drive-store.ts`'s `DC_IMAGE_FOLDER` pattern (a single
 *  flat folder, not ChairOps' own nested month/category tree — DocuFlow
 *  documents aren't periodic like slips/receipts). */
const DOCUFLOW_DRIVE_FOLDER = "DocuFlow-เอกสาร";

/** Office documents (PDF/DOCX/images), not large media — see
 *  DOCUFLOW_MIME_WHITELIST (lib/docuflow/mime-validate.ts). A full
 *  resumable-upload rewrite of the Drive helper is deliberately out of
 *  scope for this pass; revisit only if real usage shows documents
 *  routinely exceed this. */
const MAX_EXPORT_BYTES = 100 * 1024 * 1024; // 100MB

export type ExportDocumentToDriveResult =
  | { ok: true; driveUrl: string }
  | { ok: false; reason: "not_connected" | "too_large" | "upload_failed" };

export async function exportDocumentToDrive(opts: {
  orgId: string;
  documentId: string;
  userId: string;
}): Promise<ExportDocumentToDriveResult> {
  const { orgId, documentId, userId } = opts;

  const doc = await prisma.document.findFirst({
    where: { id: documentId, orgId, isActive: true },
    select: { id: true, name: true, fileKey: true, mimeType: true, fileSize: true },
  });
  if (!doc) {
    return { ok: false, reason: "upload_failed" };
  }

  // Same fast-path lookup embedSignatures() uses internally
  // (lib/docuflow/signature.ts) — prefer the signed final PDF when one
  // exists, fall back to the original upload otherwise.
  const signedPlacement = await prisma.documentSignaturePlacement.findFirst({
    where: { orgId, documentId, signedFileKey: { not: null } },
    select: { signedFileKey: true },
  });
  const sourceKey = signedPlacement?.signedFileKey ?? doc.fileKey;
  const isSignedVersion = sourceKey !== doc.fileKey;

  // Size guard BEFORE attempting any download/upload — deliberate scope
  // decision (see MAX_EXPORT_BYTES above), not a resumable-upload fix.
  if (doc.fileSize != null && doc.fileSize > MAX_EXPORT_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const session = await getDriveSession(orgId);
  if (!session) {
    return { ok: false, reason: "not_connected" };
  }

  try {
    const folderId = await ensureFolder(
      session.accessToken,
      DOCUFLOW_DRIVE_FOLDER,
      session.rootFolderId,
    );
    if (!folderId) {
      return { ok: false, reason: "upload_failed" };
    }

    const bytes = await getObject(sourceKey);

    const uploaded = await uploadBytes(session.accessToken, {
      parentId: folderId,
      name: isSignedVersion ? `${doc.name} (เซ็นแล้ว)` : doc.name,
      mimeType: doc.mimeType ?? "application/octet-stream",
      bytes,
    });
    if (!uploaded) {
      return { ok: false, reason: "upload_failed" };
    }

    await prisma.document.update({
      where: { id: documentId },
      data: {
        driveFileId: uploaded.id,
        driveFileUrl: uploaded.webViewLink,
        driveExportedAt: new Date(),
        driveExportedById: userId,
      },
    });

    await audit({
      orgId,
      userId,
      action: "DOCUFLOW_DRIVE_EXPORT",
      resourceType: "document",
      resourceId: documentId,
      diff: {
        new: {
          driveFileId: uploaded.id,
          driveFileUrl: uploaded.webViewLink,
          sourceKey,
          isSignedVersion,
        },
      },
    });

    return { ok: true, driveUrl: uploaded.webViewLink };
  } catch (err) {
    console.error("[docuflow drive-export] failed", err);
    return { ok: false, reason: "upload_failed" };
  }
}
