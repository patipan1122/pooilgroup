// Recruit — AI features (manual trigger only · CEO 2026-05-20 [[ceo-prefers-manual-ai-triggers]])
// No auto-run. Every call needs explicit user action.

import Anthropic from "@anthropic-ai/sdk";
import type { Field, FormSchema } from "./types";

// AI provider — Gemini เป็นหลัก (ฟรี) → Claude สำรอง (จ่าย) ตามแพตเทิร์นทั้งระบบ pooilgroup
// [[pooilgroup-ai-providers-gemini-primary-claude-fallback-2026-07-08]]
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const GEMINI_MODEL = "gemini-2.5-flash";
const HAIKU_MODEL = "claude-haiku-4-5"; // Claude fallback — งานเบา
const SONNET_MODEL = "claude-sonnet-4-5"; // Claude fallback — งานหนัก/อ่านไฟล์

const hasGemini = () => !!process.env.GEMINI_API_KEY;
const hasClaude = () => !!process.env.ANTHROPIC_API_KEY;

/**
 * ไม่มี AI provider ไหนใช้ได้เลย (ไม่ตั้งค่า หรือ ล่มทั้งคู่). batch loop ต้อง "หยุดทั้งชุด"
 * ไม่ใช่วนต่อจนครบแล้วโชว์ success ปลอม.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

type ResumeFile = { bytes: Buffer; mime: string; name: string };

interface AiRequest {
  prompt: string;
  system?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  file?: ResumeFile;
  claudeModel: string; // Claude fallback tier
  maxTokens: number;
  timeoutMs: number;
  endpoint: string;
  track?: { orgId: string; userId?: string | null };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms),
    ),
  ]);
}

/** เรียก Gemini (ตัวหลัก · ฟรี) — รองรับทั้งข้อความ + อ่านไฟล์ PDF/รูป (inlineData) */
async function runGemini(req: AiRequest): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const parts: Array<Record<string, unknown>> = [];
  if (req.file) {
    parts.push({
      inlineData: {
        mimeType: req.file.mime,
        data: req.file.bytes.toString("base64"),
      },
    });
  }
  parts.push({ text: req.prompt });

  const contents: Array<{
    role: "user" | "model";
    parts: Array<Record<string, unknown>>;
  }> = [];
  for (const h of (req.history ?? []).slice(-6)) {
    contents.push({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }],
    });
  }
  contents.push({ role: "user", parts });

  const result = await withTimeout(
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        ...(req.system ? { systemInstruction: req.system } : {}),
        maxOutputTokens: req.maxTokens,
        // ปิด thinking — งานเราเป็น JSON/ข้อความสั้น · กัน thinking กิน token จนคืนค่าว่าง
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    req.timeoutMs,
    "gemini",
  );

  const usage = result.usageMetadata;
  await trackRecruitUsage(
    req.endpoint,
    GEMINI_MODEL,
    {
      usage: {
        input_tokens: usage?.promptTokenCount ?? 0,
        output_tokens: usage?.candidatesTokenCount ?? 0,
      },
    },
    req.track,
  );

  const text = result.text ?? "";
  if (!text.trim()) throw new Error("gemini คืนค่าว่าง");
  return text;
}

/** เรียก Claude (สำรอง · จ่าย) — โครงสร้างเดิม + รองรับไฟล์ (document/image block) */
async function runClaude(req: AiRequest): Promise<string> {
  let userContent: Anthropic.MessageParam["content"] | undefined;
  if (req.file) {
    const b64 = req.file.bytes.toString("base64");
    const filePart: Anthropic.ContentBlockParam =
      req.file.mime === "application/pdf"
        ? {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: b64 },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: req.file.mime as
                | "image/jpeg"
                | "image/png"
                | "image/webp"
                | "image/gif",
              data: b64,
            },
          };
    userContent = [filePart, { type: "text", text: req.prompt }];
  }

  const messages: Anthropic.MessageParam[] = [];
  for (const h of req.history ?? []) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: userContent ?? req.prompt });

  const response = await anthropic.messages.create(
    {
      model: req.claudeModel,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages,
    },
    { timeout: req.timeoutMs },
  );
  await trackRecruitUsage(req.endpoint, req.claudeModel, response, req.track);
  return response.content[0]?.type === "text" ? response.content[0].text : "";
}

