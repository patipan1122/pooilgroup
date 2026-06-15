"use server";

// Read-only "real chat review" actions for the bot trainer.  Surface the
// conversations where the bot likely answered poorly (escalated / urgent) so
// the CEO can click one, read what really happened, and hand the transcript to
// Claude to fix the canned replies.  SELECT-only — never mutates a chat.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { assertBotCapable } from "../business";

const DEFAULT_TAG = "chairops";

async function requireAdmin() {
  const session = await requireSession();
  if (!(await userIsModuleAdmin(session.user, "inbox")))
    throw new Error("ไม่มีสิทธิ์");
  return session;
}

export interface ProblemChatSummary {
  id: string;
  displayName: string | null;
  topicTag: string | null;
  isUrgent: boolean;
  needsHuman: boolean;
  reason: string; // why it's flagged, in Thai
  preview: string; // last inbound customer message, truncated
  lastMessageAt: string;
}

// Conversations the bot probably mishandled: escalated to a human or flagged
// urgent.  Scoped to the org + the business's channels (conversation has no
// businessTag of its own, so we filter through the channel relation).
export async function listProblemConversations(
  businessTag?: string,
): Promise<ProblemChatSummary[]> {
  const session = await requireAdmin();
  const tag = assertBotCapable(businessTag?.trim() || DEFAULT_TAG);

  const rows = await prisma.inboxConversation.findMany({
    where: {
      orgId: session.user.org_id,
      channel: { businessTag: tag },
      OR: [{ needsHuman: true }, { isUrgent: true }],
    },
    orderBy: { lastMessageAt: "desc" },
    take: 30,
    select: {
      id: true,
      displayName: true,
      topicTag: true,
      isUrgent: true,
      needsHuman: true,
      lastMessageAt: true,
      messages: {
        where: { direction: "IN" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    topicTag: r.topicTag,
    isUrgent: r.isUrgent,
    needsHuman: r.needsHuman,
    reason: r.isUrgent ? "เคสด่วน" : "บอทส่งต่อให้คน",
    preview: (r.messages[0]?.body ?? "").replace(/\n/g, " ").slice(0, 90),
    lastMessageAt: r.lastMessageAt.toISOString(),
  }));
}

export interface TranscriptLine {
  who: "customer" | "bot" | "staff";
  body: string;
  at: string;
}

// Full message thread for one conversation + a plain-text rendering the UI
// can paste into a message to Claude.  Org-scoped guard before reading.
export async function getConversationTranscript(conversationId: string): Promise<{
  ok: true;
  lines: TranscriptLine[];
  text: string;
}> {
  const session = await requireAdmin();
  const convo = await prisma.inboxConversation.findUnique({
    where: { id: conversationId },
    select: { orgId: true },
  });
  if (!convo || convo.orgId !== session.user.org_id) {
    throw new Error("ไม่พบแชทนี้");
  }

  const msgs = await prisma.inboxMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { direction: true, body: true, sentByBot: true, createdAt: true },
  });

  const lines: TranscriptLine[] = msgs.map((m) => ({
    who:
      m.direction === "IN" ? "customer" : m.sentByBot ? "bot" : "staff",
    body: m.body,
    at: m.createdAt.toISOString(),
  }));

  const text = lines
    .map((l) => {
      const who =
        l.who === "customer" ? "ลูกค้า" : l.who === "bot" ? "บอท" : "พนักงาน";
      return `${who}: ${l.body}`;
    })
    .join("\n");

  return { ok: true, lines, text };
}
