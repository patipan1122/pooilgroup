"use server";

// Recruit messaging server actions.
//
// CURRENT STATE (Phase B-full):
// - INAPP channel: fully implemented · messages stored + visible to admin
// - LINE / SMS / EMAIL: stored as QUEUED · actual sending requires external setup
//   (LINE OA webhook + Messaging API · SMS gateway · Resend already wired for email)
//
// EMAIL is the only outbound channel that works today (via existing Resend).
// LINE/SMS show as QUEUED with a clear "TODO: connect" admin badge.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { canRecruitWrite } from "./role-guard";
import { decryptToken } from "./channel-crypto";
import { sendLineMessage, sendFacebookMessage } from "./inbox-send";

type Channel = "LINE" | "SMS" | "EMAIL" | "INAPP" | "FACEBOOK";

export interface SendMessageInput {
  applicationId: string;
  channel: Channel;
  body: string;
  /** Optional: when replying to a specific inbound thread on LINE/FB · we'll
   *  resolve channelInstanceId + recipient external id from the last inbound
   *  message. Passing explicit channelInstanceId overrides that. */
  channelInstanceId?: string;
}

export async function sendMessage(input: SendMessageInput) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const body = input.body.trim();
  if (!body) throw new Error("กรอกข้อความ");

  const app = await prisma.recruitApplication.findUnique({
    where: { id: input.applicationId },
    select: {
      orgId: true,
      applicant: {
        select: {
          fullName: true,
          phone: true,
          email: true,
          lineId: true,
          lineUserId: true,
          facebookPsid: true,
        },
      },
    },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");
  if (app.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  // Validate channel can be used for this applicant
  if (input.channel === "LINE" && !app.applicant.lineUserId && !app.applicant.lineId) {
    throw new Error("ผู้สมัครยังไม่ได้ทัก LINE · ให้ผู้สมัครทักหา OA ก่อน");
  }
  if (input.channel === "FACEBOOK" && !app.applicant.facebookPsid) {
    throw new Error("ผู้สมัครยังไม่ได้ทัก Facebook · ให้ผู้สมัครทักหา Page ก่อน");
  }
  if (input.channel === "SMS" && !app.applicant.phone) {
    throw new Error("ผู้สมัครไม่มีเบอร์โทร");
  }
  if (input.channel === "EMAIL" && !app.applicant.email) {
    throw new Error("ผู้สมัครไม่มีอีเมล");
  }

  // For LINE/FB outbound, resolve the channel instance + access token.
  // Pick by explicit input · else use the channel from the most recent inbound message.
  let channelInstanceId: string | null = null;
  let accessToken: string | null = null;
  let replyToken: string | null = null;

  if (input.channel === "LINE" || input.channel === "FACEBOOK") {
    let instanceId = input.channelInstanceId ?? null;

    if (!instanceId) {
      const lastInbound = await prisma.recruitMessage.findFirst({
        where: {
          applicationId: input.applicationId,
          direction: "IN",
          channel: input.channel,
          channelInstanceId: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: { channelInstanceId: true, replyToken: true },
      });
      if (lastInbound?.channelInstanceId) {
        instanceId = lastInbound.channelInstanceId;
        if (input.channel === "LINE" && lastInbound.replyToken) {
          // Use reply token if last inbound was within 1 minute
          replyToken = lastInbound.replyToken;
        }
      }
    }

    if (!instanceId) {
      throw new Error(
        `ยังไม่ได้เชื่อม ${input.channel} channel · เพิ่มที่ /recruit/settings/channels`,
      );
    }

    const channel = await prisma.recruitInboxChannel.findUnique({
      where: { id: instanceId },
      select: { orgId: true, accessTokenEnc: true, status: true },
    });
    if (!channel || channel.orgId !== app.orgId) {
      throw new Error("ไม่พบ channel หรือไม่มีสิทธิ์");
    }
    if (channel.status === "disabled") {
      throw new Error("Channel ปิดใช้งานอยู่ · เปิดที่ /recruit/settings/channels ก่อน");
    }
    accessToken = decryptToken(channel.accessTokenEnc);
    if (!accessToken) {
      throw new Error("ยังไม่ได้ใส่ access token ของ channel · เพิ่มที่ /recruit/settings/channels");
    }
    channelInstanceId = instanceId;
  }

  // Persist message (initial state QUEUED for external channels)
  const msg = await prisma.recruitMessage.create({
    data: {
      orgId: app.orgId,
      applicationId: input.applicationId,
      channel: input.channel,
      direction: "OUT",
      body,
      status: input.channel === "INAPP" ? "SENT" : "QUEUED",
      channelInstanceId,
      createdById: session.user.id,
      sentAt: input.channel === "INAPP" ? new Date() : null,
    },
  });

  // Outbound delivery
  let deliveryError: string | null = null;
  if (input.channel === "LINE" && accessToken && app.applicant.lineUserId) {
    const result = await sendLineMessage({
      body,
      recipientExternalId: app.applicant.lineUserId,
      accessToken,
      replyToken,
    });
    if (result.ok) {
      await prisma.recruitMessage.update({
        where: { id: msg.id },
        data: { status: "SENT", sentAt: new Date(), externalId: result.externalId ?? null },
      });
    } else {
      deliveryError = result.error ?? "send failed";
      await prisma.recruitMessage.update({
        where: { id: msg.id },
        data: { status: "FAILED", errorMessage: deliveryError },
      });
    }
  } else if (input.channel === "FACEBOOK" && accessToken && app.applicant.facebookPsid) {
    const result = await sendFacebookMessage({
      body,
      recipientExternalId: app.applicant.facebookPsid,
      accessToken,
    });
    if (result.ok) {
      await prisma.recruitMessage.update({
        where: { id: msg.id },
        data: { status: "SENT", sentAt: new Date(), externalId: result.externalId ?? null },
      });
    } else {
      deliveryError = result.error ?? "send failed";
      await prisma.recruitMessage.update({
        where: { id: msg.id },
        data: { status: "FAILED", errorMessage: deliveryError },
      });
    }
  }
  // EMAIL / SMS still QUEUED — wired in a later pass

  await audit({
    orgId: app.orgId,
    userId: session.user.id,
    action: "RECRUIT_MESSAGE_SENT",
    resourceType: "recruit_message",
    resourceId: msg.id,
    diff: { new: { channel: input.channel, length: body.length, deliveryError } },
  });

  revalidatePath("/recruit/messages");
  revalidatePath(`/recruit/applications/${input.applicationId}`);
  return { ok: true, messageId: msg.id, deliveryError };
}

export async function listThreads(orgId: string) {
  // Strict org isolation — even super_admin must pass their own org_id from
  // a tenant-aware switcher. Bypassing this previously created a cross-org
  // leak (see wiring audit 2026-05-22 Bug #4).
  const session = await requireSession();
  if (orgId !== session.user.org_id) {
    throw new Error("ไม่มีสิทธิ์ดูข้อความองค์กรอื่น");
  }
  // Group messages by application · take most recent per app
  const messages = await prisma.recruitMessage.findMany({
    where: { orgId: session.user.org_id },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      application: {
        select: {
          id: true,
          applicant: { select: { fullName: true, phone: true } },
          posting: { select: { title: true } },
        },
      },
    },
  });

  const threads = new Map<
    string,
    {
      applicationId: string;
      applicantName: string;
      phone: string;
      postingTitle: string;
      lastMessage: string;
      lastChannel: Channel;
      lastAt: Date;
      lastDirection: "IN" | "OUT";
      unread: number;
    }
  >();

  for (const m of messages) {
    const key = m.applicationId;
    if (!threads.has(key)) {
      threads.set(key, {
        applicationId: m.applicationId,
        applicantName: m.application.applicant.fullName,
        phone: m.application.applicant.phone,
        postingTitle: m.application.posting.title,
        lastMessage: m.body,
        lastChannel: m.channel as Channel,
        lastAt: m.createdAt,
        lastDirection: m.direction as "IN" | "OUT",
        unread: 0,
      });
    }
    if (m.direction === "IN" && m.status !== "READ") {
      const t = threads.get(key)!;
      t.unread++;
    }
  }

  return [...threads.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

export async function markThreadRead(applicationId: string) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) throw new Error("ไม่มีสิทธิ์");
  await prisma.recruitMessage.updateMany({
    where: {
      applicationId,
      orgId: session.user.org_id,
      direction: "IN",
      status: { not: "READ" },
    },
    data: { status: "READ" },
  });
  revalidatePath("/recruit/messages");
  return { ok: true };
}
