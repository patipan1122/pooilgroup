import { prisma } from "@/lib/prisma";
import { lineMessageToText, lineMessageAttachment, fetchLineProfile, fetchLineGroupMemberProfile, fetchLineGroupSummary, type LineEmoji } from "@/lib/fuelos/line";
import type { Prisma } from "@/lib/generated/prisma/client";

type LineSource = { type?: string; userId?: string; groupId?: string; roomId?: string };
type LineEvent = {
  type?: string;
  message?: {
    type: string; id?: string; text?: string; stickerId?: string; packageId?: string;
    fileName?: string; fileSize?: number; latitude?: number; longitude?: number; title?: string; address?: string;
    emojis?: LineEmoji[];
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
  const realGroupId = src.groupId ?? null; // เฉพาะ group จริง — room ไม่มี summary API (กันยิงซ้ำ)
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

  // เก็บ "ตัวตนของคนใน LINE" (ชื่อจริง + รูปโปรไฟล์) ต่อ lineUserId — เฉพาะลูกค้า (ไม่ใช่พนักงานเรา)
  // ดึงโปรไฟล์จาก LINE เฉพาะครั้งแรก (ตอนยังไม่มีชื่อ) แล้ว cache ไว้ในตาราง → ประหยัด API
  // ⚠️ หุ้ม try/catch: ถ้า contact ล้ม (เช่น migration ยังไม่ apply / LINE API ล่ม) ต้อง "ไม่บล็อก"
  //    การเก็บข้อความ — ห้ามทำข้อความลูกค้าหาย (webhook กลืน error → LINE ไม่ retry)
  let contactName: string | null = null;
  if (lineUserId && !isStaff) {
    try {
      const existing = await prisma.fuelLineContact.findUnique({
        where: { channelId_lineUserId: { channelId: channel.id, lineUserId } },
        select: { displayName: true, alias: true },
      });
      if (token && (!existing || !existing.displayName)) {
        const prof = groupId
          ? await fetchLineGroupMemberProfile(token, groupId, lineUserId)
          : await fetchLineProfile(token, lineUserId);
        await prisma.fuelLineContact.upsert({
          where: { channelId_lineUserId: { channelId: channel.id, lineUserId } },
          create: {
            orgId: channel.orgId, channelId: channel.id, lineUserId,
            displayName: prof?.displayName ?? null, pictureUrl: prof?.pictureUrl ?? null, lastSeenAt: when,
          },
          update: {
            ...(prof?.displayName ? { displayName: prof.displayName } : {}),
            ...(prof?.pictureUrl ? { pictureUrl: prof.pictureUrl } : {}),
            lastSeenAt: when,
          },
        });
        contactName = existing?.alias ?? prof?.displayName ?? null;
      } else if (existing) {
        await prisma.fuelLineContact.update({
          where: { channelId_lineUserId: { channelId: channel.id, lineUserId } },
          data: { lastSeenAt: when },
        });
        contactName = existing.alias ?? existing.displayName ?? null;
      }
    } catch {
      // contact ล้ม → ข้ามไป เก็บข้อความต่อ (ห้ามทำข้อความหาย)
    }
  }

  // หา/สร้างห้องสนทนา
  let conv = await prisma.conversation.findFirst({
    where: groupId
      ? { channelId: channel.id, lineGroupId: groupId }
      : { channelId: channel.id, externalUserId: lineUserId },
    select: { id: true, pictureUrl: true },
  });

  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        orgId: channel.orgId,
        channelId: channel.id,
        lineGroupId: groupId,
        externalUserId: groupId ? null : lineUserId,
        displayName: contactName ?? (groupId ? "กลุ่มลูกค้า" : "ลูกค้า"),
      },
      select: { id: true, pictureUrl: true },
    });
  }

  // cache รูป + ชื่อกลุ่มจาก LINE — ดึงครั้งเดียวตอนยังไม่มีรูป (ประหยัด API · best-effort)
  // ⚠️ เฉพาะ group จริง (ไม่ใช่ room/1:1) · ห่อ try/catch ห้ามบล็อกการเก็บข้อความ
  if (realGroupId && token && !conv.pictureUrl) {
    try {
      const summary = await fetchLineGroupSummary(token, realGroupId);
      if (summary && (summary.pictureUrl || summary.groupName)) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            ...(summary.pictureUrl ? { pictureUrl: summary.pictureUrl } : {}),
            ...(summary.groupName ? { lineGroupName: summary.groupName } : {}),
          },
        });
      }
    } catch {
      // ดึง summary ล้ม → ข้าม (เก็บข้อความต่อ)
    }
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
