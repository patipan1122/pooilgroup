// LedgerLine — Google Drive archive for receipt originals.
//
// CEO 2026-06-05: every receipt/slip goes into Google Drive "ระบบบัญชี2027",
// foldered MONTH → BUSINESS(company) → BRANCH → CATEGORY, named meaningfully,
// with a shareable link the accounting office can open. Keeps R2 light.
//
// AUTH (CEO: "ใช้อันเดียวกัน"): reuses the SAME Google connection ChairOps already
// uses — the shared GOOGLE_OAUTH_CLIENT_ID/SECRET app + the org's refresh token
// stored (encrypted) in ChairopsDriveConnection via the one-time "Connect Google
// Drive" OAuth click. No separate LEDGER_DRIVE_* creds needed.
//
// NOTE on scope: the OAuth scope is `drive.file` (app sees ONLY files it creates),
// so we create our OWN "ระบบบัญชี2027" root — the app cannot write into a folder a
// human made by hand. The structure inside is exactly เดือน/ธุรกิจ/สาขา/ประเภท.
//
// If the org hasn't connected Drive yet, every export is a graceful no-op (returns
// null) so LINE/LIFF capture never breaks — the image simply stays on R2.

import {
  isDriveOAuthConfigured,
  getDriveConnection,
  decryptToken,
  refreshAccessToken,
} from "@/lib/chairops/storage/drive";

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

/** The LedgerLine root folder name in the shared Drive (configurable). */
const ROOT_NAME = process.env.LEDGER_DRIVE_ROOT_NAME || "ระบบบัญชี2027";

/** Env-level gate (the shared Google OAuth app). The per-org connection (refresh
 *  token) is checked at runtime inside archiveReceiptToDrive. */
export function isDriveConfigured(): boolean {
  return isDriveOAuthConfigured();
}

/** Resolve a usable access token from the org's SHARED (ChairOps) Drive connection. */
async function getAccessToken(orgId: string): Promise<string | null> {
  if (!isDriveOAuthConfigured()) return null;
  try {
    const conn = await getDriveConnection(orgId);
    if (!conn) return null; // org hasn't connected Google Drive yet
    const refreshToken = decryptToken(conn.refreshTokenEnc);
    if (!refreshToken) return null;
    return await refreshAccessToken(refreshToken);
  } catch (e) {
    console.error("[ledger:drive] token error", e);
    return null;
  }
}

const DRIVE_Q = (name: string, parent: string) =>
  `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`;

/** Find or create a folder under `parent` ("root" allowed); returns its id. */
async function ensureFolder(
  token: string,
  name: string,
  parent: string,
): Promise<string | null> {
  try {
    const q = encodeURIComponent(DRIVE_Q(name, parent));
    const found = await fetch(`${FILES_URL}?q=${q}&fields=files(id)&pageSize=1`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (found.ok) {
      const j = (await found.json()) as { files?: Array<{ id: string }> };
      if (j.files?.[0]?.id) return j.files[0].id;
    }
    const created = await fetch(`${FILES_URL}?fields=id`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parent],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!created.ok) return null;
    return ((await created.json()) as { id: string }).id;
  } catch (e) {
    console.error("[ledger:drive] ensureFolder error", e);
    return null;
  }
}

async function ensureFolderPath(
  token: string,
  segments: string[],
  rootId: string,
): Promise<string | null> {
  let parent = rootId;
  for (const seg of segments) {
    const id = await ensureFolder(token, seg.slice(0, 120) || "ไม่ระบุ", parent);
    if (!id) return null;
    parent = id;
  }
  return parent;
}

function sanitize(s: string | null | undefined, fallback: string): string {
  const t = (s ?? "").trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
  return t || fallback;
}

export interface DriveArchiveInput {
  /** Org that owns the receipt — selects the shared Drive connection. */
  orgId: string;
  bytes: Buffer;
  mimeType: string;
  /** YYYY-MM (Asia/Bangkok period) */
  period: string;
  /** ธุรกิจ/บริษัท — the top split under the month. null → "ทั่วไป". */
  companyName: string | null;
  branchName: string | null; // null → "ส่วนกลาง"
  categoryName: string | null; // null → "ยังไม่จัดหมวด"
  docCode: string;
  vendor: string | null;
  docDate: string | null; // YYYY-MM-DD
}

/**
 * Archive a receipt original into Drive at
 *   ระบบบัญชี2027 / <เดือน> / <ธุรกิจ> / <สาขา> / <ประเภท> / <date>_<vendor>_<docCode>.<ext>
 * Returns { fileId, webViewLink } or null (graceful) when Drive isn't connected
 * for this org or any step fails. Evidence pack for the accounting office.
 */
export async function archiveReceiptToDrive(
  input: DriveArchiveInput,
): Promise<{ fileId: string; webViewLink: string } | null> {
  const token = await getAccessToken(input.orgId);
  if (!token) return null;

  // App-owned root (drive.file scope can't reuse a hand-made folder). Optional
  // LEDGER_DRIVE_ROOT_FOLDER_ID pins an explicit folder id if ever shared to the app.
  const explicitRoot = process.env.LEDGER_DRIVE_ROOT_FOLDER_ID;
  const baseId = explicitRoot || (await ensureFolder(token, ROOT_NAME, "root"));
  if (!baseId) return null;

  const folderId = await ensureFolderPath(
    token,
    [
      input.period, // เดือน (YYYY-MM)
      sanitize(input.companyName, "ทั่วไป"), // ธุรกิจ/บริษัท
      sanitize(input.branchName, "ส่วนกลาง"), // สาขา
      sanitize(input.categoryName, "ยังไม่จัดหมวด"), // ประเภทค่าใช้จ่าย
    ],
    baseId,
  );
  if (!folderId) return null;

  const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("pdf") ? "pdf" : "jpg";
  const datePart = (input.docDate || input.period).replace(/[^0-9-]/g, "");
  const filename = `${datePart}_${sanitize(input.vendor, "receipt")}_${input.docCode}.${ext}`;

  try {
    const boundary = "ledgerdrive" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: filename, parents: [folderId] });
    const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${input.mimeType}\r\ncontent-transfer-encoding: base64\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = Buffer.concat([
      Buffer.from(head, "utf8"),
      Buffer.from(input.bytes.toString("base64"), "utf8"),
      Buffer.from(tail, "utf8"),
    ]);
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error("[ledger:drive] upload failed", res.status);
      return null;
    }
    const j = (await res.json()) as { id: string; webViewLink?: string };
    const fileId = j.id;
    const webViewLink = j.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;

    // Optional: anyone-with-link reader so the accounting office can open it.
    if (process.env.LEDGER_DRIVE_PUBLIC_LINKS === "1") {
      await fetch(`${FILES_URL}/${fileId}/permissions`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }
    return { fileId, webViewLink };
  } catch (e) {
    console.error("[ledger:drive] upload error", e);
    return null;
  }
}
