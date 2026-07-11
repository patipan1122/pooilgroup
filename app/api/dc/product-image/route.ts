// DC คลังกลาง · อัปโหลด "รูปสินค้า" (ถ่าย/เลือกไฟล์) ผ่านเซิร์ฟเวอร์
//
// ต่างจาก /api/dc/upload (สกรีนช็อต 1688 → OCR) ตรงนี้คือ path ของ "รูปสินค้าจริง":
//   เก็บสำเนาย่อลง R2 (แสดงผล) + ต้นฉบับลง Drive (best-effort) ผ่าน storeDcProductImage.
//   url ที่คืน = R2 display URL เสมอ → เอาไปเป็น imageR2Path (การแสดงผลไม่พัง).
//
// auth เหมือน /api/dc/upload: requireSession + org_id + จำกัดชนิด/ขนาดไฟล์.
// POST FormData(file) → { ok, url, driveUrl }

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { storeDcProductImage } from "@/lib/dc/product-image-store";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024; // ~12MB (รูปกล้องมือถือใหญ่ได้ · sharp ย่อให้อยู่แล้ว)

// ชนิดไฟล์ที่อนุญาต (กัน upload ไฟล์แปลกปลอม)
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

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
      { ok: false, error: "ไฟล์ใหญ่เกินไป (จำกัด 12MB)" },
      { status: 413 },
    );
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json(
      { ok: false, error: "รองรับเฉพาะรูปภาพ (JPG/PNG/WebP/GIF/HEIC)" },
      { status: 415 },
    );
  }

  // ชื่อไฟล์เดิม (ถ้ามี) → ใช้ตั้งชื่อต้นฉบับใน Drive
  const name =
    (file instanceof File && file.name ? file.name : "").trim() || "dc-product";

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { url, driveUrl } = await storeDcProductImage({
      orgId,
      bytes: buf,
      mimeType: contentType,
      name,
    });
    return NextResponse.json({ ok: true, url, driveUrl });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `อัปโหลดไม่สำเร็จ: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
