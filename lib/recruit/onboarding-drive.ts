// Recruit Onboarding · upload identity documents (ID card, house registration,
// bank book, photo, education cert, other) to the org's connected Google Drive
// — PRIVATE, never "anyone with link" (unlike lib/recruit/drive.ts's résumé
// uploads, which intentionally makes files public-link-readable).
//
// Why private: these are sensitive documents (national ID number, in some
// cases a religion field per the ID card layout, bank account details) — see
// docs/BIGFEATURE_recruit-onboarding_SPEC.md P0. We deliberately do NOT call
// any "make public"/"anyone reader" permission — Drive files are private by
// default, so simply never granting broader access is the whole fix. HR views
// these documents through the app's own authenticated proxy route
// (app/api/recruit/onboarding/[id]/documents/[docId]/route.ts, built in the
// HR-review slice) using the same stored access token server-side — never a
// raw Drive link.
//
// Reuses the org's EXISTING Drive connection (getDriveSession/ensureFolder —
// same helpers lib/recruit/drive.ts already reuses from ChairOps' module).
// The `drive.file` OAuth scope means the app can only see folders it created
// itself, so we create our own dedicated root, separate from
// "Recruit — ใบสมัครงาน" (keeps sensitive onboarding docs organizationally
// apart from public-link résumés even though both use the same connection).
//
// This is the PRIMARY (only) document store for onboarding — unlike
// ChairOps' sensitive-file pattern where Drive is a best-effort backup and
// R2 is the live store, CEO explicitly rejected R2 for this feature. A
// failed upload here must surface as a real error to the candidate, not a
// silent no-op fallback.

import crypto from "node:crypto";
import { getDriveSession, ensureFolder } from "@/lib/chairops/storage/drive";

const ONBOARDING_ROOT = "Recruit — Onboarding (เอกสารพนักงานใหม่)";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name";

function safeFolderName(s: string): string {
  return (
    (s || "ไม่ระบุ")
      .replace(/[\r\n\t]/g, " ")
      .replace(/[\\/]/g, "-")
      .trim()
      .slice(0, 80) || "ไม่ระบุ"
  );
}

async function uploadBytes(
  accessToken: string,
  opts: { parentId: string; name: string; mimeType: string; bytes: Buffer },
): Promise<{ id: string } | null> {
  const boundary = `onboard${crypto.randomBytes(8).toString("hex")}`;
  const meta = JSON.stringify({ name: opts.name, parents: [opts.parentId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(meta),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`),
    opts.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    console.error("[onboarding drive] upload failed", await res.text());
    return null;
  }
  return (await res.json()) as { id: string };
}

export interface OnboardingDriveUpload {
  fileId: string;
  folderId: string;
}

/**
 * Upload one onboarding document to the org's Drive under
 * <ONBOARDING_ROOT>/<submissionId>/<fileName> — PRIVATE (no public/shared
 * permission ever granted). Returns null if Drive isn't connected or any
 * step fails; unlike the résumé uploader this is NOT best-effort from the
 * caller's perspective — a null here must be surfaced as a real upload
 * failure to the candidate (there is no R2 fallback for this feature).
 */
export async function uploadOnboardingDocumentToDrive(opts: {
  orgId: string;
  submissionId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<OnboardingDriveUpload | null> {
  try {
    const session = await getDriveSession(opts.orgId);
    if (!session) return null;
    const root = await ensureFolder(session.accessToken, ONBOARDING_ROOT, null);
    if (!root) return null;
    const folder = await ensureFolder(
      session.accessToken,
      safeFolderName(opts.submissionId),
      root,
    );
    if (!folder) return null;
    const up = await uploadBytes(session.accessToken, {
      parentId: folder,
      name: opts.fileName,
      mimeType: opts.mimeType,
      bytes: opts.bytes,
    });
    if (!up) return null;
    // Deliberately NO permission/sharing call here — file stays private to
    // the org's connected Drive account. HR views it via the app's own
    // server-side proxy route, never a direct Drive link.
    return { fileId: up.id, folderId: folder };
  } catch (e) {
    console.error("[onboarding drive] uploadOnboardingDocumentToDrive failed", e);
    return null;
  }
}

/** Fetch a private onboarding document's raw bytes + content-type, using the
 * org's stored Drive access token server-side. Used by the HR-review proxy
 * route — never expose the returned bytes/URL directly to a client as a
 * standalone link. Returns null if Drive isn't connected or the fetch fails. */
export async function fetchOnboardingDocumentBytes(
  orgId: string,
  fileId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const session = await getDriveSession(orgId);
    if (!session) return null;
    const metaRes = await fetch(`${FILES_URL}/${fileId}?fields=mimeType`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { mimeType?: string };
    const contentRes = await fetch(`${FILES_URL}/${fileId}?alt=media`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    if (!contentRes.ok) return null;
    const bytes = Buffer.from(await contentRes.arrayBuffer());
    return { bytes, mimeType: meta.mimeType ?? "application/octet-stream" };
  } catch (e) {
    console.error("[onboarding drive] fetchOnboardingDocumentBytes failed", e);
    return null;
  }
}

/** Is the org's Drive connected + usable right now? Check before starting the
 * public onboarding flow (surface a clear "system unavailable" state instead
 * of letting candidates fill 41 fields and then fail at the upload step). */
export async function isOnboardingDriveReady(orgId: string): Promise<boolean> {
  try {
    return (await getDriveSession(orgId)) !== null;
  } catch {
    return false;
  }
}
