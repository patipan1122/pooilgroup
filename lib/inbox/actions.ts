"use server";

// Human-side inbox actions: reply, status changes, contact capture.
// Replies use the channel's stored access token (push — human replies are
// outside LINE's 1-min reply window).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { decryptToken } from "./crypto";
import { sendLineMessage, sendFacebookMessage } from "./send";
import { recordOutboundMessage } from "./ingest";

async function loadOwnedConversation(id: string) {
  const session = await requireSession();
  const convo = await prisma.inboxConversation.findFirst({
    where: { id, orgId: session.user.org_id },
    select: {
      id: true,
      orgId: true,
      platform: true,
      externalUserId: true,
      channelId: true,
      channel: { select: { accessTokenEnc: true } },
    },
  });
  if (!convo) throw new Error("ไม่พบบทสนทนา");
  return { session, convo };
}

export async function sendReply(conversationId: string, text: string) {
  const body = text.trim();
  if (!body) throw new Error("พิมพ์ข้อความก่อนส่ง");
  const { session, convo } = await loadOwnedConversation(conversationId);

  const accessToken = decryptToken(convo.channel.accessTokenEnc);
  if (!accessToken) {
    throw new Error("ช่องทางนี้ยังไม่ได้ตั้ง Access Token — ส่งข้อความไม่ได้");
  }

  const input = { body, recipientExternalId: convo.externalUserId, accessToken };
  const res =
    convo.platform === "LINE"
      ? await sendLineMessage(input)
      : await sendFacebookMessage(input);

  await recordOutboundMessage({
    orgId: convo.orgId,
    conversationId,
    channelId: convo.channelId,
    platform: convo.platform,
    body,
    sentByBot: false,
    createdById: session.user.id,
    externalId: res.externalId ?? null,
    error: res.ok ? null : res.error ?? "send failed",
  });

  if (!res.ok) throw new Error(res.error || "ส่งข้อความไม่สำเร็จ");

  // Mark read, but KEEP needsHuman — a holding reply ("รอแป๊บนะคะ") must not drop
  // an unresolved urgent case out of the queue. needsHuman/isUrgent clear only
  // when staff CLOSES the conversation (audit P1).
  await prisma.inboxConversation.update({
    where: { id: conversationId },
    data: { unreadCount: 0 },
  });
  revalidatePath("/inbox");
  return { ok: true };
}

export async function markConversationRead(conversationId: string) {
  const { convo } = await loadOwnedConversation(conversationId);
  await prisma.inboxConversation.update({
    where: { id: convo.id },
    data: { unreadCount: 0 },
  });
  revalidatePath("/inbox");
  return { ok: true };
}

export async function setConversationStatus(
  conversationId: string,
  status: "OPEN" | "SNOOZED" | "CLOSED",
) {
  const { convo } = await loadOwnedConversation(conversationId);
  await prisma.inboxConversation.update({
    where: { id: convo.id },
    // Closing a case resolves it: clear the triage flags so it leaves the queues.
    data:
      status === "CLOSED"
        ? { status, needsHuman: false, isUrgent: false }
        : { status },
  });
  revalidatePath("/inbox");
  return { ok: true };
}

export async function setNeedsHuman(conversationId: string, value: boolean) {
  const { convo } = await loadOwnedConversation(conversationId);
  await prisma.inboxConversation.update({
    where: { id: convo.id },
    data: { needsHuman: value },
  });
  revalidatePath("/inbox");
  return { ok: true };
}

export async function saveContactInfo(
  conversationId: string,
  input: { phone?: string; note?: string },
) {
  const { convo } = await loadOwnedConversation(conversationId);
  await prisma.inboxConversation.update({
    where: { id: convo.id },
    data: {
      contactPhone: input.phone?.trim() || null,
      contactNote: input.note?.trim() || null,
    },
  });
  revalidatePath("/inbox");
  return { ok: true };
}
