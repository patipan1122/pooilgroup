// Bot orchestration — runs on every inbound customer message for a channel
// whose bot is enabled. Hybrid strategy:
//   1. classify topic (free) + tag the conversation so humans can triage
//   2. urgent/complaint → deterministic escalation template (FAQ can't hijack)
//   3. FAQ match (free) for non-urgent topics
//   4. template for the known topics · AI (Gemini) only for "other"
//   5. anything sensitive / unanswerable → escalate: needsHuman + LINE alert + log

import { prisma } from "@/lib/prisma";
import { classify, type InboxTopic } from "./classify";
import { matchFaq, bumpFaqHit } from "./match";
import { getBotSettings, type BotSettings } from "./settings";
import { aiAnswer } from "./ai";
import { recordOutboundMessage } from "../ingest";
import {
  sendLineMessage,
  sendFacebookMessage,
  sendLineImage,
  sendFacebookImage,
  sendLineTextPlusImage,
} from "../send";
import { topicLabel, INBOX_BUSINESSES } from "../business";
import type { FlowImageTopic } from "./settings";
import { renderChairopsTemplate as template, renderHotelTemplate, classifyHotelIntent, appendHotelCta } from "./templates";

export interface RunBotInput {
  channel: {
    id: string;
    orgId: string;
    platform: "LINE" | "FACEBOOK";
    businessTag: string | null;
    createdById: string | null;
  };
  conversationId: string;
  externalUserId: string;
  text: string;
  /** decrypted access token for outbound; null = cannot reply */
  accessToken: string | null;
  replyToken?: string | null;
  /** true when the inbound was a non-text message (image/sticker/etc.) */
  nonText?: boolean;
}

// Template body lives in lib/inbox/bot/templates.ts so the trainer's preview
// can render the same strings — audit BOT-003 surfaced drift between the
// two copies after the last template tweak.  Imported at the top of the file.

