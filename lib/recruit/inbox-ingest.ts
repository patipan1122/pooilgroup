// Shared helpers for ingesting inbound webhook events from LINE / FB
// Creates/matches RecruitApplicant + persists RecruitMessage row.

import { prisma } from "@/lib/prisma";

export interface IngestParams {
  channelInstanceId: string;
  orgId: string;
  channel: "LINE" | "FACEBOOK";
  /** LINE userId / FB PSID — opaque per-channel identifier */
  senderExternalId: string;
  /** Best-effort display name (LINE: profile.displayName · FB: PSID is opaque so we leave blank) */
  senderDisplayName?: string | null;
  body: string;
  /** Optional structured attachments (images, stickers, files) */
  attachments?: unknown;
  /** Provider-side message ID (for idempotency / debugging) */
  externalId?: string | null;
  /** LINE-only: 1-minute reply token (cheaper than push API) */
  replyToken?: string | null;
}

/**
 * Persist one inbound message · returns the recruit_application id for
 * downstream pushes (e.g. realtime stream / unread counters).
 *
 * Matching rules:
 *   1. Find applicant by (orgId, lineUserId/facebookPsid)
 *   2. If none, create a stub applicant with channel id as primary phone-equiv
 *   3. Find latest application for that applicant in this org; if none, create
 *      a draft "INBOX" application so the message has an anchor row.
 */
export async function ingestInboundMessage(p: IngestParams) {
  const idField = p.channel === "LINE" ? "lineUserId" : "facebookPsid";

  let applicant = await prisma.recruitApplicant.findFirst({
    where: { orgId: p.orgId, [idField]: p.senderExternalId } as Record<string, unknown>,
  });

  if (!applicant) {
    // Synthesize a stub — phone must be unique-ish so we use the external ID
    // prefixed with channel type. HR can correct phone later when applicant
    // also fills /apply form.
    const phonePlaceholder = `${p.channel.toLowerCase()}:${p.senderExternalId.slice(0, 32)}`;
    applicant = await prisma.recruitApplicant.create({
      data: {
        orgId: p.orgId,
        fullName: p.senderDisplayName?.trim() || `ผู้ติดต่อทาง ${p.channel}`,
        phone: phonePlaceholder,
        [idField]: p.senderExternalId,
      } as Parameters<typeof prisma.recruitApplicant.create>[0]["data"],
    });
  } else if (p.senderDisplayName && applicant.fullName.startsWith("ผู้ติดต่อทาง")) {
    // Upgrade placeholder name once we discover the real display name
    await prisma.recruitApplicant.update({
      where: { id: applicant.id },
      data: { fullName: p.senderDisplayName },
    });
  }

  // Find or create an anchor RecruitApplication so the message can attach.
  let application = await prisma.recruitApplication.findFirst({
    where: { applicantId: applicant.id, orgId: p.orgId },
    orderBy: { submittedAt: { sort: "desc", nulls: "last" } },
  });

  if (!application) {
    // Need a posting to attach to — pick the most recent OPEN one;
    // if none, pick any from the org (DM-only inquiry · no posting yet).
    const posting =
      (await prisma.recruitJobPosting.findFirst({
        where: { orgId: p.orgId, status: "OPEN" },
        orderBy: { createdAt: "desc" },
      })) ??
      (await prisma.recruitJobPosting.findFirst({
        where: { orgId: p.orgId },
        orderBy: { createdAt: "desc" },
      }));
    if (!posting) {
      throw new Error("INGEST_NO_POSTING"); // org has no postings yet — drop event
    }
    const refId = `INBOX-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    application = await prisma.recruitApplication.create({
      data: {
        orgId: p.orgId,
        postingId: posting.id,
        applicantId: applicant.id,
        refId,
        answers: {},
        files: [],
        status: "NEW",
        draft: true, // mark as draft so it doesn't pollute inbox counts until verified
      },
    });
  }

  const msg = await prisma.recruitMessage.create({
    data: {
      orgId: p.orgId,
      applicationId: application.id,
      channel: p.channel,
      direction: "IN",
      body: p.body,
      status: "SENT", // inbound = already delivered
      sentAt: new Date(),
      externalId: p.externalId ?? null,
      channelInstanceId: p.channelInstanceId,
      senderExternalId: p.senderExternalId,
      replyToken: p.replyToken ?? null,
      attachments: (p.attachments as object) ?? undefined,
    },
  });

  return { messageId: msg.id, applicationId: application.id, applicantId: applicant.id };
}
