// Inbound message ingestion for the unified inbox.
// Finds/creates one conversation per (channel, external user) and appends the
// message. Idempotent on (channelId, externalId) so LINE/FB retries don't dupe.
// Race-safe: concurrent provider retries (made likely by async webhook) catch
// the unique-violation (P2002) instead of 500-ing / double-inserting (audit P0-2/3).
//
// NOT coupled to any module's domain model — works for any business tag.

import { prisma } from "@/lib/prisma";

export interface InboxIngestParams {
  channelId: string;
  orgId: string;
  platform: "LINE" | "FACEBOOK";
  /** LINE userId / FB PSID — opaque per-channel identifier */
  senderExternalId: string;
  senderDisplayName?: string | null;
  body: string;
  attachments?: unknown;
  /** Provider-side message ID for idempotency */
  externalId?: string | null;
}

export interface InboxIngestResult {
  conversationId: string;
  messageId: string;
  isNewConversation: boolean;
  duplicate?: boolean;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"
  );
}

export async function ingestInboundMessage(
  p: InboxIngestParams,
): Promise<InboxIngestResult> {
  // Idempotency — LINE/FB retry sends the same externalId.
  if (p.externalId) {
    const existing = await prisma.inboxMessage.findFirst({
      where: { channelId: p.channelId, externalId: p.externalId, direction: "IN" },
      select: { id: true, conversationId: true },
    });
    if (existing) {
      return {
        conversationId: existing.conversationId,
        messageId: existing.id,
        isNewConversation: false,
        duplicate: true,
      };
    }
  }

  const now = new Date();
  const displayName = p.senderDisplayName?.trim() || null;

  const findConvo = () =>
    prisma.inboxConversation.findUnique({
      where: {
        channelId_externalUserId: {
          channelId: p.channelId,
          externalUserId: p.senderExternalId,
        },
      },
      select: { id: true, displayName: true, status: true },
    });

  let isNewConversation = false;
  let convo = await findConvo();

  if (!convo) {
    try {
      convo = await prisma.inboxConversation.create({
        data: {
          orgId: p.orgId,
          channelId: p.channelId,
          platform: p.platform,
          externalUserId: p.senderExternalId,
          displayName,
          status: "OPEN",
          lastMessageAt: now,
          lastInboundAt: now,
          unreadCount: 1,
        },
        select: { id: true, displayName: true, status: true },
      });
      isNewConversation = true;
    } catch (e) {
      // Race: a concurrent first-message won the insert. Re-fetch + fall through to update.
      if (isUniqueViolation(e)) {
        convo = await findConvo();
        if (!convo) throw e;
      } else {
        throw e;
      }
    }
  }

  if (!isNewConversation) {
    await prisma.inboxConversation.update({
      where: { id: convo.id },
      data: {
        displayName: convo.displayName ?? displayName,
        lastMessageAt: now,
        lastInboundAt: now,
        unreadCount: { increment: 1 },
        status: convo.status === "CLOSED" ? "OPEN" : undefined,
      },
    });
  }

  try {
    const msg = await prisma.inboxMessage.create({
      data: {
        orgId: p.orgId,
        conversationId: convo.id,
        channelId: p.channelId,
        platform: p.platform,
        direction: "IN",
        body: p.body,
        externalId: p.externalId ?? null,
        attachments: (p.attachments as object) ?? undefined,
      },
      select: { id: true },
    });
    return { conversationId: convo.id, messageId: msg.id, isNewConversation };
  } catch (e) {
    // Concurrent retry inserted the same (channelId, externalId) first → treat as duplicate.
    if (isUniqueViolation(e) && p.externalId) {
      const ex = await prisma.inboxMessage.findFirst({
        where: { channelId: p.channelId, externalId: p.externalId, direction: "IN" },
        select: { id: true, conversationId: true },
      });
      if (ex) {
        return {
          conversationId: ex.conversationId,
          messageId: ex.id,
          isNewConversation: false,
          duplicate: true,
        };
      }
    }
    throw e;
  }
}

/** Persist an outbound message (bot or human) after it was sent to the provider. */
export async function recordOutboundMessage(opts: {
  orgId: string;
  conversationId: string;
  channelId: string;
  platform: "LINE" | "FACEBOOK";
  body: string;
  sentByBot: boolean;
  createdById?: string | null;
  externalId?: string | null;
  error?: string | null;
}) {
  const msg = await prisma.inboxMessage.create({
    data: {
      orgId: opts.orgId,
      conversationId: opts.conversationId,
      channelId: opts.channelId,
      platform: opts.platform,
      direction: "OUT",
      body: opts.body,
      sentByBot: opts.sentByBot,
      createdById: opts.createdById ?? null,
      externalId: opts.externalId ?? null,
      errorMessage: opts.error ?? null,
    },
    select: { id: true },
  });
  await prisma.inboxConversation.update({
    where: { id: opts.conversationId },
    data: { lastMessageAt: new Date() },
  });
  return msg.id;
}
