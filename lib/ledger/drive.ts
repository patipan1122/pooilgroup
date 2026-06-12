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
import { prisma } from "@/lib/prisma";

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

/**
 * Health-check: verifies that the org's Drive connection is actually usable —
 * not just that a DB row exists. Checks in order:
 *   1. OAuth app env vars present
 *   2. DB row exists (org has connected)
 *   3. Refresh token decrypts (CHAIROPS_DRIVE_CRYPTO_KEY still matches)
 *   4. Access token can be obtained from Google (refresh token still valid)
 *   5. Drive API responds (lightweight about/get call)
 * Returns { ok: true } or { ok: false, reason } — never throws.
 */
export async function testDriveConnection(orgId: string): Promise<{
  ok: boolean;
  reason?: "not_configured" | "no_connection" | "decrypt_failed" | "token_refresh_failed" | "api_error";
}> {
  if (!isDriveOAuthConfigured()) return { ok: false, reason: "not_configured" };
  try {
    const conn = await getDriveConnection(orgId);
    if (!conn) return { ok: false, reason: "no_connection" };
    const refreshToken = decryptToken(conn.refreshTokenEnc);
    if (!refreshToken) return { ok: false, reason: "decrypt_failed" };
    const accessToken = await refreshAccessToken(refreshToken);
    if (!accessToken) return { ok: false, reason: "token_refresh_failed" };
    // Lightweight Drive probe — about/get returns only the user's email + quota.
    const probe = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user",
      { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(6000) },
    );
    if (!probe.ok) return { ok: false, reason: "api_error" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "api_error" };
  }
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

/** DB-backed folder cache — avoids Drive API search on every upload and prevents
 *  duplicate folders from concurrent requests (DB UNIQUE constraint is the lock). */
async function cachedEnsureFolder(
  token: string,
  orgId: string,
  name: string,
  parent: string,
): Promise<string | null> {
  // 1. DB cache hit (fast path — ~0.1ms, no Drive API call)
  const cached = await prisma.driveFolderCache.findUnique({
    where: { orgId_parentId_name: { orgId, parentId: parent, name } },
    select: { folderId: true },
  });
  if (cached) return cached.folderId;

  // 2. Cache miss — create folder in Drive
  try {
    const created = await fetch(`${FILES_URL}?fields=id`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!created.ok) {
      // Drive create failed — another concurrent request may have won; check cache again
      const retry = await prisma.driveFolderCache.findUnique({
        where: { orgId_parentId_name: { orgId, parentId: parent, name } },
        select: { folderId: true },
      });
      return retry?.folderId ?? null;
    }
    const { id: folderId } = (await created.json()) as { id: string };

    // 3. Store in DB cache — ON CONFLICT (unique) = another request beat us, keep theirs.
    // P2#8: upsert returns the resulting row directly — no second findUnique needed.
    const row = await prisma.driveFolderCache.upsert({
      where: { orgId_parentId_name: { orgId, parentId: parent, name } },
      create: { orgId, parentId: parent, name, folderId },
      update: {}, // conflict = keep the first-inserted row; don't overwrite folderId
    });

    // 4. Return the canonical folder ID directly from the upsert result (saves 1 DB roundtrip).
    return row.folderId;
  } catch (e) {
    console.error("[ledger:drive] cachedEnsureFolder error", e);
    return null;
  }
}

