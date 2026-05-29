// Read queries for the unified inbox UI. Service-role Prisma (org-scoped here).

import { prisma } from "@/lib/prisma";

export interface ConversationListItem {
  id: string;
  channelId: string;
  channelName: string;
  platform: "LINE" | "FACEBOOK";
  businessTag: string | null;
  displayName: string | null;
  lastMessageAt: string;
  lastSnippet: string;
  status: "OPEN" | "SNOOZED" | "CLOSED";
  topicTag: string | null;
  isUrgent: boolean;
  isLead: boolean;
  needsHuman: boolean;
  unreadCount: number;
}

export interface ConversationFilter {
  status?: "OPEN" | "SNOOZED" | "CLOSED";
  channelId?: string;
  businessTag?: string;
  needsHuman?: boolean;
  isUrgent?: boolean;
  isLead?: boolean;
  q?: string;
  limit?: number;
}

export async function listConversations(
  orgId: string,
  opts: ConversationFilter = {},
): Promise<ConversationListItem[]> {
  const rows = await prisma.inboxConversation.findMany({
    where: {
      orgId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.channelId ? { channelId: opts.channelId } : {}),
      ...(opts.needsHuman ? { needsHuman: true } : {}),
      ...(opts.isUrgent ? { isUrgent: true } : {}),
      ...(opts.isLead ? { isLead: true } : {}),
      ...(opts.businessTag ? { channel: { businessTag: opts.businessTag } } : {}),
      ...(opts.q
        ? {
            OR: [
              { displayName: { contains: opts.q, mode: "insensitive" } },
              { messages: { some: { body: { contains: opts.q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: opts.limit ?? 100,
    select: {
      id: true,
      channelId: true,
      platform: true,
      displayName: true,
      lastMessageAt: true,
      status: true,
      topicTag: true,
      isUrgent: true,
      isLead: true,
      needsHuman: true,
      unreadCount: true,
      channel: { select: { displayName: true, businessTag: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    channelName: r.channel.displayName,
    platform: r.platform as "LINE" | "FACEBOOK",
    businessTag: r.channel.businessTag,
    displayName: r.displayName,
    lastMessageAt: r.lastMessageAt.toISOString(),
    lastSnippet: r.messages[0]?.body ?? "",
    status: r.status as "OPEN" | "SNOOZED" | "CLOSED",
    topicTag: r.topicTag,
    isUrgent: r.isUrgent,
    isLead: r.isLead,
    needsHuman: r.needsHuman,
    unreadCount: r.unreadCount,
  }));
}

export interface ConversationDetail {
  id: string;
  channelId: string;
  channelName: string;
  platform: "LINE" | "FACEBOOK";
  businessTag: string | null;
  displayName: string | null;
  status: "OPEN" | "SNOOZED" | "CLOSED";
  topicTag: string | null;
  isUrgent: boolean;
  isLead: boolean;
  needsHuman: boolean;
  contactPhone: string | null;
  contactNote: string | null;
  messages: {
    id: string;
    direction: "IN" | "OUT";
    body: string;
    sentByBot: boolean;
    createdAt: string;
  }[];
}

export async function getConversationWithMessages(
  orgId: string,
  id: string,
): Promise<ConversationDetail | null> {
  const c = await prisma.inboxConversation.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      channelId: true,
      platform: true,
      displayName: true,
      status: true,
      topicTag: true,
      isUrgent: true,
      isLead: true,
      needsHuman: true,
      contactPhone: true,
      contactNote: true,
      channel: { select: { displayName: true, businessTag: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          direction: true,
          body: true,
          sentByBot: true,
          createdAt: true,
        },
      },
    },
  });
  if (!c) return null;
  return {
    id: c.id,
    channelId: c.channelId,
    channelName: c.channel.displayName,
    platform: c.platform as "LINE" | "FACEBOOK",
    businessTag: c.channel.businessTag,
    displayName: c.displayName,
    status: c.status as "OPEN" | "SNOOZED" | "CLOSED",
    topicTag: c.topicTag,
    isUrgent: c.isUrgent,
    isLead: c.isLead,
    needsHuman: c.needsHuman,
    contactPhone: c.contactPhone,
    contactNote: c.contactNote,
    messages: c.messages.map((m) => ({
      id: m.id,
      direction: m.direction as "IN" | "OUT",
      body: m.body,
      sentByBot: m.sentByBot,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export interface InboxCounts {
  open: number;
  needsHuman: number;
  urgent: number;
  leads: number;
}

export async function inboxCounts(orgId: string): Promise<InboxCounts> {
  const [open, needsHuman, urgent, leads] = await Promise.all([
    prisma.inboxConversation.count({ where: { orgId, status: "OPEN" } }),
    prisma.inboxConversation.count({ where: { orgId, needsHuman: true, status: { not: "CLOSED" } } }),
    prisma.inboxConversation.count({ where: { orgId, isUrgent: true, status: { not: "CLOSED" } } }),
    prisma.inboxConversation.count({ where: { orgId, isLead: true, status: { not: "CLOSED" } } }),
  ]);
  return { open, needsHuman, urgent, leads };
}
