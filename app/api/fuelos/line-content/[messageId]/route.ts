// พร็อกซีดึงรูป/ไฟล์จาก LINE มาแสดงในกล่องแชท
// ต้อง login + ข้อความต้องอยู่ใน org เดียวกับผู้ใช้ (กันดึง content ข้ามองค์กร)
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/fuelos/auth";
import { fetchLineContent } from "@/lib/fuelos/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const user = await requireUser();
  const { messageId } = await params;

  // ข้อความนี้ต้องอยู่ใน org ของผู้ใช้
  const msg = await prisma.message.findFirst({
    where: { externalId: messageId, orgId: user.orgId },
    select: { conversationId: true },
  });
  if (!msg) return new Response("not found", { status: 404 });

  // เอา access token ของช่องทางที่แชทนี้สังกัด
  const conv = await prisma.conversation.findFirst({
    where: { id: msg.conversationId, orgId: user.orgId },
    select: { channel: { select: { accessTokenEnc: true } } },
  });
  const token = conv?.channel?.accessTokenEnc;
  if (!token) return new Response("no channel token", { status: 404 });

  const r = await fetchLineContent(token, messageId);
  if (!r.ok) {
    // LINE เก็บ content ชั่วคราว → รูปเก่ามากอาจหมดอายุ
    return new Response("content unavailable", { status: 502 });
  }
  return new Response(r.body, {
    status: 200,
    headers: {
      "Content-Type": r.contentType,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