/**
 * Gemini หลัก → Claude สำรอง. โยน AiUnavailableError เฉพาะเมื่อ "ทุก provider" ใช้ไม่ได้
 * (ไม่ตั้งค่า หรือ ล่มทั้งคู่) → caller/loop จะได้หยุดทั้งชุด ไม่โชว์ success ปลอม.
 */
async function runAI(req: AiRequest): Promise<string> {
  const geminiOn = hasGemini();
  const claudeOn = hasClaude();
  if (!geminiOn && !claudeOn) {
    throw new AiUnavailableError(
      "ยังไม่ได้ตั้งค่า AI (ไม่มีทั้ง GEMINI_API_KEY และ ANTHROPIC_API_KEY)",
    );
  }

  const problems: string[] = [];
  if (geminiOn) {
    try {
      return await runGemini(req);
    } catch (e) {
      const msg = (e as Error).message;
      problems.push(`Gemini: ${msg}`);
      console.warn(`[recruit ai] gemini failed (${req.endpoint}): ${msg}`);
    }
  }
  if (claudeOn) {
    try {
      return await runClaude(req);
    } catch (e) {
      const msg = (e as Error).message;
      problems.push(`Claude: ${msg}`);
      console.warn(`[recruit ai] claude failed (${req.endpoint}): ${msg}`);
    }
  }
  throw new AiUnavailableError(`AI ประเมินไม่สำเร็จ · ${problems.join(" · ")}`);
}

/** Best-effort cost tracking — never block AI flow on metering failure */
async function trackRecruitUsage(
  endpoint: string,
  model: string,
  resp: { usage?: { input_tokens?: number; output_tokens?: number } },
  ctx?: { orgId: string; userId?: string | null },
) {
  if (!ctx) return;
  try {
    const { recordAiUsage } = await import("@/lib/ai/cost-cap");
    await recordAiUsage({
      userId: ctx.userId,
      orgId: ctx.orgId,
      endpoint,
      model,
      moduleName: "recruit",
      inputTokens: resp.usage?.input_tokens ?? 0,
      outputTokens: resp.usage?.output_tokens ?? 0,
    });
  } catch (e) {
    console.warn("[recruit ai] cost tracking failed", (e as Error).message);
  }
}

// =============================================================
// 1. Field Suggestor — HR กดปุ่ม → AI แนะนำ field ตามตำแหน่ง
// =============================================================
export interface FieldSuggestion {
  type: Field["type"];
  label: string;
  required: boolean;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
  reasoning: string; // why this field
}

export async function suggestFields(input: {
  jobTitle: string;
  companyType?: string; // "Pooil" | "JPSync"
  salaryRange?: string;
  notes?: string;
  track?: { orgId: string; userId?: string | null };
}): Promise<FieldSuggestion[]> {
  const prompt = `คุณคือผู้เชี่ยวชาญด้าน HR สำหรับ SME ไทย ช่วยแนะนำ field สำหรับฟอร์มรับสมัครพนักงาน

ตำแหน่ง: ${input.jobTitle}
บริษัท: ${input.companyType ?? "ไม่ระบุ"}
เงินเดือน: ${input.salaryRange ?? "ไม่ระบุ"}
หมายเหตุ: ${input.notes ?? "ไม่มี"}

แนะนำ field 8-12 ข้อ ที่ HR ควรถามผู้สมัครตำแหน่งนี้ คืน JSON array แบบ:
[
  {
    "type": "short_text" | "long_text" | "yes_no" | "dropdown" | "radio" | "checkbox" | "range" | "number" | "date" | "file",
    "label": "ชื่อ-นามสกุล",
    "required": true,
    "helpText": "ตามบัตรประชาชน",
    "options": [{"value": "x", "label": "X"}], // เฉพาะ dropdown/radio/checkbox
    "reasoning": "เพราะต้องเก็บข้อมูลพื้นฐาน"
  },
  ...
]

ข้อกำหนด:
- เริ่มด้วย ชื่อ-นามสกุล + เบอร์โทร เสมอ (required)
- ไม่ขอบัตรประชาชน · ไม่ขอข้อมูลที่อ่อนไหวเกินจำเป็น
- ขอเฉพาะที่เกี่ยวกับตำแหน่งนี้
- คำถามต้องเป็นภาษาไทย เข้าใจง่าย
- คืนเฉพาะ JSON · ห้ามอธิบายเพิ่ม`;

  const text = await runAI({
    prompt,
    claudeModel: HAIKU_MODEL,
    maxTokens: 2000,
    timeoutMs: 15_000,
    endpoint: "recruit.suggest-fields",
    track: input.track,
  });
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as FieldSuggestion[];
  } catch {
    return [];
  }
}

