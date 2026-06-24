// DC คลังกลาง · อัปโหลดรูปสินค้าในใบสั่งซื้อจีน (PO line photo) ผ่านเซิร์ฟเวอร์
//
// ⚠️ อัปผ่านเซิร์ฟเวอร์ (putObject) ไม่ใช่ presigned PUT จาก browser โดยตรง —
//    กัน R2 CORS บล็อกบน custom domain (บทเรียน [[pinpoint-screenshot-cors-server-upload]]
//    / [[clawhub-reward-image-upload-cors]]). auth ก่อนเสมอ + จำกัดขนาด/ชนิดไฟล์.
//
// POST FormData(file) → putObject under dc/po/{orgId}/{uuid}.{ext} → { ok, key, url }

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { putObject } from "@/lib/r2/upload";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // ~8MB

// ชนิดไฟล์ที่อนุญาต → นามสกุล (กัน upload ไฟล์แปลกปลอม)
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const orgId = session.user.org_id;

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "ข้อมูลไฟล์ไม่ถูกต้อง" }, { status: 400 });
  }

  const file = fd.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "ไม่พบไฟล์รูป" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "ไฟล์รูปว่างเปล่า" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "ไฟล์ใหญ่เกินไป (จำกัด 8MB)" },
      { status: 413 },
    );
  }

  const contentType = file.type || "application/octet-stream";
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) {
    return NextResponse.json(
      { ok: false, error: "รองรับเฉพาะรูปภาพ (JPG/PNG/WebP/GIF)" },
      { status: 415 },
    );
  }

  const key = `dc/po/${orgId}/${randomUUID()}.${ext}`;

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const url = await putObject(key, buf, contentType);
    return NextResponse.json({ ok: true, key, url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `อัปโหลดไม่สำเร็จ: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
