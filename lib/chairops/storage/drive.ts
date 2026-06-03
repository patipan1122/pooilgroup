// ChairOps · Google Drive backup client (CEO 2026-06-03).
//
// Pure REST (fetch) — no `googleapis` npm dependency. Stores slip/receipt/
// contract files in the CEO's own Google Drive (free 2 TB) under:
//
//     <rootFolderName> / <YYYY-MM> / <category-folder> / <file>
//     e.g.  เก้าอี้นวด backup1 / 2026-06 / ค่าใช้จ่าย / slip.jpg
//
// Auth: OAuth2 with the `drive.file` scope (app sees ONLY files it creates).
// The refresh token is stored AES-256-GCM encrypted in ChairopsDriveConnection.
//
// EVERYTHING here is best-effort: if Drive isn't connected or a call fails we
// log + return null so the existing R2 flow is never broken.

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Config / crypto
// ---------------------------------------------------------------------------

export function isDriveOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

const ALG = "aes-256-gcm";
const IV_LEN = 12;

function cryptoKey(): Buffer {
  const raw = process.env.CHAIROPS_DRIVE_CRYPTO_KEY;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  const fallback =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXTAUTH_SECRET ??
    process.env.DATABASE_URL;
  if (!fallback) {
    throw new Error(
      "chairops drive crypto: no key source (set CHAIROPS_DRIVE_CRYPTO_KEY)",
    );
  }
  return crypto.createHash("sha256").update(fallback).digest();
}

export function encryptToken(plaintext: string): string {
  const key = cryptoKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("base64")}:${tag.toString("hex")}`;
}

export function decryptToken(stored: string): string | null {
  try {
    const [ivHex, encB64, tagHex] = stored.split(":");
    if (!ivHex || !encB64 || !tagHex) return null;
    const decipher = crypto.createDecipheriv(
      ALG,
      cryptoKey(),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(encB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch (e) {
    console.error("[chairops drive] token decrypt failed", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function buildConsentUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent", // force refresh_token even on re-consent
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; scope: string } | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    // log status only — never the body (may carry sensitive token material)
    console.error("[chairops drive] code exchange failed, status", res.status);
    return null;
  }
  const j = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
  };
  if (!j.refresh_token || !j.access_token) return null;
  return {
    refreshToken: j.refresh_token,
    accessToken: j.access_token,
    scope: j.scope ?? DRIVE_SCOPE,
  };
}

// in-memory access-token cache (per refresh token) — access tokens last ~1h
const tokenCache = new Map<string, { token: string; exp: number }>();

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const cached = tokenCache.get(refreshToken);
  // 2-minute safety margin so a token can't expire mid-request
  if (cached && cached.exp > Date.now() + 120_000) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("[chairops drive] token refresh failed, status", res.status);
    return null;
  }
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  tokenCache.set(refreshToken, {
    token: j.access_token,
    exp: Date.now() + (j.expires_in ?? 3600) * 1000,
  });
  return j.access_token;
}

// ---------------------------------------------------------------------------
// Drive REST helpers
// ---------------------------------------------------------------------------

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

function escapeQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Create the named folder if absent under parent (or Drive root). */
export async function ensureFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
): Promise<string | null> {
  const parentClause = parentId
    ? `and '${escapeQ(parentId)}' in parents`
    : "and 'root' in parents";
  const q =
    `mimeType='application/vnd.google-apps.folder' and trashed=false ` +
    `and name='${escapeQ(name)}' ${parentClause}`;
  const findRes = await fetch(
    `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (findRes.ok) {
    const j = (await findRes.json()) as { files?: { id: string }[] };
    if (j.files && j.files[0]) return j.files[0].id;
  }
  // create
  const createRes = await fetch(`${FILES_URL}?fields=id`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!createRes.ok) {
    console.error("[chairops drive] folder create failed", await createRes.text());
    return null;
  }
  const c = (await createRes.json()) as { id: string };
  return c.id;
}

async function ensureFolderPath(
  accessToken: string,
  rootId: string | null,
  segments: string[],
): Promise<string | null> {
  let parent = rootId;
  for (const seg of segments) {
    const id: string | null = await ensureFolder(accessToken, seg, parent);
    if (!id) return null;
    parent = id;
  }
  return parent;
}

