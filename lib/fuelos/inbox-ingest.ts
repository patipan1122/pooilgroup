import { prisma } from "@/lib/prisma";
import { lineMessageToText, lineMessageAttachment, fetchLineProfileName, fetchLineGroupMemberName } from "@/lib/fuelos/line";
import type { Prisma } from "@/lib/generated/prisma/client";

type LineSource = { type?: string; userId?: string; groupId?: string; roomId?: string };
type LineEvent = {
  type?: string;
  message?: {
    type: string; id?: string; text?: string; stickerId?: string; packageId?: string;
    fileName?: string; fileSize?: number; latitude?: number; longitude?: number; title?: string; address?: string;
  };
  source?: LineSource;
  timestamp?: number;
};

type Channel = { id: string; orgId: string; accessTokenEnc: string | null };

// รับ 1 event จาก LINE → เก็บลงกล่องแชท (รองรับทั้งกลุ่มและ 1:1)
export async function ingestLineEvent(channel: Channel, ev: LineEvent): Promise<boolean> {
  if (ev.type !== "message" || !ev.message) return false;
  const src = ev.source ?? {};
  const groupId = src.groupId ?? src.roomId ?? null;
  const lineUserId = src.userId ?? null;
  // ต้องระบุได้ว่ามาจากกลุ่มไหน หรือใคร
  if (!groupId && !lineUserId) return false;

  const token = channel.accessTokenEnc ?? "";
  const body = lineMessageToText(ev.message);
  const attachment = lineMessageAttachment(ev.message);
  const externalId = ev.message.id ?? null;
  const when = ev.timestamp ? new Date(ev.timestamp) : new Date();

  // ผู้ส่งเป็นพนักงานเรา? (จับคู่ LINE userId → รู้ว่าใครตอบ)
  let staffUserId: string | null = null;
  if (lineUserId) {
    const staff = await prisma.staffLineIdentity.findFirst({
      where: { lineUserId, orgId: channel.orgId },
      select: { userId: true },
    });
    staffUserId = staff?.userId ?? null;
  }
  const isStaff = !!staffUserId;

  // หา/สร้างห้องสนทนา
  let conv = await prisma.conversation.findFirst({
    where: groupId
      ? { channelId: channel.id, lineGroupId: groupId }
      : { channelId: channel.id, externalUserId: lineUserId },
    select: { id: true },
  });

  if (!conv) {
    // ดึงชื่อ (best-effort) — กลุ่มใช้ชื่อสมาชิก, 1:1 ใช้ชื่อโปรไฟล์
    let displayName: string | null = null;
    if (token && lineUserId) {
      displayName = groupId
        ? await fetchLineGroupMemberName(token, groupId, lineUserId)
        : await fetchLineProfileName(token, lineUserId);
    }
    conv = await prisma.conversation.create({
      data: {
        orgId: channel.orgId,
        channelId: channel.id,
        lineGroupId: groupId,
        externalUserId: groupId ? null : lineUserId,
        displayName: displayName ?? (groupId ? "กลุ่มลูกค้า" : "ลูกค้า"),
      },
      select: { id: true },
    });
  }

  await prisma.$transaction([
    prisma.message.create({
      data: {
        orgId: channel.orgId,
        conversationId: conv.id,
        direction: isStaff ? "OUT" : "IN",
        senderType: isStaff ? "STAFF" : "CUSTOMER",
        senderLineUserId: lineUserId,
        senderUserId: staffUserId,
        body,
        ...(attachment ? { attachments: attachment as unknown as Prisma.InputJsonValue } : {}),
        externalId,
        createdAt: when,
      },
    }),
    prisma.conversation.update({
      where: { id: conv.id },
      data: isStaff
        ? { isUnanswered: false, lastStaffReplyAt: when, lastMessageAt: when }
        : { isUnanswered: true, lastInboundAt: when, lastMessageAt: when, unreadCount: { increment: 1 } },
    }),
  ]);
  return true;
}
