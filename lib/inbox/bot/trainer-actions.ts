"use server";

// "เทรนกับ Claude" — admin chats with Anthropic Claude to teach the bot
// in natural language ("ลูกค้าทักแบบนี้ อยากให้บอทตอบแบบนี้").  Claude
// returns conversational guidance + structured action proposals (FAQ /
// knowledge entries) wrapped in fenced ``` blocks the UI parses into
// "Apply" cards.
//
// Also exposes previewBotReply — simulate what the live bot would do for a
// hypothetical customer message without actually sending anything to LINE.
// CEO uses it to sanity-check FAQ adjustments before committing.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { classify } from "./classify";
import { matchFaq } from "./match";
import { getBotSettings } from "./settings";
import { aiAnswer } from "./ai";
import { renderChairopsTemplate } from "./templates";

const DEFAULT_TAG = "chairops";

async function requireAdmin() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) throw new Error("ไม่มีสิทธิ์");
  return session;
}

export interface TrainerTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TrainerReply {
  ok: true;
  reply: string;
  cost_usd?: number;
}

const TRAINER_MODEL = "claude-sonnet-4-6";

function trainerSystemPrompt(opts: {
  botName?: string | null;
  tone: string;
  contactPhone?: string | null;
  faqs: { keywords: string; answer: string; intent: string | null }[];
  knowledge: { title: string; content: string }[];
}): string {
  const faqList =
    opts.faqs.length === 0
      ? "(ยังไม่มี FAQ)"
      : opts.faqs
          .map(
            (f, i) =>
              `${i + 1}. ${f.intent ? `[${f.intent}] ` : ""}keywords: ${f.keywords}\n   ตอบ: ${f.answer.slice(0, 200)}`,
          )
          .join("\n");
  const knowledgeList =
    opts.knowledge.length === 0
      ? "(ยังไม่มีข้อมูลร้านเพิ่มเติม)"
      : opts.knowledge.map((k) => `• ${k.title}: ${k.content.slice(0, 160)}`).join("\n");

  return [
    `คุณคือ "Claude เทรนเนอร์" ผู้ช่วยให้ CEO เทรนแชทบอทธุรกิจเก้าอี้นวดหยอดเหรียญ`,
    `CEO ไม่ใช่นักพัฒนา · ต้องการเล่าเป็นภาษาธรรมดาว่า "ลูกค้าทักแบบนี้ อยากให้บอทตอบแบบนี้"`,
    ``,
    `**บอทมี 3 วิธีตอบลูกค้า — คุณช่วยเลือกให้:**`,
    `1. **Template (flow ตายตัว 5 หัวข้อ)** — money_lost / scan_fail / strong / buy / feedback · อยู่ในโค้ด · ปรับได้แต่ต้อง deploy ใหม่ (ไม่ใช่ทางที่คุณแนะนำให้ CEO ทำเอง)`,
    `2. **FAQ keyword** — คำที่ตรง keyword → คำตอบที่ตั้งไว้ · ฟรี (ไม่ใช้ AI) · เร็ว · เหมาะกับคำถามซ้ำๆ ที่คำตอบเหมือนกันทุกครั้ง`,
    `3. **AI Gemini Flash** — คำถามที่ไม่ตรง template/FAQ · อ่านประวัติ 12 ข้อความล่าสุด + "ข้อมูลร้าน" · ค่าใช้จ่ายราว $0.0003/คำตอบ · เหมาะกับสถานการณ์ที่ต้องเข้าใจบริบทหรือต้องตอบหลากหลาย`,
    ``,
    `**หลักการตัดสินใจ:**`,
    `- ถ้า "ลูกค้าถามแบบเดิมเป๊ะๆ คำตอบเดิมเป๊ะๆ" → แนะนำ **FAQ** (ประหยัด · เร็ว)`,
    `- ถ้า "ลูกค้าจะเล่าแตกต่างกัน · บอทต้องเข้าใจบริบทจากที่คุยมาก่อนหน้า" → แนะนำ **เพิ่มลงข้อมูลร้าน** ให้ AI ใช้เป็น context`,
    `- ถ้าเป็นเรื่อง flow มาตรฐานทั้ง 5 หัวข้อ → บอกว่าต้องแก้ template ในโค้ด (CEO บอกผู้พัฒนา)`,
    ``,
    `**โทน:**`,
    `- ตั้งใจให้บอทตอบ "เหมือนคน ไม่เหมือนบอท"`,
    `- ปัจจุบันโทน: ${opts.tone}`,
    `- บอทชื่อ: ${opts.botName ?? "นวดน้า"}`,
    `- เบอร์ติดต่อ: ${opts.contactPhone ?? "(ยังไม่ตั้ง)"}`,
    ``,
    `**FAQ ปัจจุบัน:**`,
    faqList,
    ``,
    `**ข้อมูลร้านปัจจุบัน:**`,
    knowledgeList,
    ``,
    `**บทสนทนาเป็นแบบยาว / iterative:**`,
    `- CEO จะคุยกับคุณต่อเนื่อง · ขอแก้ร่าง · ขอเพิ่มเคสใหม่ · ขออธิบายเพิ่ม`,
    `- คุณจำทุก turn ใน session นี้ได้ · อ้างถึงสิ่งที่คุยมาก่อนหน้าได้`,
    `- ถ้า CEO ขอ "ปรับให้นุ่มกว่านี้" / "ใส่ emoji มากกว่านี้" / "สั้นกว่านี้" → ร่างใหม่ทับของเดิม (อย่าเสนอ FAQ ใหม่ ให้แก้ของเดิมแทน)`,
    `- ถ้า CEO เปลี่ยนเรื่อง / เล่าเคสใหม่ → เริ่มร่างใหม่`,
    ``,
    `**วิธีตอบ:**`,
    `1. ถามทำความเข้าใจสถานการณ์ก่อนถ้ายังไม่ชัด (แค่ 1-2 คำถามพอ · ไม่ถามวนซ้ำ)`,
    `2. แนะนำว่าควรเป็น FAQ / ข้อมูลร้าน · บอกเหตุผลสั้นๆ`,
    `3. ร่าง 1 ทางเลือกที่ดีที่สุดให้ · ใช้ fenced code block แบบนี้:`,
    ``,
    "   สำหรับ FAQ:",
    "   ```faq",
    "   keywords: คำหลัก1, คำหลัก2, คำหลัก3",
    "   intent: ชื่อ-สั้นๆ-ภาษาอังกฤษ",
    "   answer: ข้อความที่บอทจะตอบ (สุภาพ · เหมือนคน · ลงท้ายค่ะ · ใช้ emoji ได้บ้าง)",
    "   ```",
    ``,
    "   สำหรับข้อมูลร้าน:",
    "   ```knowledge",
    "   title: หัวข้อสั้น",
    "   content: เนื้อหาที่ AI จะใช้เป็น context ตอนตอบ (1-3 ย่อหน้า)",
    "   ```",
    ``,
    `4. ปิดท้ายด้วย: "ถ้าโอเค กดปุ่ม 'เพิ่มเลย' ด้านล่างได้เลยครับ ถ้าอยากปรับ บอกผมได้นะครับ"`,
    `5. ตอบเป็นภาษาไทยทั้งหมด · เรียก CEO ว่า "พี่" / "คุณ" ตามสะดวก · กระชับ ไม่ยืดเยื้อ`,
    ``,
    `**สิ่งสำคัญ:**`,
    `- อย่าร่าง FAQ/knowledge ที่ซ้ำกับของเดิม — แนะนำให้แก้ของเดิมแทน`,
    `- ในคำตอบที่ร่างให้บอท · เขียนเหมือนพนักงานสาวนวดน้านุ่มๆ ใจดี ไม่ใช่ระบบราชการ`,
    `- ถ้าเป็นกรณี "ลูกค้ายังหาเลขเครื่อง/รายละเอียดไม่เจอ" → ให้บอทบอกว่า "ไม่เป็นไรค่ะ ${opts.contactPhone ? `โทร ${opts.contactPhone} เลยค่ะ` : "โทรเข้ามาทีมงานเลยค่ะ"} ทีมงานแก้ออนไลน์ภายใน 30 วินาที" — กระตุ้นให้โทรไม่ใช่ปล่อยลูกค้ารอ`,
  ].join("\n");
}