/** Multipart upload of raw bytes → returns { id, webViewLink }. */
async function uploadBytes(
  accessToken: string,
  opts: { parentId: string; name: string; mimeType: string; bytes: Buffer },
): Promise<{ id: string; webViewLink: string } | null> {
  const boundary = `chairops${crypto.randomBytes(8).toString("hex")}`;
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
    console.error("[chairops drive] upload failed", await res.text());
    return null;
  }
  const j = (await res.json()) as { id: string; webViewLink?: string };
  return {
    id: j.id,
    webViewLink: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view`,
  };
}

// SECURITY (2026-06-03): files (maid contracts, bank slips) are SENSITIVE, so
// "anyone-with-link reader" is OFF by default. Files stay private to the
// connected Google account; the live in-app view uses R2 regardless. Set
// CHAIROPS_DRIVE_PUBLIC_LINKS=1 only if staff must open archived files via the
// Drive link directly (e.g. after R2 offload).
function publicLinksEnabled(): boolean {
  return process.env.CHAIROPS_DRIVE_PUBLIC_LINKS === "1";
}

async function makeAnyoneReader(accessToken: string, fileId: string): Promise<void> {
  if (!publicLinksEnabled()) return;
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
    console.warn("[chairops drive] set permission failed (non-fatal)", e);
  }
}

export async function deleteDriveFile(
  accessToken: string,
  fileId: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${FILES_URL}/${fileId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return res.ok || res.status === 404;
  } catch (e) {
    console.error("[chairops drive] delete failed", e);
    return false;
  }
}

/** Verify a file still exists + is not trashed (offload safety check).
 *  Conservative: any network/parse error → false → offload SKIPS (never
 *  deletes an R2 copy it couldn't confirm has a live Drive twin). */
export async function driveFileExists(
  accessToken: string,
  fileId: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${FILES_URL}/${fileId}?fields=id,trashed`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { trashed?: boolean };
    return j.trashed !== true;
  } catch (e) {
    console.error("[chairops drive] file-exists check failed", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Connection + high-level helpers
// ---------------------------------------------------------------------------

export type DriveCategory = "contract" | "expense_slip" | "income_slip" | "other";

const CATEGORY_FOLDER: Record<DriveCategory, string> = {
  contract: "สัญญา",
  expense_slip: "ค่าใช้จ่าย",
  income_slip: "สลิปรายได้",
  other: "อื่นๆ",
};

export async function getDriveConnection(orgId: string) {
  return prisma.chairopsDriveConnection.findUnique({ where: { orgId } });
}

export function directViewLink(fileId: string): string {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

/** Resolve a usable access token + the org's root folder id (creating it once). */
export async function getDriveSession(
  orgId: string,
): Promise<{ accessToken: string; rootFolderId: string } | null> {
  if (!isDriveOAuthConfigured()) return null;
  const conn = await getDriveConnection(orgId);
  if (!conn) return null;
  const refreshToken = decryptToken(conn.refreshTokenEnc);
  if (!refreshToken) return null;
  const accessToken = await refreshAccessToken(refreshToken);
  if (!accessToken) return null;

  let rootFolderId = conn.rootFolderId;
  if (!rootFolderId) {
    rootFolderId = await ensureFolder(accessToken, conn.rootFolderName, null);
    if (rootFolderId) {
      await prisma.chairopsDriveConnection.update({
        where: { orgId },
        data: { rootFolderId },
      });
    }
  }
  if (!rootFolderId) return null;
  return { accessToken, rootFolderId };
}

/**
 * Best-effort: upload `bytes` to Drive under <root>/<periodYm>/<category> and
 * record a ChairopsDriveAsset. Returns the asset, or null when Drive isn't
 * connected / any step fails (caller keeps using R2 regardless).
 */
export async function backupFileToDrive(opts: {
  orgId: string;
  category: DriveCategory;
  periodYm: string; // "YYYY-MM"
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  r2Key?: string | null;
  r2Url?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
}): Promise<{ id: string; driveUrl: string; driveDirectUrl: string } | null> {
  try {
    const session = await getDriveSession(opts.orgId);
    if (!session) return null;
    const folderId = await ensureFolderPath(session.accessToken, session.rootFolderId, [
      opts.periodYm,
      CATEGORY_FOLDER[opts.category],
    ]);
    if (!folderId) return null;

    const uploaded = await uploadBytes(session.accessToken, {
      parentId: folderId,
      name: opts.fileName,
      mimeType: opts.mimeType,
      bytes: opts.bytes,
    });
    if (!uploaded) return null;

    await makeAnyoneReader(session.accessToken, uploaded.id);

    const asset = await prisma.chairopsDriveAsset.create({
      data: {
        orgId: opts.orgId,
        category: opts.category,
        periodYm: opts.periodYm,
        r2Key: opts.r2Key ?? null,
        r2Url: opts.r2Url ?? null,
        driveFileId: uploaded.id,
        driveUrl: uploaded.webViewLink,
        driveDirectUrl: directViewLink(uploaded.id),
        fileName: opts.fileName,
        sizeBytes: opts.bytes.byteLength,
        sourceTable: opts.sourceTable ?? null,
        sourceId: opts.sourceId ?? null,
      },
    });
    return {
      id: asset.id,
      driveUrl: asset.driveUrl,
      driveDirectUrl: asset.driveDirectUrl ?? directViewLink(uploaded.id),
    };
  } catch (e) {
    console.error("[chairops drive] backupFileToDrive failed (non-fatal)", e);
    return null;
  }
}
