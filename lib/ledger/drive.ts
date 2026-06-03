// LedgerLine — Google Drive archive for receipt originals.
//
// CEO ask: every receipt/slip we read goes into Google Drive "ระบบบัญชี2027",
// foldered by MONTH → BRANCH → CATEGORY, named meaningfully, with a shareable
// link the accounting office can open. Keeps R2 light (Drive is free + CEO-owned).
//
// Pure REST (fetch) — mirrors the proven ChairOps drive pattern (drive.file
// scope, ensureFolder + multipart upload). LedgerLine uses its OWN Drive creds
// (per-module rule). Reads env:
//   LEDGER_DRIVE_CLIENT_ID / LEDGER_DRIVE_CLIENT_SECRET / LEDGER_DRIVE_REFRESH_TOKEN
//   LEDGER_DRIVE_ROOT_FOLDER_ID  (the "ระบบบัญชี2027" folder id; root if unset)
//   LEDGER_DRIVE_PUBLIC_LINKS = "1"  → also grant anyone-with-link reader
//
// If not configured, every export is a graceful no-op (returns null) so LINE
// capture never breaks — the image simply stays on R2.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

export function isDriveConfigured(): boolean {
  return !!(
    process.env.LEDGER_DRIVE_CLIENT_ID &&
    process.env.LEDGER_DRIVE_CLIENT_SECRET &&
    process.env.LEDGER_DRIVE_REFRESH_TOKEN
  );
}

async function getAccessToken(): Promise<string | null> {
  if (!isDriveConfigured()) return null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.LEDGER_DRIVE_CLIENT_ID!,
        client_secret: process.env.LEDGER_DRIVE_CLIENT_SECRET!,
        refresh_token: process.env.LEDGER_DRIVE_REFRESH_TOKEN!,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[ledger:drive] token refresh failed", res.status);
      return null;
    }
    const j = (await res.json()) as { access_token?: string };
    return j.access_token ?? null;
  } catch (e) {
    console.error("[ledger:drive] token error", e);
    return null;
  }
}

const DRIVE_Q = (name: string, parent: string) =>
  `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`;

/** Find or create a folder under `parent`; returns its id (or null on failure). */
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
  bytes: Buffer;
  mimeType: string;
  /** YYYY-MM (Asia/Bangkok period) */
  period: string;
  branchName: string | null; // null → "ส่วนกลาง"
  categoryName: string | null; // null → "ยังไม่จัดหมวด"
  docCode: string;
  vendor: string | null;
  docDate: string | null; // YYYY-MM-DD
}

/**
 * Archive a receipt original into Drive at ระบบบัญชี2027/<period>/<branch>/<category>,
 * named <date>_<vendor>_<docCode>.<ext>. Returns { fileId, webViewLink } or null
 * (graceful) when Drive isn't configured or any step fails.
 */
export async function archiveReceiptToDrive(
  input: DriveArchiveInput,
): Promise<{ fileId: string; webViewLink: string } | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const root = process.env.LEDGER_DRIVE_ROOT_FOLDER_ID || "root";

  const folderId = await ensureFolderPath(
    token,
    [
      input.period,
      sanitize(input.branchName, "ส่วนกลาง"),
      sanitize(input.categoryName, "ยังไม่จัดหมวด"),
    ],
    root,
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
