// AI Chat — "ถามอะไรก็ได้" — รองรับทั้ง Gemini (ฟรี) + Claude
// เลือก provider จาก env: ถ้ามี GEMINI_API_KEY → ใช้ Gemini (ฟรี ตามโควต้า)
// ถ้าไม่มี แต่มี ANTHROPIC_API_KEY → fallback ไป Claude Haiku
// ถ้าไม่มีทั้งคู่ → 503 บอกให้ตั้ง key

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/permissions";
import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { buildAiContext, contextToText } from "@/lib/cashhub/ai-context";
import {
  findPageGuide,
  pageGuideToText,
  allPagesIndex,
} from "@/lib/usage-guide";

const Schema = z.object({
  question: z.string().min(2).max(500),
  currentPath: z.string().max(200).optional(),
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

const SYSTEM_PROMPT = `คุณคือผู้ช่วยของ Pooilgroup ERP — บริษัทน้ำมัน + แก๊ส + บริการ มี 30+ สาขา 11 ประเภทธุรกิจ

หน้าที่ของคุณมี 2 อย่าง:
A) **วิเคราะห์ข้อมูล** — ตอบคำถามเกี่ยวกับยอดขาย/ผลประกอบการ จากตัวเลขใน Context
B) **แนะนำวิธีใช้งาน** — บอกว่าฟีเจอร์อยู่หน้าไหน + ขั้นตอนใช้งาน + เคล็ดลับ

กฎสำคัญ:
1. ตอบเป็น **ภาษาไทย** กระชับ ตรงประเด็น (ส่วนใหญ่ 4-8 บรรทัด)
2. **คำถามวิเคราะห์ข้อมูล**: ใช้ตัวเลขจาก "Live Data" เท่านั้น ห้ามเดา. ถ้า Live Data ไม่มี ตอบตรงๆ ว่า "ข้อมูลในระบบยังไม่มีรายละเอียดนี้"
3. **คำถามวิธีใช้**: ใช้ "Page Guide" + "Pages Index" เป็นหลัก. บอกชื่อหน้า/เมนูที่ต้องไป + ขั้นตอน 1-2-3 สั้นๆ
4. ถ้าผู้ใช้กำลังเปิดหน้าเฉพาะอยู่ (มี "Current Page Context") ให้ตอบคำถามใน scope ของหน้านั้นก่อน — ก่อนค่อยขยายไปทั่วระบบ
5. ใช้ภาษาธุรกิจ ไม่ใช้ศัพท์เทคนิค (ห้ามพูดถึงชื่อ table/SQL/API)
6. ถ้าเห็นปัญหาเร่งด่วน (สาขาขาด 5+ วัน, ยอดลดเกิน 30%) flag ที่ท้าย
7. ถ้าไม่แน่ใจว่าเป็นคำถามแบบไหน (ข้อมูลหรือวิธีใช้) ให้ถามกลับ 1 ประโยคสั้นๆ เพื่อ clarify`;

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!isAdmin(session.user) && session.user.role !== "branch_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit: 20 calls / 5 min per user (DevOps audit 2026-05-20)
  // budget guard ที่ตามมาเป็น $-cap · rate limit เป็น req-count guard
  const rl = await checkRateLimit({
    bucket: `cashhub-ai:${session.user.id}`,
    max: 20,
    windowSec: 300,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: `ส่งคำถามถี่เกินไป · ลองใหม่อีก ${rl.retryAfterSec} วินาที` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }
  // IP-level cap กัน automation/scraper
  const ip = getClientIp(req);
  const rlIp = await checkRateLimit({
    bucket: `cashhub-ai-ip:${ip}`,
    max: 60,
    windowSec: 300,
  });
  if (rlIp.limited) {
    return NextResponse.json(
      { error: "ระบบกำลังคึกคัก · ลองใหม่อีกสักครู่" },
      { status: 429 },
    );
  }

  // BUG-017: AI budget check before calling provider
  const budget = await checkAiBudget({
    userId: session.user.id,
    orgId: session.user.org_id,
    endpoint: "cashhub.ai",
  });
  if (!budget.allowed) {
    return NextResponse.json({ error: budget.reason }, { status: 429 });
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
  const { question, history = [], currentPath } = parsed.data;

  const ctx = await buildAiContext(session.user.org_id);
  const contextText = contextToText(ctx);

  // Build augmented context: live data + current page + full pages index
  const sections: string[] = [`[Live Data]\n${contextText}`];
  const pageGuide = currentPath ? findPageGuide(currentPath) : null;
  if (pageGuide) {
    sections.push(
      `[Current Page Context]\nผู้ใช้กำลังอยู่ที่ ${currentPath}\n${pageGuideToText(pageGuide)}`,
    );
  }
  sections.push(`[Pages Index — ทุกหน้าในระบบ]\n${allPagesIndex()}`);
  const fullContext = sections.join("\n\n---\n\n");

  try {
    if (hasGemini) {
      const answer = await askGemini(fullContext, question, history);
      // Track usage (Gemini ฟรี — cost = 0 แต่ track count สำหรับ rate cap)
      await recordAiUsage({
        userId: session.user.id,
        orgId: session.user.org_id,
        endpoint: "cashhub.ai",
        provider: "gemini-flash",
        inputTokens: question.length / 4, // rough estimate
        outputTokens: answer.length / 4,
      });
      return NextResponse.json({ answer, provider: "gemini" });
    }
    const answer = await askClaude(fullContext, question, history);
    await recordAiUsage({
      userId: session.user.id,
      orgId: session.user.org_id,
      endpoint: "cashhub.ai",
      provider: "claude-haiku",
      inputTokens: question.length / 4,
      outputTokens: answer.length / 4,
    });
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

  // Conversation order: [prior history..., current question]. Same fix
  // as the Claude branch — appending history after the question confused
  // the model about which turn to answer.
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> =
    [];
  for (const h of history.slice(-6)) {
    contents.push({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }],
    });
  }
  contents.push({
    role: "user",
    parts: [
      {
        text: `Context (ข้อมูลล่าสุดของ Pooilgroup):\n${contextText}\n\n---\n\nคำถาม: ${question}`,
      },
    ],
  });

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

  // Conversation order must be: [prior history..., current question]. The
  // previous code pushed the current question first then appended history
  // after, which confused the model about which turn to answer.
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const h of history.slice(-6)) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({
    role: "user",
    content: `Context (ข้อมูลล่าสุดของ Pooilgroup):\n${contextText}\n\n---\n\nคำถาม: ${question}`,
  });

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
