// DC คลังกลาง · เก็บ "รูปต้นฉบับ" ของสินค้าไว้ใน Google Drive ขององค์กร
//
// Option B (CEO 2026-07-10): รูปสินค้า DC เก็บ 2 ที่ —
//   • ต้นฉบับ (ความละเอียดเต็ม) → Google Drive ขององค์กร  (โมดูลนี้)
//   • สำเนาย่อสำหรับแสดงผล → R2  (lib/dc/product-image-store.ts)
// ค่าที่เก็บเป็น "รูปสินค้า" (imageR2Path) ยังคงเป็น R2 URL เสมอ → การแสดงผล/พิมพ์/lightbox
// ไม่พัง (Drive webViewLink เป็นหน้า viewer ไม่ใช่รูปฝังได้).
//
// REUSE การเชื่อม Google เดิมขององค์กร (getDriveSession — OAuth app เดียวกัน +
// refresh token ที่องค์กรเก็บไว้). scope `drive.file` = เขียนได้เฉพาะโฟลเดอร์ที่แอปสร้างเอง
// → เราสร้างโฟลเดอร์ "DC-รูปสินค้า" ใต้ root ของแอปเอง.
//
// Best-effort ทั้งหมด: ถ้าองค์กรยังไม่เชื่อม Drive หรือ step ใดพัง → คืน null (ไม่ throw)
// → caller ใช้ R2 อย่างเดียวต่อได้ · การอัปโหลดไม่มีวันพังเพราะ Drive.

import crypto from "node:crypto";
import {
  getDriveSession,
  ensureFolder,
} from "@/lib/chairops/storage/drive";

const DC_IMAGE_FOLDER = "DC-รูปสินค้า";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

/** อัปไฟล์ (multipart) เข้าโฟลเดอร์ → { id, webViewLink } หรือ null ถ้าพลาด. */
async function uploadBytes(
  accessToken: string,
  opts: { parentId: string; name: string; mimeType: string; bytes: Buffer },
): Promise<{ id: string; webViewLink: string } | null> {
  const boundary = `dcimg${crypto.randomBytes(8).toString("hex")}`;
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
    console.error("[dc drive] upload failed", await res.text());
    return null;
  }
  const j = (await res.json()) as { id: string; webViewLink?: string };
  return {
    id: j.id,
    webViewLink: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view`,
  };
}

/** เปิดสิทธิ์ "ใครมีลิงก์ก็ดูได้" ให้ไฟล์ (best-effort · non-fatal). */
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
    console.warn("[dc drive] make public failed (non-fatal)", e);
  }
}

/**
 * อัปรูปสินค้า "ต้นฉบับ" เข้า Google Drive ขององค์กร ใต้โฟลเดอร์ "DC-รูปสินค้า".
 * คืน { driveFileId, driveUrl } หรือ null ถ้าองค์กรยังไม่เชื่อม Drive / step ใดพัง.
 * ⚠️ ไม่ throw ทุกกรณี — Drive ต้องไม่ทำให้การอัปโหลดพัง.
 */
export async function uploadDcImageToDrive(opts: {
  orgId: string;
  bytes: Buffer;
  mimeType: string;
  name: string;
  /** โฟลเดอร์ปลายทางใต้ root ของแอป (default = "DC-รูปสินค้า") — แยกที่เก็บได้ เช่น ใบสั่งซื้อ */
  folder?: string;
}): Promise<{ driveFileId: string; driveUrl: string } | null> {
  try {
    const session = await getDriveSession(opts.orgId);
    if (!session) return null; // องค์กรยังไม่เชื่อม Drive → fallback R2 อย่างเดียว
    // สร้าง/หาโฟลเดอร์ปลายทางใต้ root ของแอป (idempotent find-or-create)
    const folderId = await ensureFolder(
      session.accessToken,
      opts.folder ?? DC_IMAGE_FOLDER,
      session.rootFolderId,
    );
    if (!folderId) return null;
    const up = await uploadBytes(session.accessToken, {
      parentId: folderId,
      name: opts.name,
      mimeType: opts.mimeType,
      bytes: opts.bytes,
    });
    if (!up) return null;
    await makePublic(session.accessToken, up.id);
    return { driveFileId: up.id, driveUrl: up.webViewLink };
  } catch (e) {
    console.error("[dc drive] uploadDcImageToDrive failed (non-fatal)", e);
    return null;
  }
}
