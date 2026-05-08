// DocuFlow R2 helpers — key naming + signed download URLs
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §15 (Infrastructure / R2)
//
// Key shape:  documents/{orgId}/{docId}/{slug-filename}
// Upload:     reuse `getUploadUrl` from lib/r2/upload.ts
// Download:   short-lived presigned GET (default 1h)
// ────────────────────────────────────────────────────────────────────

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2_BUCKET, r2 } from "@/lib/r2/client";
import { getUploadUrl } from "@/lib/r2/upload";

/**
 * Slugify a filename — keep dots + dashes + alphanumerics, replace
 * everything else with `-`. Caps at 80 chars to avoid R2 key bloat.
 */
function slugFilename(filename: string): string {
  const trimmed = filename.trim() || "file";
  const cleaned = trimmed
    .replace(/\s+/g, "-")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(-80) || "file";
}

/**
 * Build the canonical R2 key for a document file.
 * Example: `documents/{orgId}/{docId}/contract-2026.pdf`
 */
export function buildDocumentKey(
  orgId: string,
  docId: string,
  filename: string,
): string {
  return `documents/${orgId}/${docId}/${slugFilename(filename)}`;
}

/**
 * Presigned GET URL for downloading/viewing a stored document.
 * Default: 1 hour expiry — long enough for view in browser, short
 * enough that links shared accidentally don't outlive the session.
 */
export async function getSignedDownloadUrl(
  fileKey: string,
  expiresIn = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: fileKey,
  });
  return getSignedUrl(r2, cmd, { expiresIn });
}

/**
 * Re-export `getUploadUrl` so DocuFlow callers don't need to know
 * about lib/r2/upload.ts. Returns `{ url, publicUrl }`.
 */
export { getUploadUrl };
