// Daily summary builder — deterministic stats (free, no AI) stored per business
// and shown on the web. Cron pushes the text to the CEO LINE group too.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { topicLabel } from "./business";

export interface DailySummaryStats {
  inbound: number;
  conversations: number;
  newConversations: number;
  needsHuman: number;
  urgent: number;
  leads: number;
  unanswered: number;
  byTopic: Record<string, number>;
}

function ictDayWindow(now = new Date()): { startUtc: Date; summaryDate: Date; label: string } {
  const ictNow = new Date(now.getTime() + 7 * 3600 * 1000);
  const y = ictNow.getUTCFullYear();
  const m = ictNow.getUTCMonth();
  const d = ictNow.getUTCDate();
  const startUtc = new Date(Date.UTC(y, m, d, 0, 0, 0) - 7 * 3600 * 1000);
  const summaryDate = new Date(Date.UTC(y, m, d));
  const label = `${d}/${m + 1}/${y + 543}`;
  return { startUtc, summaryDate, label };
}

export function renderSummaryText(stats: DailySummaryStats, label: string, businessLabel: string): string {
  const topicLines = Object.entries(stats.byTopic)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, n]) => `   • ${topicLabel(tag)}: ${n}`)
    .join("\n");

  return [
    `📊 สรุปแชท ${businessLabel} · ${label}`,
    ``,
    `💬 ลูกค้าทักเข้ามา: ${stats.conversations} ราย (ใหม่ ${stats.newConversations})`,
    `📨 ข้อความรวม: ${stats.inbound}`,
    `🔴 ต้องให้คนตอบ/ตามต่อ: ${stats.needsHuman}`,
    `⚠️ เคสด่วน (เงิน/สแกน): ${stats.urgent}`,
    `🛒 สนใจซื้อ (lead): ${stats.leads}`,
    `❓ บอทตอบไม่ได้วันนี้: ${stats.unanswered}`,
    topicLines ? `\nเรื่องที่ถามเข้ามา:\n${topicLines}` : ``,
  ]
    .filter((l) => l !== ``)
    .join("\n");
}

export async function buildAndStoreDailySummary(
  orgId: string,
  businessTag: string,
  businessLabel: string,
): Promise<{ stats: DailySummaryStats; text: string } | null> {
  const channels = await prisma.inboxChannel.findMany({
    where: { orgId, businessTag },
    select: { id: true },
  });
  const channelIds = channels.map((c) => c.id);
  if (!channelIds.length) return null;

  const { startUtc, summaryDate, label } = ictDayWindow();

  const [inbound, conversations, newConversations, needsHuman, urgent, leads, unanswered, topicGroups] =
    await Promise.all([
      prisma.inboxMessage.count({
        where: { orgId, direction: "IN", channelId: { in: channelIds }, createdAt: { gte: startUtc } },
      }),
      prisma.inboxConversation.count({
        where: { orgId, channelId: { in: channelIds }, lastInboundAt: { gte: startUtc } },
      }),
      prisma.inboxConversation.count({
        where: { orgId, channelId: { in: channelIds }, createdAt: { gte: startUtc } },
      }),
      prisma.inboxConversation.count({
        where: { orgId, channelId: { in: channelIds }, needsHuman: true, status: { not: "CLOSED" } },
      }),
      prisma.inboxConversation.count({
        where: { orgId, channelId: { in: channelIds }, isUrgent: true, status: { not: "CLOSED" } },
      }),
      prisma.inboxConversation.count({
        where: { orgId, channelId: { in: channelIds }, isLead: true, status: { not: "CLOSED" } },
      }),
      prisma.inboxBotUnanswered.count({
        where: { orgId, businessTag, resolved: false, createdAt: { gte: startUtc } },
      }),
      prisma.inboxConversation.groupBy({
        by: ["topicTag"],
        where: { orgId, channelId: { in: channelIds }, lastInboundAt: { gte: startUtc } },
        _count: { _all: true },
      }),
    ]);

  const byTopic: Record<string, number> = {};
  for (const g of topicGroups) {
    byTopic[g.topicTag ?? "other"] = g._count._all;
  }

  const stats: DailySummaryStats = {
    inbound,
    conversations,
    newConversations,
    needsHuman,
    urgent,
    leads,
    unanswered,
    byTopic,
  };
  const text = renderSummaryText(stats, label, businessLabel);
  const statsJson = stats as unknown as Prisma.InputJsonValue;

  await prisma.inboxDailySummary.upsert({
    where: { orgId_businessTag_summaryDate: { orgId, businessTag, summaryDate } },
    create: { orgId, businessTag, summaryDate, stats: statsJson, aiText: text },
    update: { stats: statsJson, aiText: text },
  });

  return { stats, text };
}