// =============================================================
// 2. Candidate Scoring — HR กดปุ่ม "ประเมินด้วย AI" รายคน
// =============================================================
export interface CandidateScore {
  score: number; // 0-100
  summary: string; // 1-2 sentences
  strengths: string[]; // 3 items
  risks: string[]; // 2-3 items
}

export async function scoreCandidate(input: {
  jobTitle: string;
  jobDescription?: string;
  formSchema: FormSchema;
  answers: Record<string, unknown>;
  track?: { orgId: string; userId?: string | null };
}): Promise<CandidateScore> {
  // Build answers in readable format (label: answer)
  const readableAnswers: string[] = [];
  for (const section of input.formSchema.sections) {
    for (const field of section.fields) {
      // CEO Q3: ไม่ให้ AI เห็น อายุ + เพศ + ภาพถ่าย (กัน bias)
      const lowerLabel = field.label.toLowerCase();
      if (
        lowerLabel.includes("อายุ") ||
        lowerLabel.includes("เพศ") ||
        lowerLabel.includes("รูป") ||
        field.type === "file"
      ) {
        continue;
      }
      const val = input.answers[field.id];
      if (val == null || val === "") continue;
      readableAnswers.push(`${field.label}: ${formatAnswer(val)}`);
    }
  }

  const prompt = `คุณคือผู้เชี่ยวชาญด้าน HR ประเมินผู้สมัครงาน

ตำแหน่ง: ${input.jobTitle}
JD: ${input.jobDescription ?? "ไม่ระบุ"}

คำตอบของผู้สมัคร:
${readableAnswers.join("\n")}

ประเมินและคืน JSON:
{
  "score": <0-100>,
  "summary": "<1-2 ประโยค สรุปว่าผู้สมัครคนนี้เหมาะกับตำแหน่งนี้แค่ไหน>",
  "strengths": ["<จุดแข็ง 1>", "<จุดแข็ง 2>", "<จุดแข็ง 3>"],
  "risks": ["<จุดเสี่ยง/จุดที่ต้องสัมภาษณ์เพิ่ม 1>", "<จุดเสี่ยง 2>"]
}

ข้อกำหนด:
- คะแนน 80+ = แนะนำให้สัมภาษณ์ทันที
- คะแนน 50-79 = พิจารณาเทียบกับคนอื่น
- คะแนน <50 = อาจไม่ตรง requirement
- ห้ามตัดสินจาก อายุ เพศ ภูมิลำเนา ภาพถ่าย
- ใช้ภาษาไทย ตรงไปตรงมา
- คืนเฉพาะ JSON`;

  const text = await runAI({
    prompt,
    claudeModel: SONNET_MODEL,
    maxTokens: 1000,
    timeoutMs: 20_000,
    endpoint: "recruit.score-candidate",
    track: input.track,
  });
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      score: 0,
      summary: "ไม่สามารถประเมินได้ · โปรดลองอีกครั้ง",
      strengths: [],
      risks: [],
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as CandidateScore;
    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      summary: parsed.summary,
      strengths: parsed.strengths?.slice(0, 3) ?? [],
      risks: parsed.risks?.slice(0, 3) ?? [],
    };
  } catch {
    return {
      score: 0,
      summary: "ไม่สามารถประเมินได้ · โปรดลองอีกครั้ง",
      strengths: [],
      risks: [],
    };
  }
}

// =============================================================
// 2b. Résumé File Scoring — HR กดปุ่ม "อ่านเรซูเม่ + ให้คะแนน"
//     AI เปิดไฟล์ PDF/รูปจริง อ่านเนื้อหา แล้วให้คะแนน (รวมคำตอบในฟอร์มด้วย)
// =============================================================

/** MIME types Claude can read directly — PDF (document block) + images. Word/.docx NOT supported. */
const RESUME_READABLE_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export function isResumeReadableMime(mime: string): boolean {
  return (RESUME_READABLE_MIMES as readonly string[]).includes(mime);
}