export async function trainerChat(input: {
  history: TrainerTurn[];
  businessTag?: string;
}): Promise<TrainerReply> {
  const session = await requireAdmin();
  const businessTag = input.businessTag?.trim() || DEFAULT_TAG;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY ใน Vercel — ตั้งใน Project Settings → Environment Variables แล้ว Redeploy ก่อนใช้งานเทรนเนอร์",
    );
  }

  const [settings, faqs, knowledge] = await Promise.all([
    getBotSettings(session.user.org_id, businessTag),
    prisma.inboxBotFaq.findMany({
      where: { orgId: session.user.org_id, businessTag, enabled: true },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 40,
      select: { keywords: true, answer: true, intent: true },
    }),
    prisma.inboxBotKnowledge.findMany({
      where: { orgId: session.user.org_id, businessTag, enabled: true },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { title: true, content: true },
    }),
  ]);

  const system = trainerSystemPrompt({
    botName: settings.botName,
    tone: settings.tone,
    contactPhone: settings.contactPhone,
    faqs,
    knowledge,
  });

  const AnthropicMod = await import("@anthropic-ai/sdk");
  const Anthropic = AnthropicMod.default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Trim to last 40 turns — Claude Sonnet 4.6's 200K context easily fits
  // this many user↔model turns plus the system prompt and FAQ list.  The
  // CEO wants long iterative training sessions ("คุยยาว ๆ ได้") so we
  // bias toward more memory rather than less.
  const trimmed = input.history.slice(-40);

  const resp = await client.messages.create({
    model: TRAINER_MODEL,
    max_tokens: 1024,
    system,
    messages: trimmed.map((t) => ({
      role: t.role,
      content: t.content,
    })),
  });

  const text = resp.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b) => ("text" in b ? (b as { text: string }).text : ""))
    .join("\n")
    .trim();

  return { ok: true, reply: text };
}

