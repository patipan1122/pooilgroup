// AI Chat — "ถามอะไรก็ได้" — รองรับทั้ง Gemini (ฟรี) + Claude
// เลือก provider จาก env: ถ้ามี GEMINI_API_KEY → ใช้ Gemini (ฟรี ตามโควต้า)
// ถ้าไม่มี แต่มี ANTHROPIC_API_KEY → fallback ไป Claude Haiku
// ถ้าไม่มีทั้งคู่ → 503 บอกให้ตั้ง key

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/permissions";
import { buildAiContext, contextToText } from "@/lib/cashhub/ai-context";

const Schema = z.object({
  question: z.string().min(2).max(500),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(10)
    .optional(),
});

const SYSTEM_PROMPT = `คุณคือผู้ช่วยวิเคราะห์ข้อมูลธุรกิจของ Pooilgroup — บริษัทน้ำมัน + แก๊ส + บริการ มี 30+ สาขา 11 ประเภทธุรกิจ

หน้าที่: ตอบคำถามจากเจ้าของธุรกิจหรือผู้บริหารที่ดู Dashboard ยอดสาขารายวัน

กฎสำคัญ:
1. ตอบเป็น **ภาษาไทย** สั้น กระชับ ตรงประเด็น (ไม่เกิน 6-8 บรรทัด เว้นแต่ถามเปรียบเทียบหลายอย่าง)
2. ใช้ตัวเลขจาก Context ที่ให้เท่านั้น — ห้ามเดาหรือสร้างขึ้นเอง
3. เวลาเทียบเปอร์เซ็นต์ คำนวณจากตัวเลขใน Context
4. ถ้า Context ไม่มีข้อมูลที่ถูกถาม ตอบตรง ๆ ว่า "ข้อมูลในระบบยังไม่มีรายละเอียดนี้"
5. ใช้ภาษาธุรกิจ ไม่ต้องอ้างชื่อ table หรือศัพท์เทคนิค
6. ถ้าเห็นปัญหาเร่งด่วน (เช่น สาขาขาด 5+ วัน, ยอดลดเกิน 30%) ให้ flag ขึ้นมาในตอนท้าย`;

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!isAdmin(session.user) && session.user.role !== "branch_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasGemini && !hasAnthropic) {
    return NextResponse.json(
      {
        error:
          "AI Chat ยังไม่ได้ตั้งค่า — ใส่ GEMINI_API_KEY (ฟรี) หรือ ANTHROPIC_API_KEY ใน .env ก่อน",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "คำถามต้องมี 2-500 ตัวอักษร" },
      { status: 400 },
    );
  }
  const { question, history = [] } = parsed.data;

  const ctx = await buildAiContext(session.user.org_id);
  const contextText = contextToText(ctx);

  try {
    if (hasGemini) {
      const answer = await askGemini(contextText, question, history);
      return NextResponse.json({ answer, provider: "gemini" });
    }
    const answer = await askClaude(contextText, question, history);
    return NextResponse.json({ answer, provider: "claude" });
  } catch (err: unknown) {
    console.error("[ai chat]", err);
    const msg = err instanceof Error ? err.message : "ติดต่อ AI ไม่ได้";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// =============================================================
// Gemini (ฟรี — ใช้ AI Studio key)
// =============================================================
async function askGemini(
  contextText: string,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // Convert history to Gemini contents format
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> =
    [];
  contents.push({
    role: "user",
    parts: [
      {
        text: `Context (ข้อมูลล่าสุดของ Pooilgroup):\n${contextText}\n\n---\n\nคำถาม: ${question}`,
      },
    ],
  });
  for (const h of history.slice(-6)) {
    contents.push({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }],
    });
  }

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.5,
      maxOutputTokens: 800,
    },
  });
  return (
    result.text ?? "ขอโทษ ไม่สามารถสร้างคำตอบได้ในขณะนี้"
  );
}

// =============================================================
// Claude (premium fallback)
// =============================================================
async function askClaude(
  contextText: string,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  messages.push({
    role: "user",
    content: `Context (ข้อมูลล่าสุดของ Pooilgroup):\n${contextText}\n\n---\n\nคำถาม: ${question}`,
  });
  for (const h of history.slice(-6)) {
    messages.push({ role: h.role, content: h.content });
  }

  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });
  return (
    result.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n") || "ขอโทษ ไม่สามารถสร้างคำตอบได้ในขณะนี้"
  );
}