export async function scoreResumeFile(input: {
  jobTitle: string;
  jobDescription?: string;
  file: { bytes: Buffer; mime: string; name: string };
  formAnswersText?: string; // readable "label: answer" lines (bias fields already stripped)
  track?: { orgId: string; userId?: string | null };
}): Promise<CandidateScore> {
  const { name } = input.file;

  const prompt = `คุณคือผู้เชี่ยวชาญด้าน HR ประเมินผู้สมัครงานจาก "เรซูเม่/เอกสารแนบ" ที่ผู้สมัครส่งมา (ไฟล์: ${name})

ตำแหน่ง: ${input.jobTitle}
JD: ${input.jobDescription ?? "ไม่ระบุ"}
${input.formAnswersText ? `\nคำตอบเพิ่มเติมจากฟอร์มสมัคร:\n${input.formAnswersText}` : ""}

อ่านเนื้อหาในไฟล์แนบ (ประสบการณ์ การศึกษา ทักษะ ผลงาน) แล้วประเมิน คืน JSON:
{
  "score": <0-100>,
  "summary": "<1-2 ประโยค สรุปว่าเหมาะกับตำแหน่งนี้แค่ไหน อ้างอิงจากเรซูเม่>",
  "strengths": ["<จุดแข็ง 1>", "<จุดแข็ง 2>", "<จุดแข็ง 3>"],
  "risks": ["<จุดเสี่ยง/จุดที่ต้องสัมภาษณ์เพิ่ม 1>", "<จุดเสี่ยง 2>"]
}

ข้อกำหนดสำคัญ:
- คะแนน 80+ = แนะนำสัมภาษณ์ทันที · 50-79 = พิจารณาเทียบคนอื่น · <50 = อาจไม่ตรง requirement
- ⚠️ ห้ามตัดสินจาก รูปถ่าย อายุ เพศ ศาสนา ภูมิลำเนา สถานภาพสมรส — ประเมินเฉพาะประสบการณ์/ทักษะ/ผลงานที่เกี่ยวกับงาน
- ถ้าไฟล์อ่านไม่ออก/เบลอ/ไม่ใช่เรซูเม่ → ให้ score ต่ำ + ระบุใน risks ว่า "อ่านเอกสารไม่ได้"
- ใช้ภาษาไทย ตรงไปตรงมา · คืนเฉพาะ JSON`;

  // vision อ่านไฟล์ช้ากว่า text → 30s · Gemini อ่าน PDF/รูปได้ (inlineData) · Claude สำรอง
  const text = await runAI({
    prompt,
    file: input.file,
    claudeModel: SONNET_MODEL,
    maxTokens: 1000,
    timeoutMs: 30_000,
    endpoint: "recruit.score-resume",
    track: input.track,
  });
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    // Fail loudly — the caller must NOT persist score 0 over a prior good score.
    throw new Error("AI อ่านเรซูเม่ไม่สำเร็จ (อ่านไฟล์ไม่ออก) · ลองใหม่อีกครั้ง");
  }
  try {
    const parsed = JSON.parse(match[0]) as CandidateScore;
    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      summary: parsed.summary,
      strengths: parsed.strengths?.slice(0, 3) ?? [],
      risks: parsed.risks?.slice(0, 3) ?? [],
    };
  } catch {
    // Fail loudly — the caller must NOT persist score 0 over a prior good score.
    throw new Error("AI อ่านเรซูเม่ไม่สำเร็จ (อ่านไฟล์ไม่ออก) · ลองใหม่อีกครั้ง");
  }
}

// =============================================================
// 3. AI Chat — Support assistant (กดเปิดเอง · FAB)
// =============================================================
export async function chatSupport(input: {
  message: string;
  context?: string; // current page context
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  track?: { orgId: string; userId?: string | null };
}): Promise<string> {
  const systemPrompt = `คุณคือผู้ช่วย AI สำหรับ HR ของ Pooilgroup (Pooil + JPSync) ที่ดูแลโปรแกรม "รับสมัครพนักงาน"

หน้าที่:
- ช่วยร่าง JD (job description) สำหรับตำแหน่งต่าง ๆ
- แนะนำคำถามสัมภาษณ์
- เปรียบเทียบผู้สมัครเมื่อ HR ขอ
- สรุปใบสมัครให้ฟัง
- ตอบคำถามเกี่ยวกับการใช้โปรแกรม

สไตล์: ภาษาไทย · ตรงไปตรงมา · กระชับ · ใช้ bullet เมื่อ list หลายข้อ
${input.context ? `\nContext ปัจจุบัน: ${input.context}` : ""}`;

  return runAI({
    prompt: input.message,
    system: systemPrompt,
    history: input.history,
    claudeModel: SONNET_MODEL,
    maxTokens: 1500,
    timeoutMs: 20_000,
    endpoint: "recruit.chat-support",
    track: input.track,
  });
}

