// DC · โหลด "เอกสารแนบในใบสั่งซื้อ" — GET แบบมีสิทธิ์ (ไม่เปิด public).
// เอกสารการเงิน (ใบกำกับ/ใบเสร็จ) ต้องตรวจ session + org + ว่าเอกสารอยู่ในใบนี้จริง
// ก่อน stream จาก R2. ไม่พบ/ข้ามองค์กร = 404. เปิด inline (พรีวิว PDF/รูปในแท็บได้).

import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/r2/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id, docId } = await params;
  const session = await requireSession();
  if (!session || !canDcManage(session.user.role)) notFound();
  const orgId = session.user.org_id;

  const doc = await prisma.dcPoDocument.findFirst({
    where: { id: docId, poId: id, orgId },
    select: { r2Key: true, fileName: true, mimeType: true },
  });
  if (!doc) notFound();

  let buf: Buffer;
  try {
    buf = await getObject(doc.r2Key);
  } catch {
    notFound();
  }

  // ชื่อไฟล์รองรับภาษาไทย → filename*=UTF-8''
  const encoded = encodeURIComponent(doc.fileName);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
}
