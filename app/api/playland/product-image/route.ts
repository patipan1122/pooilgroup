// POST /api/playland/product-image
// ────────────────────────────────────────────────────────────────────
// Server-side R2 upload for Playland product photos. Bypasses R2 CORS by
// streaming the file through the Next.js server (same pattern as
// docuflow/upload-proxy) — browser → R2 PUT fails silently on prod when
// the bucket CORS allowlist doesn't include the custom domain.
//
// Accepts multipart: file (image Blob). Returns: { key }.
// The key is stored in PlaylandProduct.imageR2Path and resolved to a
// public URL by the front shell (app/(admin)/playland/page.tsx).
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandManage } from "@/lib/playland/role-guard";
import { putObject } from "@/lib/r2/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — รูปสินค้าทั่วไปพอ

// magic-bytes → MIME (อ่านจริงจากไฟล์ ไม่เชื่อ extension)
function sniffImageMime(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) return "image/webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  return null;
}

export async function POST(req: NextRequest) {
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET ||
    !process.env.R2_PUBLIC_URL
  ) {
    return NextResponse.json({ error: "R2 env vars are not configured" }, { status: 500 });
  }

  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canPlaylandManage(session.user.role)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad form data" }, { status: 400 });
  }

  const file = fd.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 5 MB" }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImageMime(buf);
  if (!mime) {
    return NextResponse.json({ error: "รองรับเฉพาะ JPEG / PNG / WebP / GIF" }, { status: 415 });
  }

  const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
  const uniq = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `playland/${session.user.org_id}/products/${Date.now()}-${uniq}.${ext}`;

  try {
    await putObject(key, buf, mime);
  } catch (e) {
    console.error("[playland/product-image] R2 put failed", e);
    return NextResponse.json(
      { error: "ส่งรูปไป R2 ไม่สำเร็จ", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  return NextResponse.json({ key });
}
