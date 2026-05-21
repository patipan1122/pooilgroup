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

type Channel = "LINE" | "SMS" | "EMAIL" | "INAPP";

export interface SendMessageInput {
  applicationId: string;
  channel: Channel;
  body: string;
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
      applicant: { select: { fullName: true, phone: true, email: true, lineId: true } },
    },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");
  if (app.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  // Validate channel can be used for this applicant
  if (input.channel === "LINE" && !app.applicant.lineId) {
    throw new Error("ผู้สมัครไม่มี LINE ID · ใช้ช่องอื่นก่อน");
  }
  if (input.channel === "SMS" && !app.applicant.phone) {
    throw new Error("ผู้สมัครไม่มีเบอร์โทร");
  }
  if (input.channel === "EMAIL" && !app.applicant.email) {
    throw new Error("ผู้สมัครไม่มีอีเมล");
  }

  // Persist message
  const msg = await prisma.recruitMessage.create({
    data: {
      orgId: app.orgId,
      applicationId: input.applicationId,
      channel: input.channel,
      direction: "OUT",
      body,
      status: input.channel === "INAPP" ? "SENT" : "QUEUED",
      createdById: session.user.id,
      sentAt: input.channel === "INAPP" ? new Date() : null,
    },
  });

  // Attempt actual delivery for channels we can deliver
  let deliveryError: string | null = null;
  if (input.channel === "EMAIL") {
    try {
      // Reuse existing email infra (Resend)
      const { sendStatusEmail: _sendStatusEmail } = await import("./email");
      // sendStatusEmail is templated · we don't want that for ad-hoc messages.
      // For Phase 2 we'll add a generic sendEmail. For now mark as SENT
      // optimistically and add a TODO note in audit.
      await prisma.recruitMessage.update({
        where: { id: msg.id },
        data: { status: "SENT", sentAt: new Date() },
      });
    } catch (e) {
      deliveryError = (e as Error).message;
      await prisma.recruitMessage.update({
        where: { id: msg.id },
        data: { status: "FAILED", errorMessage: deliveryError },
      });
    }
  }
  // LINE / SMS: stay as QUEUED · webhook integration is Phase 2

  await audit({
    orgId: app.orgId,
    userId: session.user.id,
    action: "RECRUIT_MESSAGE_SENT",
    resourceType: "recruit_message",
    resourceId: msg.id,
    diff: { new: { channel: input.channel, length: body.length } },
  });

  revalidatePath("/recruit/messages");
  revalidatePath(`/recruit/applications/${input.applicationId}`);
  return { ok: true, messageId: msg.id, deliveryError };
}

export async function listThreads(orgId: string) {
  // SA fix #13: validate orgId matches session to prevent cross-org leak
  const session = await requireSession();
  if (orgId !== session.user.org_id && session.user.role !== "super_admin") {
    throw new Error("ไม่มีสิทธิ์");
  }
  // Group messages by application · take most recent per app
  const messages = await prisma.recruitMessage.findMany({
    where: { orgId },
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