/**
 * Preview what the live bot would reply for a hypothetical customer
 * message — without actually sending anything.  Returns the predicted
 * reply text plus which path it would take (template / faq / ai).
 */
export interface PreviewTurn {
  role: "customer" | "bot";
  /** Text body; empty when this turn is an image-only message */
  text?: string;
  /** Marks the customer turn as an image (we don't ship the actual bytes) */
  isImage?: boolean;
}

export async function previewBotReply(input: {
  /** Latest customer text — required unless isImage is true */
  text?: string;
  /** Set true when the customer just "sent" a photo (simulates non-text path) */
  isImage?: boolean;
  /** Prior turns of the simulated conversation, oldest → newest */
  history?: PreviewTurn[];
  businessTag?: string;
}): Promise<{
  ok: true;
  path: "faq" | "template" | "ai" | "escalate" | "non_text";
  topic: string;
  isUrgent: boolean;
  isLead: boolean;
  isComplaint: boolean;
  reply: string;
  matchedFaqKeywords?: string;
  /** Public R2 URL of the bot's flow image, if any — UI renders it as a separate bubble */
  flowImageUrl?: string;
}> {
  const session = await requireAdmin();
  const businessTag = input.businessTag?.trim() || DEFAULT_TAG;
  const settings = await getBotSettings(session.user.org_id, businessTag);

  // Image-only customer message → simulate handleNonTextInbound: ack + escalate
  if (input.isImage) {
    const ack =
      `ได้รับข้อความ/รูปแล้วนะคะ 🙏 เดี๋ยวทีมงานรีบดูแลให้ค่ะ ` +
      (settings.contactPhone
        ? `หากเร่งด่วนโทร ${settings.contactPhone} ได้เลยค่ะ`
        : ``);
    return {
      ok: true,
      path: "non_text",
      topic: "other",
      isUrgent: false,
      isLead: false,
      isComplaint: false,
      reply: ack,
    };
  }

  const text = (input.text ?? "").trim();
  if (!text) throw new Error("พิมพ์ข้อความลูกค้าก่อนทดลอง");

  const cls = classify(text);

  const allowFaq = !cls.isUrgent && !cls.isComplaint;
  const faq = allowFaq
    ? await matchFaq(session.user.org_id, businessTag, text)
    : null;

  // Use the SAME template renderer the live engine uses — the trainer's
  // preview must never claim a reply that prod won't actually send
  // (audit BOT-003).

  let path: "faq" | "template" | "ai" | "escalate" = "escalate";
  let reply = settings.escalateText || settings.fallbackText;
  let matchedFaqKeywords: string | undefined;

  if (faq) {
    path = "faq";
    reply = faq.answer;
    // Re-fetch the row to expose which keyword pattern caught the match,
    // useful for "why did this answer fire?" in the preview UI.
    const meta = await prisma.inboxBotFaq.findUnique({
      where: { id: faq.id },
      select: { keywords: true },
    });
    matchedFaqKeywords = meta?.keywords;
  } else if (cls.topic !== "other" && businessTag === "chairops") {
    // Audit BOT-002: live engine gates templates by businessTag === "chairops".
    // Preview must do the same — for non-chairops we let AI fallback render
    // exactly the way prod will.
    path = "template";
    reply = renderChairopsTemplate(cls.topic, settings, cls.isComplaint);
  } else {
    // AI fallback — feed the simulated conversation history to Gemini so a
    // single bare reply ("G0310416") is understood in the context of the
    // prior money_lost turn.  Translate preview turns into the IN/OUT shape
    // the AI module expects.
    const knowledgeRows = await prisma.inboxBotKnowledge.findMany({
      where: { orgId: session.user.org_id, businessTag, enabled: true },
      select: { title: true, content: true },
      orderBy: { createdAt: "asc" },
    });
    const knowledgeStr =
      knowledgeRows.length === 0
        ? "ยังไม่มีข้อมูลธุรกิจเพิ่มเติม"
        : knowledgeRows
            .map((r) => `## ${r.title}\n${r.content}`)
            .join("\n\n");

    const aiHistory = (input.history ?? [])
      .map((t) => ({
        direction: (t.role === "customer" ? "IN" : "OUT") as "IN" | "OUT",
        body: t.isImage ? "[รูปภาพ]" : t.text ?? "",
        sentByBot: t.role === "bot",
      }))
      .concat([{ direction: "IN", body: text, sentByBot: false }]);

    const ai = await aiAnswer({
      text,
      knowledge: knowledgeStr,
      tone: settings.tone,
      botName: settings.botName,
      orgId: session.user.org_id,
      history: aiHistory,
    });
    if (ai.answer) {
      path = "ai";
      reply = ai.answer;
    } else {
      path = "escalate";
    }
  }

  const flowImageUrl =
    settings.flowImages[cls.topic as keyof typeof settings.flowImages];
  return {
    ok: true,
    path,
    topic: cls.topic,
    isUrgent: cls.isUrgent,
    isLead: cls.isLead,
    isComplaint: cls.isComplaint,
    reply,
    matchedFaqKeywords,
    flowImageUrl,
  };
}
