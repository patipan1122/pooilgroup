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
 * Builds a `Content-Disposition: attachment` header value for a presigned
 * download — CEO Pinpoint item #16 (2026-10-13). Includes BOTH the plain
 * ASCII `filename=` fallback (older clients) and the RFC 5987/6266
 * UTF-8 `filename*=` form (so a Thai document name downloads with its
 * real name, not a mangled/stripped one — most DocuFlow document names
 * are in Thai).
 */
function buildAttachmentDisposition(filename: string): string {
  const asciiFallback =
    filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").trim() ||
    "document";
  const utf8Encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

/**
 * Presigned GET URL for downloading/viewing a stored document.
 * Default: 1 hour expiry — long enough for view in browser, short
 * enough that links shared accidentally don't outlive the session.
 *
 * `downloadFilename` (CEO Pinpoint item #16, 2026-10-13): when set, adds
 * an R2/S3 `ResponseContentDisposition` override so opening this URL
 * triggers a native "Save File" download instead of a browser navigation
 * — the bug was a plain 302 redirect to the signed URL, which opens as a
 * new-tab navigation with no disposition hint. Left undefined for every
 * OTHER existing caller (inline PDF/image preview via react-pdf/<img>) so
 * their behavior is completely unchanged — only the download ROUTE passes
 * this.
 */
export async function getSignedDownloadUrl(
  fileKey: string,
  expiresIn = 3600,
  downloadFilename?: string,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: fileKey,
    ...(downloadFilename
      ? { ResponseContentDisposition: buildAttachmentDisposition(downloadFilename) }
      : {}),
  });
  return getSignedUrl(r2, cmd, { expiresIn });
}

/**
 * Re-export `getUploadUrl` so DocuFlow callers don't need to know
 * about lib/r2/upload.ts. Returns `{ url, publicUrl }`.
 */
export { getUploadUrl };