async function ensureFolderPath(
  token: string,
  segments: string[],
  rootId: string,
  orgId: string,
): Promise<string | null> {
  let parent = rootId;
  for (const seg of segments) {
    const id = await cachedEnsureFolder(token, orgId, seg.slice(0, 120) || "ไม่ระบุ", parent);
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
  const baseId = explicitRoot || (await cachedEnsureFolder(token, input.orgId, ROOT_NAME, "root"));
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
    input.orgId,
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

/**
 * Archive ONE expense's receipt (by id) into Drive — loads the row + R2 image +
 * folder names, uploads, and stores the Drive link back. Idempotent (already-
 * archived → returns the existing link). Graceful no-op if Drive isn't connected.
 * Shared by the /api/ledger/drive/sync route (manual) AND the auto-archive
 * fire-and-forget calls on capture/confirm — one source of truth.
 */
export async function archiveExpenseToDrive(args: {
  orgId: string;
  companyId: string;
  id: string;
}): Promise<{ ok: boolean; driveWebUrl?: string; already?: boolean; notConfigured?: boolean; error?: string }> {
  if (!isDriveConfigured()) return { ok: false, notConfigured: true, error: "ยังไม่ได้ตั้งค่า Google Drive" };

  const exp = await prisma.ledgerExpense.findFirst({
    where: { id: args.id, orgId: args.orgId, companyId: args.companyId },
    select: {
      id: true, docCode: true, vendor: true, docDate: true, thumbUrl: true,
      originalUrl: true, driveFileId: true, driveWebUrl: true, branchId: true,
      category: { select: { name: true } },
    },
  });
  if (!exp) return { ok: false, error: "ไม่พบรายการ" };
  if (exp.driveFileId && exp.driveWebUrl) return { ok: true, driveWebUrl: exp.driveWebUrl, already: true };

  const srcUrl = exp.thumbUrl || exp.originalUrl;
  if (!srcUrl || !/^https?:\/\//.test(srcUrl)) return { ok: false, error: "ไม่มีไฟล์รูปให้ส่ง" };
  let bytes: Buffer;
  let mimeType = "image/jpeg";
  try {
    const r = await fetch(srcUrl, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    bytes = Buffer.from(await r.arrayBuffer());
    mimeType = r.headers.get("content-type") || "image/jpeg";
  } catch {
    return { ok: false, error: "โหลดรูปไม่สำเร็จ" };
  }

  const bkk = new Date(Date.now() + 7 * 3600_000); // Asia/Bangkok month folder
  const period = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}`;
  const [branchRow, companyRow] = await Promise.all([
    exp.branchId
      ? prisma.branch.findUnique({ where: { id: exp.branchId }, select: { name: true } })
      : Promise.resolve(null),
    prisma.company.findUnique({ where: { id: args.companyId }, select: { name: true } }),
  ]);

  const drive = await archiveReceiptToDrive({
    orgId: args.orgId,
    bytes,
    mimeType,
    period,
    companyName: companyRow?.name ?? null,
    branchName: branchRow?.name ?? null,
    categoryName: exp.category?.name ?? null,
    docCode: exp.docCode,
    vendor: exp.vendor,
    docDate: exp.docDate ? exp.docDate.toISOString().slice(0, 10) : null,
  });
  if (!drive) return { ok: false, error: "ส่งเข้า Drive ไม่สำเร็จ" };

  // P1#7 — DB update retry: Drive file already exists; if DB save fails we have an
  // orphaned Drive file with no pointer back. Retry up to 3× (500ms apart) so a
  // transient DB hiccup doesn't lose the link. After all retries fail, log a CRITICAL
  // message so the CEO can find orphaned files via a log search.
  let dbSaved = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await prisma.ledgerExpense.update({
        where: { id: exp.id },
        data: { driveFileId: drive.fileId, driveWebUrl: drive.webViewLink },
      });
      dbSaved = true;
      break;
    } catch (dbErr) {
      console.error(`[ledger:drive] DB update attempt ${attempt}/3 failed for expenseId=${exp.id}`, dbErr);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!dbSaved) {
    console.error(
      `[ledger:drive] CRITICAL: uploaded fileId=${drive.fileId} to Drive but DB update failed — manual recovery needed (expenseId=${exp.id})`,
    );
    // Still return the Drive link so the immediate caller can surface it to the user;
    // the orphaned file can be reconciled via a /api/ledger/drive/sync call later.
    return { ok: false, error: "บันทึก Drive link ไม่สำเร็จ — กรุณาลองซิงค์อีกครั้ง" };
  }
  return { ok: true, driveWebUrl: drive.webViewLink };
}
/**
 * The browseable Google Drive FOLDER link for this org's LedgerLine archive root
 * ("ระบบบัญชี2027"). Ensures the folder exists, returns its Drive URL. Powers the
 * `/drive` LINE command + the in-app "ดูโฟลเดอร์ Drive" button so the accountant can
 * jump straight to where every receipt is filed (เดือน/ธุรกิจ/สาขา/ประเภท).
 * Returns null when Drive isn't connected for the org (caller shows a hint).
 */
export async function getLedgerDriveFolderLink(orgId: string): Promise<string | null> {
  const token = await getAccessToken(orgId);
  if (!token) return null;
  const explicitRoot = process.env.LEDGER_DRIVE_ROOT_FOLDER_ID;
  const baseId = explicitRoot || (await cachedEnsureFolder(token, orgId, ROOT_NAME, "root"));
  if (!baseId) return null;
  return `https://drive.google.com/drive/folders/${baseId}`;
}