// Pull the most recent N inbound + outbound messages for this conversation
// so the AI fallback understands what was discussed earlier.  Returned in
// chronological order (oldest → newest); the latest IN message is the one
// the bot is responding to (ingest already persisted it before runBot).
async function loadRecentHistory(
  orgId: string,
  conversationId: string,
  limit = 12,
): Promise<{ direction: "IN" | "OUT"; body: string; sentByBot: boolean }[]> {
  const rows = await prisma.inboxMessage.findMany({
    where: { orgId, conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { direction: true, body: true, sentByBot: true },
  });
  return rows
    .reverse()
    .map((m) => ({
      direction: m.direction as "IN" | "OUT",
      body: m.body,
      sentByBot: m.sentByBot,
    }));
}

async function loadKnowledge(orgId: string, businessTag: string): Promise<string> {
  const rows = await prisma.inboxBotKnowledge.findMany({
    where: { orgId, businessTag, enabled: true },
    select: { title: true, content: true },
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return "ยังไม่มีข้อมูลธุรกิจเพิ่มเติม";
  return rows.map((r) => `## ${r.title}\n${r.content}`).join("\n\n");
}

async function markNeedsHuman(conversationId: string): Promise<void> {
  await prisma.inboxConversation
    .update({ where: { id: conversationId }, data: { needsHuman: true } })
    .catch(() => {});
}

async function logUnanswered(
  orgId: string,
  businessTag: string,
  conversationId: string,
  question: string,
): Promise<void> {
  await prisma.inboxBotUnanswered
    .create({ data: { orgId, businessTag, conversationId, question } })
    .catch(() => {});
}

async function sendByPlatform(
  platform: "LINE" | "FACEBOOK",
  input: { body: string; recipientExternalId: string; accessToken: string; replyToken?: string | null },
) {
  return platform === "LINE"
    ? sendLineMessage(input)
    : sendFacebookMessage(input);
}

// Map a classified topic to the bot-settings image slot (if any).  Returns
// undefined for "other" / when CEO hasn't uploaded an image for that flow.
function flowImageForTopic(
  topic: InboxTopic,
  flowImages: BotSettings["flowImages"],
): string | undefined {
  if (topic === "other") return undefined;
  return flowImages[topic as FlowImageTopic];
}

// Send + record an optional bot template image after the main text reply.
// Best-effort: failure is logged but doesn't escalate or block the parent flow.
async function sendBotImage(opts: {
  channel: RunBotInput["channel"];
  conversationId: string;
  externalUserId: string;
  accessToken: string;
  imageUrl: string;
}): Promise<void> {
  const sendInput = {
    imageUrl: opts.imageUrl,
    recipientExternalId: opts.externalUserId,
    accessToken: opts.accessToken,
    // The replyToken is already consumed by the text reply above; image goes
    // out via push.  LINE allows multiple sequential pushes within quota.
    replyToken: null,
  };
  const res =
    opts.channel.platform === "LINE"
      ? await sendLineImage(sendInput)
      : await sendFacebookImage(sendInput);
  await recordOutboundMessage({
    orgId: opts.channel.orgId,
    conversationId: opts.conversationId,
    channelId: opts.channel.id,
    platform: opts.channel.platform,
    body: "[รูปประกอบ]",
    sentByBot: true,
    attachments: { type: "image", url: opts.imageUrl },
    externalId: res.externalId ?? null,
    error: res.ok ? null : res.error ?? "send image failed",
  });
}

// Push an urgent alert to the team's LINE (env INBOX_ALERT_TARGET = LINE
// userId/groupId) using the channel's own access token. Best-effort — never
// throws. Only LINE channels can push a LINE alert.
async function notifyUrgent(
  channel: RunBotInput["channel"],
  accessToken: string | null,
  topic: InboxTopic,
  customerText: string,
): Promise<void> {
  const target = process.env.INBOX_ALERT_TARGET;
  if (!target || !accessToken || channel.platform !== "LINE") return;
  const snippet = customerText.length > 120 ? customerText.slice(0, 120) + "…" : customerText;
  const body =
    `🔴 เคสด่วน (${topicLabel(topic)}) มีลูกค้าทักเข้ามา\n` +
    `“${snippet}”\n` +
    `→ เปิดดู/ตอบที่ระบบกล่องข้อความ (/inbox) นะคะ`;
  try {
    await sendLineMessage({ body, recipientExternalId: target, accessToken });
  } catch {
    /* best-effort */
  }
}

export async function runBot(opts: RunBotInput): Promise<void> {
  const { channel, conversationId, text } = opts;
  const businessTag = channel.businessTag ?? "";
  const businessName =
    INBOX_BUSINESSES.find((b) => b.tag === businessTag)?.label ?? null;
  const settings = await getBotSettings(channel.orgId, businessTag);
  const cls = classify(text);

  // Always tag the conversation so humans can triage even when the bot is off.
  // isUrgent/isLead latch true (cleared when staff closes the conversation).
  await prisma.inboxConversation
    .update({
      where: { id: conversationId },
      data: {
        topicTag: cls.topic,
        isUrgent: cls.isUrgent ? true : undefined,
        isLead: cls.isLead ? true : undefined,
      },
    })
    .catch(() => {});

  // Bot disabled (per-business) or no token → leave for a human (but still alert).
  if (!settings.botEnabled || !opts.accessToken) {
    if (cls.needsHuman) {
      await markNeedsHuman(conversationId);
      await notifyUrgent(channel, opts.accessToken, cls.topic, text);
    }
    return;
  }

  let answer: string | null = null;
  let escalate = cls.needsHuman; // sensitive topics + complaints escalate regardless

  // Urgent topics + complaints go straight to the escalation template — a
  // generic FAQ keyword must NOT hijack a "เงินหาย"/"สแกนไม่ได้" reply (audit P0/P1).
  const allowFaq = !cls.isUrgent && !cls.isComplaint;
  const faq = allowFaq ? await matchFaq(channel.orgId, businessTag, text) : null;
  if (faq) {
    answer = faq.answer;
    await bumpFaqHit(faq.id);
  } else if (cls.topic !== "other" && businessTag === "chairops") {
    // chairops massage-chair topic templates (money_lost / scan_fail / etc)
    answer = template(cls.topic, settings, cls.isComplaint);
  } else if (businessTag === "hotel") {
    // Hotel template covers price · availability · location · check-in ·
    // amenities · payment · greeting. Every reply ends with the booking
    // CTA + URL so the customer can jump to the web flow immediately
    // (CEO goal: "Facebook กดให้ไปจอง บนเว็บ"). Falls through to AI only
    // when intent === "other" AND no FAQ matched.
    const intent = classifyHotelIntent(text);
    if (intent !== "other") {
      answer = renderHotelTemplate(intent, settings, undefined);
    } else {
      // Run AI but suffix the CTA so customer always sees the booking URL.
      const [knowledge, history] = await Promise.all([
        loadKnowledge(channel.orgId, businessTag),
        loadRecentHistory(channel.orgId, conversationId, 12),
      ]);
      const ai = await aiAnswer({
        text, knowledge, tone: settings.tone, botName: settings.botName,
        businessName,
        orgId: channel.orgId, createdById: channel.createdById, history,
      });
      if (ai.answer) {
        answer = appendHotelCta(ai.answer, undefined);
      } else {
        answer = renderHotelTemplate("other", settings, undefined);
        await logUnanswered(channel.orgId, businessTag, conversationId, text);
      }
    }
  } else {
    const [knowledge, history] = await Promise.all([
      loadKnowledge(channel.orgId, businessTag),
      // 12 messages = ~6 customer↔bot turns of context.  Cheap on Gemini
      // Flash (~$0.0003/call) and enough for "เลขเครื่อง G0310416" alone to
      // be understood as the answer to a prior money_lost flow question.
      loadRecentHistory(channel.orgId, conversationId, 12),
    ]);
    const ai = await aiAnswer({
      text,
      knowledge,
      tone: settings.tone,
      botName: settings.botName,
      businessName,
      orgId: channel.orgId,
      createdById: channel.createdById,
      history,
    });
    if (ai.answer) {
      answer = ai.answer;
    } else {
      answer = settings.escalateText || settings.fallbackText;
      escalate = true;
      await logUnanswered(channel.orgId, businessTag, conversationId, text);
    }
  }

  // Look up the CEO-uploaded flow image for this topic (if any) — we want
  // text + image delivered together so the customer gets a single LINE
  // notification with both bubbles, not two separate pings.
  const imageUrl = flowImageForTopic(cls.topic, settings.flowImages);

  let sendResult: { ok: boolean; externalId?: string; error?: string };
  if (channel.platform === "LINE") {
    // LINE Reply/Push API accepts up to 5 messages per call — atomic
    // delivery, single notification.  Goes through this combined path
    // regardless of whether imageUrl is set (text-only when omitted).
    sendResult = await sendLineTextPlusImage({
      body: answer,
      imageUrl,
      recipientExternalId: opts.externalUserId,
      accessToken: opts.accessToken,
      replyToken: opts.replyToken,
    });
  } else {
    // FB Messenger sends one piece per API call — text first, image after.
    sendResult = await sendByPlatform(channel.platform, {
      body: answer,
      recipientExternalId: opts.externalUserId,
      accessToken: opts.accessToken,
      replyToken: opts.replyToken,
    });
  }

  await recordOutboundMessage({
    orgId: channel.orgId,
    conversationId,
    channelId: channel.id,
    platform: channel.platform,
    body: answer,
    sentByBot: true,
    externalId: sendResult.externalId ?? null,
    error: sendResult.ok ? null : sendResult.error ?? "send failed",
  });

  // Image accounting:
  //  - LINE: the image already went out in the same call above; just record
  //    an OUT row with the attachment so /inbox shows the picture next to the
  //    text bubble.
  //  - FB  : the text just landed; fire a second call to deliver the image.
  if (sendResult.ok && imageUrl) {
    if (channel.platform === "LINE") {
      await recordOutboundMessage({
        orgId: channel.orgId,
        conversationId,
        channelId: channel.id,
        platform: channel.platform,
        body: "[รูปประกอบ]",
        sentByBot: true,
        attachments: { type: "image", url: imageUrl },
      });
    } else {
      try {
        await sendBotImage({
          channel,
          conversationId,
          externalUserId: opts.externalUserId,
          accessToken: opts.accessToken,
          imageUrl,
        });
      } catch (e) {
        console.error("[inbox:bot] FB flow image send failed", e);
      }
    }
  }

  if (escalate) {
    await markNeedsHuman(conversationId);
    await notifyUrgent(channel, opts.accessToken, cls.topic, text);
  }
}

// Called by the webhook for NON-text inbound (image/sticker/etc.). Customers
// often send a photo of the broken machine — don't leave them in dead air.
export async function handleNonTextInbound(opts: RunBotInput): Promise<void> {
  const { channel, conversationId } = opts;
  await markNeedsHuman(conversationId); // a human should look at the media
  await prisma.inboxConversation
    .update({ where: { id: conversationId }, data: { needsHuman: true } })
    .catch(() => {});
  const settings = await getBotSettings(channel.orgId, channel.businessTag ?? "");
  if (!settings.botEnabled || !opts.accessToken) return;
  const ack =
    `ได้รับข้อความ/รูปแล้วนะคะ 🙏 เดี๋ยวทีมงานรีบดูแลให้ค่ะ ` +
    (settings.contactPhone ? `หากเร่งด่วนโทร ${settings.contactPhone} ได้เลยค่ะ` : ``);
  const res = await sendByPlatform(channel.platform, {
    body: ack,
    recipientExternalId: opts.externalUserId,
    accessToken: opts.accessToken,
    replyToken: opts.replyToken,
  });
  await recordOutboundMessage({
    orgId: channel.orgId,
    conversationId,
    channelId: channel.id,
    platform: channel.platform,
    body: ack,
    sentByBot: true,
    externalId: res.externalId ?? null,
    error: res.ok ? null : res.error ?? "send failed",
  });
  await notifyUrgent(channel, opts.accessToken, "other", "[ลูกค้าส่งรูป/ไฟล์]");
}
