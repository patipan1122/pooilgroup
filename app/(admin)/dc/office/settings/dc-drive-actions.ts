"use server";

// DC คลังกลาง · เชื่อม Google Drive จาก "ในหน้า DC เอง" (CEO งงว่าทำไมต้องไปกดที่ recruit).
//   ★ เป็นการเชื่อม Google "บัญชีเดียวของทั้งบริษัท" (เก็บต่อ-org · ใช้ร่วม ChairOps/Ledger/Recruit/DC)
//     — action นี้แค่เริ่ม OAuth เดิม + ตั้ง return cookie ให้เด้งกลับหน้า DC settings.
//   รูปสินค้า DC จะไปเก็บโฟลเดอร์ "DC-รูปสินค้า" แยก (ไม่ปนโปรแกรมอื่น).

import { cookies } from "next/headers";
import crypto from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import {
  isDriveOAuthConfigured,
  buildConsentUrl,
  getDriveConnection,
  getDriveSession,
  ensureFolder,
} from "@/lib/chairops/storage/drive";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_RETURN_COOKIE,
  callbackRedirectUri,
} from "@/lib/chairops/storage/drive-oauth";

const RETURN_PATH = "/dc/office/settings";
const DC_IMAGE_FOLDER = "DC-รูปสินค้า";

/** เริ่มเชื่อม Google Drive (org-wide) → เด้งกลับหน้า DC settings. เฉพาะ super admin. */
export async function startDcDriveConnect(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) {
    return { ok: false, error: "เฉพาะเจ้าของระบบ (super admin) เชื่อมต่อได้" };
  }
  if (!isDriveOAuthConfigured()) {
    return {
      ok: false,
      error: "ยังไม่ได้ตั้งค่า Google OAuth (GOOGLE_OAUTH_CLIENT_ID / SECRET) ใน Vercel",
    };
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  jar.set(OAUTH_STATE_COOKIE, nonce, opts);
  jar.set(OAUTH_RETURN_COOKIE, RETURN_PATH, opts);
  return { ok: true, url: buildConsentUrl(await callbackRedirectUri(), nonce) };
}

/** สถานะ Drive สำหรับหน้า DC — connected? + ลิงก์เปิดโฟลเดอร์ "DC-รูปสินค้า" (best-effort). */
export async function getDcDriveStatus(): Promise<{ connected: boolean; folderUrl: string | null }> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const conn = await getDriveConnection(orgId);
  if (!conn) return { connected: false, folderUrl: null };
  // เชื่อมแล้ว → หา/สร้างโฟลเดอร์ DC (idempotent) เพื่อทำลิงก์เปิดดู (พังก็แค่ไม่มีลิงก์)
  try {
    const s = await getDriveSession(orgId);
    if (!s) return { connected: true, folderUrl: null };
    const folderId = await ensureFolder(s.accessToken, DC_IMAGE_FOLDER, s.rootFolderId);
    return {
      connected: true,
      folderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : null,
    };
  } catch {
    return { connected: true, folderUrl: null };
  }
}
