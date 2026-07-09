// Recruit · upload an applicant file (resume) to the org's connected Google
// Drive, under an app-created "Recruit — ใบสมัครงาน" folder, and make it
// anyone-with-link readable so HR/CEO can open it directly.
//
// Reuses the org's EXISTING Google connection (getDriveSession — same OAuth app
// + the org's stored refresh token). The `drive.file` scope means the app can
// only write to folders IT creates, so we create our own Recruit root; a folder
// the CEO made by hand can't be targeted programmatically.
//
// Best-effort: returns null if Drive isn't connected / any step fails, so the
// caller can fall back to R2 and the applicant is never blocked.

import crypto from "node:crypto";
import {
  getDriveSession,
  ensureFolder,
  directViewLink,
} from "@/lib/chairops/storage/drive";

const RECRUIT_ROOT = "Recruit — ใบสมัครงาน";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

function safeFolderName(s: string): string {
  return (
    (s || "ทั่วไป")
      .replace(/[\r\n\t]/g, " ")
      .replace(/[\\/]/g, "-")
      .trim()
      .slice(0, 80) || "ทั่วไป"
  );
}

async function uploadBytes(
  accessToken: string,
  opts: { parentId: string; name: string; mimeType: string; bytes: Buffer },
): Promise<{ id: string; webViewLink: string } | null> {
  const boundary = `recruit${crypto.randomBytes(8).toString("hex")}`;
  const meta = JSON.stringify({ name: opts.name, parents: [opts.parentId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    ),
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
    console.error("[recruit drive] upload failed", await res.text());
    return null;
  }
  const j = (await res.json()) as { id: string; webViewLink?: string };
  return {
    id: j.id,
    webViewLink: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view`,
  };
}

// Recruit files ARE meant to be viewable via link (CEO wants a public link to
// open resumes), so — unlike ChairOps' sensitive slips — we always grant
// anyone-with-link reader here.
async function makePublic(accessToken: string, fileId: string): Promise<void> {
  try {
    await fetch(`${FILES_URL}/${fileId}/permissions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  } catch (e) {
    console.warn("[recruit drive] make public failed (non-fatal)", e);
  }
}

export interface RecruitDriveUpload {
  fileId: string;
  viewUrl: string; // Google Drive share/preview link
  directUrl: string; // direct download/view link
}

/**
 * Upload an applicant file to the org's Google Drive.
 * Returns links, or null if Drive isn't connected / any step fails (caller
 * should fall back to R2 so the applicant is never blocked).
 */
export async function uploadApplicantFileToDrive(opts: {
  orgId: string;
  postingLabel: string; // folder name (posting title)
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<RecruitDriveUpload | null> {
  try {
    const session = await getDriveSession(opts.orgId);
    if (!session) return null; // Drive not connected for this org
    const root = await ensureFolder(session.accessToken, RECRUIT_ROOT, null);
    if (!root) return null;
    const folder = await ensureFolder(
      session.accessToken,
      safeFolderName(opts.postingLabel),
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
    await makePublic(session.accessToken, up.id);
    return {
      fileId: up.id,
      viewUrl: up.webViewLink,
      directUrl: directViewLink(up.id),
    };
  } catch (e) {
    console.error(
      "[recruit drive] uploadApplicantFileToDrive failed (non-fatal)",
      e,
    );
    return null;
  }
}

/** Is the org's Google Drive connected + usable right now? */
export async function isRecruitDriveReady(orgId: string): Promise<boolean> {
  try {
    return (await getDriveSession(orgId)) !== null;
  } catch {
    return false;
  }
}
