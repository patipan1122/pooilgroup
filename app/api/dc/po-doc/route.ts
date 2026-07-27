// DC · อัปโหลด "เอกสารแนบในใบสั่งซื้อ" (ใบกำกับ / Packing / ใบเสร็จ / ฯลฯ) ผ่านเซิร์ฟเวอร์.
//
// ⚠️ อัปผ่านเซิร์ฟเวอร์ (putObject) ไม่ใช่ presigned PUT จาก browser โดยตรง — กัน R2 CORS
//    บล็อกบน custom domain + auth/scope org ก่อนเสมอ (เหมือน /api/dc/upload).
//    รับได้ทั้งรูปและ PDF (เอกสารส่วนใหญ่เป็น PDF/รูปถ่ายบิล).
//
// POST FormData(file, poId, label?) → putObject dc/po-doc/{orgId}/{poId}/{uuid}.{ext}
//   → insert DcPoDocument → { ok, doc }

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { prisma } from "@/lib/prisma";
import { putObject } from "@/lib/r2/upload";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024; // ~15MB (เอกสารบางฉบับใหญ่กว่ารูปสินค้า)

// ชนิดไฟล์ที่อนุญาต → นามสกุล (รูป + PDF)
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!canDcManage(session.user.role)) {
    return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์แนบเอกสารในใบสั่งซื้อ" }, { status: 403 });
  }
  const orgId = session.user.org_id;

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "ข้อมูลไฟล์ไม่ถูกต้อง" }, { status: 400 });
  }

  const poId = String(fd.get("poId") ?? "").trim();
  if (!poId) {
    return NextResponse.json({ ok: false, error: "ไม่พบใบสั่งซื้อ" }, { status: 400 });
  }
  const labelRaw = fd.get("label");
  const label = typeof labelRaw === "string" && labelRaw.trim() !== "" ? labelRaw.trim().slice(0, 120) : null;

  const file = fd.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "ไม่พบไฟล์" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "ไฟล์ว่างเปล่า" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "ไฟล์ใหญ่เกินไป (จำกัด 15MB)" }, { status: 413 });
  }

  const contentType = file.type || "application/octet-stream";
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) {
    return NextResponse.json(
      { ok: false, error: "รองรับเฉพาะรูปภาพ (JPG/PNG/WebP/GIF) หรือ PDF" },
      { status: 415 },
    );
  }

  // ยืนยันว่าใบนี้เป็นของ org ผู้ใช้จริง (กันอ้าง poId ข้ามองค์กร) ก่อนอัปไฟล์
  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: { id: true },
  });
  if (!po) {
    return NextResponse.json({ ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" }, { status: 404 });
  }

  // ชื่อไฟล์ต้นฉบับ (best-effort) — ใช้โชว์ให้คนอ่านออก
  const rawName = (file as File).name || `เอกสาร.${ext}`;
  const fileName = rawName.slice(0, 200);

  const key = `dc/po-doc/${orgId}/${poId}/${randomUUID()}.${ext}`;

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await putObject(key, buf, contentType);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `อัปโหลดไม่สำเร็จ: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  const doc = await prisma.dcPoDocument.create({
    data: {
      orgId,
      poId,
      r2Key: key,
      fileName,
      mimeType: contentType,
      sizeBytes: file.size,
      label,
      uploadedByUserId: session.user.id,
    },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, label: true, createdAt: true },
  });

  return NextResponse.json({ ok: true, doc });
}
