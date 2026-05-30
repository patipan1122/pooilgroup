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
import { topicLabel } from "../business";
import type { FlowImageTopic } from "./settings";

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

function template(topic: InboxTopic, s: BotSettings, isComplaint: boolean): string {
  const callLine = s.contactPhone
    ? `โทรหาทีมงานที่เบอร์ ${s.contactPhone}`
    : "โทรแจ้งทีมงานของเรา";
  switch (topic) {
    case "money_lost":
      return (
        `ขออภัยมากๆ เลยนะคะ 🙏 รบกวนช่วยแจ้งข้อมูลนิดนึงนะคะ เดี๋ยวทีมงานช่วยให้เร็วที่สุดเลยค่ะ\n` +
        `1) เครื่อง “กินเหรียญ” หรือ “กินแบงค์” แล้วไม่ทำงานคะ?\n` +
        `2) สาขา + จังหวัด\n` +
        `3) เลขเครื่อง (อยู่มุมซ้ายบนของหน้าจอ เช่น G0310416)\n` +
        `4) ถ้าสะดวก รบกวนถ่ายรูปช่องหยอดเหรียญ/ช่องรับแบงค์ให้ด้วยนะคะ\n` +
        `จากนั้น${callLine} เดี๋ยวทีมงานกดเปิดเครื่องให้ทำงานต่อ/ตามช่างให้ค่ะ`
      );
    case "scan_fail":
      return (
        `ขออภัยค่ะ 🙏 ถ้าสแกนจ่ายแล้วใช้ไม่ได้ รบกวนแจ้ง สาขา + เลขเครื่อง ` +
        `(อยู่มุมซ้ายบนของหน้าจอ เช่น G0310416) แล้ว${callLine} เดี๋ยวทีมงานช่วยดูให้ทันทีค่ะ`
      );
    case "strong":
      return (
        `ขอบคุณที่แจ้งนะคะ 🙏 เครื่องปรับความแรงได้ระดับ 1–6 (เริ่มต้นที่ระดับ 3) ` +
        `ถ้าแรงไปลองกดลดระดับที่แผงควบคุมข้างที่นั่งค่ะ · อยากได้แรงขึ้นกดเพิ่มระดับหรือยกแผ่นรองขึ้นได้ · ` +
        `และมีปุ่ม “เอน Zero Gravity” กด 1 ครั้งเอนตัว กดอีกครั้งกลับท่าปกติค่ะ ถ้ายังไม่โอเครบกวนแจ้งทีมงานได้เลยค่ะ`
      );
    case "buy":
      return `ขอบคุณที่สนใจค่ะ 😊 รบกวนฝากชื่อและเบอร์ติดต่อไว้นะคะ เดี๋ยวทีมงานติดต่อกลับไปให้รายละเอียดเพิ่มเติมค่ะ`;
    case "feedback":
      return isComplaint
        ? `ขออภัยจริงๆ นะคะ 🙏 รบกวนเล่าเพิ่มได้ไหมคะว่าติดปัญหาเรื่องอะไร (สาขา/เลขเครื่องถ้ามี) เดี๋ยวทีมงานรีบดูแลให้ค่ะ`
        : `ขอบคุณสำหรับคำติชมนะคะ 🙏 เรารับไว้ปรับปรุงและดูแลให้ดีขึ้นแน่นอนค่ะ`;
    default:
      return s.fallbackText;
  }
}

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
  } else if (cls.topic !== "other") {
    answer = template(cls.topic, settings, cls.isComplaint);
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