// =============================================================
// 4. Message Drafts — HR กดปุ่ม "ร่างด้วย AI" (นัดสัมภาษณ์/รับ/ปฏิเสธ/ขอเอกสาร)
//     คืนข้อความ plain-text ให้ HR ตรวจ+แก้+กดส่งเอง · ไม่ auto-send
// =============================================================
export type DraftKind = "interview_invite" | "offer" | "reject" | "request_docs";

const DRAFT_KIND_INSTRUCTION: Record<DraftKind, string> = {
  interview_invite:
    "ร่างข้อความ 'เชิญมาสัมภาษณ์' — ระบุวันเวลาสัมภาษณ์ตามที่ให้มาเป๊ะ ๆ (ห้ามแต่งวันเอง) บอกสถานที่/รูปแบบถ้ามี · น้ำเสียงยินดีและสุภาพ",
  offer:
    "ร่างข้อความ 'แจ้งผลผ่าน/เสนอรับเข้าทำงาน' — แสดงความยินดี บอกขั้นตอนถัดไปสั้น ๆ (ติดต่อกลับเพื่อยืนยัน)",
  reject:
    "ร่างข้อความ 'แจ้งผลไม่ผ่าน' — สุภาพ ให้เกียรติ ขอบคุณที่สมัคร ไม่ต้องลงรายละเอียดเหตุผล เปิดโอกาสสมัครตำแหน่งอื่นในอนาคต",
  request_docs:
    "ร่างข้อความ 'ขอเอกสารเพิ่มเติม' — บอกว่าต้องการเอกสารอะไร (ตามรายการที่ให้มา) สุภาพ กระชับ",
};

export async function draftMessage(input: {
  kind: DraftKind;
  candidateName: string;
  postingTitle: string;
  companyName?: string;
  interviewWhen?: string; // pre-formatted Thai date — ONLY set by caller for interview_invite
  interviewKind?: string;
  interviewLocation?: string;
  missingDocs?: string;
  track?: { orgId: string; userId?: string | null };
}): Promise<string> {
  const details: string[] = [
    `ชื่อผู้สมัคร: ${input.candidateName}`,
    `ตำแหน่งที่สมัคร: ${input.postingTitle}`,
  ];
  if (input.companyName) details.push(`บริษัท: ${input.companyName}`);
  if (input.kind === "interview_invite") {
    if (input.interviewWhen)
      details.push(`วันเวลานัดสัมภาษณ์ (ใช้ค่านี้เท่านั้น ห้ามเปลี่ยน): ${input.interviewWhen}`);
    if (input.interviewKind) details.push(`รูปแบบ: ${input.interviewKind}`);
    if (input.interviewLocation) details.push(`สถานที่: ${input.interviewLocation}`);
  }
  if (input.kind === "request_docs" && input.missingDocs)
    details.push(`เอกสารที่ต้องขอ: ${input.missingDocs}`);

  const systemPrompt = `คุณคือ HR ของ Pooilgroup ร่างข้อความสั้น ๆ ถึงผู้สมัครงาน
สไตล์: ภาษาไทย · สุภาพ · เป็นกันเอง · กระชับ เหมาะกับแชท/อีเมล
ข้อกำหนด:
- ${DRAFT_KIND_INSTRUCTION[input.kind]}
- ⚠️ ใช้เฉพาะข้อมูล/วันเวลา ที่ให้มาเท่านั้น ห้ามแต่งวันเวลาหรือรายละเอียดที่ไม่ได้ให้
- ขึ้นต้นด้วยคำทักทายพร้อมชื่อผู้สมัคร · ลงท้ายแบบ HR
- คืนเฉพาะ "ตัวข้อความ" ล้วน ๆ ไม่ต้องมีหัวข้อ/คำอธิบาย/เครื่องหมายคำพูดครอบ`;

  const text = await runAI({
    prompt: `ร่างข้อความจากข้อมูลนี้:\n${details.join("\n")}`,
    system: systemPrompt,
    claudeModel: HAIKU_MODEL,
    maxTokens: 600,
    timeoutMs: 15_000,
    endpoint: "recruit.draft-message",
    track: input.track,
  });
  return text.trim();
}

function formatAnswer(val: unknown): string {
  if (val == null) return "-";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
