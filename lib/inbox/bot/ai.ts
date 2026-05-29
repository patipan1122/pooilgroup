// AI fallback — only called when no FAQ matches and the topic is unclassified.
// Uses Claude Haiku (cheap) with the business knowledge base as cached context.
// Conservative org-level monthly budget cap; returns escalate=true when it
// can't help so the engine hands off to a human.

import { adminClient } from "@/lib/db/server";

const MODEL = "claude-haiku-4-5-20251001";
const ORG_MONTHLY_CAP_USD = 50; // bot circuit-breaker (separate from interactive AI)
const IN_PRICE = 1.0 / 1_000_000;
const OUT_PRICE = 5.0 / 1_000_000;

async function overMonthlyBudget(orgId: string): Promise<boolean> {
  try {
    const admin = adminClient();
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const { data } = await admin
      .from("ai_usage")
      .select("cost_usd")
      .eq("org_id", orgId)
      .gte("created_at", start.toISOString());
    const sum = (data ?? []).reduce(
      (s: number, r: { cost_usd: number | null }) => s + Number(r.cost_usd ?? 0),
      0,
    );
    return sum >= ORG_MONTHLY_CAP_USD;
  } catch {
    return false; // never block on a metering error
  }
}

export async function aiAnswer(opts: {
  text: string;
  knowledge: string;
  tone: string;
  botName?: string | null;
  orgId: string;
  createdById?: string | null;
}): Promise<{ answer: string | null; escalate: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) return { answer: null, escalate: true };
  if (await overMonthlyBudget(opts.orgId)) return { answer: null, escalate: true };

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const persona = opts.botName ? `คุณชื่อ "${opts.botName}" ` : "";
    const system = [
      `${persona}คุณคือผู้ช่วยตอบแชทลูกค้าของธุรกิจเก้าอี้นวดหยอดเหรียญในห้าง/ที่สาธารณะ`,
      `โทนการพูด: ${opts.tone} · ตอบเป็นภาษาไทย · สั้น กระชับ · ลงท้ายสุภาพ`,
      `ข้อมูลธุรกิจที่ใช้ตอบได้ (ห้ามแต่งข้อมูลเกินจากนี้):`,
      opts.knowledge,
      `กติกาสำคัญ: ถ้าข้อมูลไม่พอจะตอบ หรือเป็นเรื่องที่ต้องให้คนติดต่อกลับ ` +
        `ให้ตอบกลับเป็นคำเดียวว่า ESCALATE เท่านั้น ห้ามเดาคำตอบ`,
    ].join("\n\n");

    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.text }],
    });

    const out = result.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    // Best-effort usage logging attributed to the channel creator.
    if (opts.createdById) {
      const inTok = result.usage?.input_tokens ?? 0;
      const outTok = result.usage?.output_tokens ?? 0;
      await adminClient()
        .from("ai_usage")
        .insert({
          org_id: opts.orgId,
          user_id: opts.createdById,
          endpoint: "inbox-bot",
          input_tokens: inTok,
          output_tokens: outTok,
          cost_usd: inTok * IN_PRICE + outTok * OUT_PRICE,
        })
        .then(
          () => {},
          () => {},
        );
    }

    if (!out || out.toUpperCase().includes("ESCALATE")) {
      return { answer: null, escalate: true };
    }
    return { answer: out, escalate: false };
  } catch (e) {
    console.error("[inbox-bot ai]", e);
    return { answer: null, escalate: true };
  }
}
