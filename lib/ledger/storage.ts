// LedgerLine — receipt image storage on Cloudflare R2.
//
// REUSE lib/r2/upload (putObject) — same client/bucket as CashHub/Inbox.
// Phase 1: original + thumbnail both live on R2. Google Drive (CEO's 2TB,
// folder-per-month) is Phase 1.5 → stubbed below with a clear TODO.
//
// Key layout (org-namespaced like chairops so a public-URL leak from org A
// cannot reveal org B's storage tree). MUST match the presign route shape
// (app/api/ledger/r2/presign) so client-presigned and server-stored originals
// live under the same per-org tree:
//   orgs/{orgId}/ledger/{yyyy}/{mm}/{company}/{id}.jpg        ← original
//   orgs/{orgId}/ledger/{yyyy}/{mm}/{company}/{id}-thumb.jpg   ← thumbnail
//
// Dedup: caller computes sha256 of the image bytes and checks for an existing
// ledger_expense row before creating a new draft (see actions.createDraftExpense).

import crypto from "node:crypto";
import { putObject } from "@/lib/r2/upload";

/** SHA-256 hex of the image bytes — used for dedup (index on ledger_expense.sha256). */
export function sha256Hex(buffer: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function extFromContentType(contentType?: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/gif": "gif",
  };
  return map[(contentType ?? "").toLowerCase()] ?? "jpg";
}

function monthParts(d = new Date()): { yyyy: string; mm: string } {
  return {
    yyyy: String(d.getUTCFullYear()),
    mm: String(d.getUTCMonth() + 1).padStart(2, "0"),
  };
}

/** Build the R2 key for a receipt original. orgId namespaces the tree (a
 *  public-URL leak from org A can't reveal org B's receipts), companySlug =
 *  company code or id. Shape matches app/api/ledger/r2/presign exactly. */
export function receiptKey(
  orgId: string,
  companySlug: string,
  expenseId: string,
  contentType?: string,
  when = new Date(),
): string {
  const { yyyy, mm } = monthParts(when);
  const safeOrg = orgId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
  const safeCompany = companySlug.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  const ext = extFromContentType(contentType);
  return `orgs/${safeOrg}/ledger/${yyyy}/${mm}/${safeCompany}/${expenseId}.${ext}`;
}

export function thumbKey(originalKey: string): string {
  return originalKey.replace(/(\.[a-z0-9]+)$/i, "-thumb$1");
}

export interface StoredReceipt {
  originalUrl: string;
  thumbUrl: string | null;
  sha256: string;
  key: string;
}

/**
 * Upload a receipt image (original + a best-effort thumbnail) to R2 and return
 * the public URLs + sha256. Thumbnail generation is best-effort: if the `sharp`
 * resize is unavailable we fall back to reusing the original as the thumb so the
 * UI still has something to render (never blocks the build/flow).
 */
export async function storeReceiptImage(opts: {
  orgId: string;
  companySlug: string;
  expenseId: string;
  buffer: Buffer;
  contentType?: string;
  when?: Date;
}): Promise<StoredReceipt> {
  const { orgId, companySlug, expenseId, buffer, contentType, when } = opts;
  const key = receiptKey(orgId, companySlug, expenseId, contentType, when);
  const ct = contentType ?? "image/jpeg";

  const sha256 = sha256Hex(buffer);
  const originalUrl = await putObject(key, buffer, ct);

  let thumbUrl: string | null = null;
  try {
    const thumbBuf = await makeThumbnail(buffer);
    if (thumbBuf) {
      thumbUrl = await putObject(thumbKey(key), thumbBuf, "image/jpeg");
    } else {
      thumbUrl = originalUrl; // graceful fallback
    }
  } catch (err) {
    console.error("[ledger:storage] thumbnail failed, using original", err);
    thumbUrl = originalUrl;
  }

  return { originalUrl, thumbUrl, sha256, key };
}

/**
 * Best-effort thumbnail (max 480px). Uses `sharp` if present in the runtime,
 * otherwise returns null so the caller falls back to the original image.
 * Dynamic import keeps this from becoming a hard build dependency.
 */
async function makeThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    const sharpMod = (await import("sharp").catch(() => null)) as
      | { default: (input: Buffer) => SharpLike }
      | null;
    if (!sharpMod?.default) return null;
    const out = await sharpMod
      .default(buffer)
      .rotate()
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return out;
  } catch {
    return null;
  }
}

// Minimal structural type so we don't take a hard dependency on @types/sharp.
interface SharpLike {
  rotate(): SharpLike;
  resize(w: number, h: number, opts: object): SharpLike;
  jpeg(opts: object): SharpLike;
  toBuffer(): Promise<Buffer>;
}

// =============================================================
// Phase 1.5 — Google Drive sync of originals (CEO's 2TB).
// Needs Google OAuth set up first (one-time). Until then, R2 is the system of
// record for images. Interface kept stable so M-later can wire it without
// touching call sites.
// =============================================================
export interface DriveSyncResult {
  driveFileId: string | null;
  driveUrl: string | null;
}

// TODO[ledger-secret]: wire Google Drive once CEO completes Google OAuth.
// Plan: folder-per-company/month, store original + an Excel index per month.
export async function syncOriginalToDrive(_opts: {
  companySlug: string;
  buffer: Buffer;
  filename: string;
  when?: Date;
}): Promise<DriveSyncResult> {
  // Stub — no-op until Drive OAuth is configured (Phase 1.5).
  return { driveFileId: null, driveUrl: null };
}
