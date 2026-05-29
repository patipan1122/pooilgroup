// Bot orchestration — runs on every inbound customer message for a channel
// whose bot is enabled. Hybrid strategy:
//   1. classify topic (free) + tag the conversation so humans can triage
//   2. FAQ match (free) — admin-authored answers win
//   3. deterministic template for the 5 known ChairOps topics
//   4. AI (Haiku) only for unclassified messages, with knowledge context
//   5. anything sensitive / unanswerable → escalate (needsHuman + log)

import { prisma } from "@/lib/prisma";
import { classify, type InboxTopic } from "./classify";
import { matchFaq, bumpFaqHit } from "./match";
import { getBotSettings, type BotSettings } from "./settings";
import { aiAnswer } from "./ai";
import { recordOutboundMessage } from "../ingest";
import { sendLineMessage, sendFacebookMessage } from "../send";

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
}

function template(topic: InboxTopic, s: BotSettings): string {
  const callLine = s.contactPhone
    ? `โทรหาทีมงานที่เบอร์ ${s.contactPhone}`
    : "โทรแจ้งทีมงานของเรา";
  switch (topic) {
    case "money_lost":
      // SOP (CEO 2026-05-29): ask coin/note → branch+province → machine number
      // (top-left of screen, e.g. G0310416) → photo of acceptor → call.
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
      return `ขอบคุณสำหรับคำติชมนะคะ 🙏 เรารับไว้ปรับปรุงและดูแลให้ดีขึ้นแน่นอนค่ะ`;
    default:
      return s.fallbackText;
  }
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

export async function runBot(opts: RunBotInput): Promise<void> {
  const { channel, conversationId, text } = opts;
  const businessTag = channel.businessTag ?? "";
  const settings = await getBotSettings(channel.orgId, businessTag);
  const cls = classify(text);

  // Always tag the conversation so humans can triage even when the bot is off.
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

  // Bot disabled (per-business) or no token → leave for a human.
  if (!settings.botEnabled || !opts.accessToken) {
    if (cls.needsHuman) await markNeedsHuman(conversationId);
    return;
  }

  let answer: string | null = null;
  let escalate = cls.needsHuman; // sensitive topics escalate regardless of answer

  const faq = await matchFaq(channel.orgId, businessTag, text);
  if (faq) {
    answer = faq.answer;
    await bumpFaqHit(faq.id);
  } else if (cls.topic !== "other") {
    answer = template(cls.topic, settings);
  } else {
    const knowledge = await loadKnowledge(channel.orgId, businessTag);
    const ai = await aiAnswer({
      text,
      knowledge,
      tone: settings.tone,
      botName: settings.botName,
      orgId: channel.orgId,
      createdById: channel.createdById,
    });
    if (ai.answer) {
      answer = ai.answer;
    } else {
      answer = settings.escalateText || settings.fallbackText;
      escalate = true;
      await logUnanswered(channel.orgId, businessTag, conversationId, text);
    }
  }

  const sendResult = await sendByPlatform(channel.platform, {
    body: answer,
    recipientExternalId: opts.externalUserId,
    accessToken: opts.accessToken,
    replyToken: opts.replyToken,
  });

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

  if (escalate) await markNeedsHuman(conversationId);
}
