// Recruit — AI features (manual trigger only · CEO 2026-05-20 [[ceo-prefers-manual-ai-triggers]])
// No auto-run. Every call needs explicit user action.

import Anthropic from "@anthropic-ai/sdk";
import type { Field, FormSchema } from "./types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = "claude-haiku-4-5";
const SONNET_MODEL = "claude-sonnet-4-5";

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

  // B-002: explicit timeout — Anthropic call should fail fast if unreachable
  const response = await anthropic.messages.create(
    {
      model: HAIKU_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    },
    { timeout: 15_000 },
  );

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";
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

  // B-002: explicit timeout
  const response = await anthropic.messages.create(
    {
      model: SONNET_MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    },
    { timeout: 20_000 },
  );

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";
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
// 3. AI Chat — Support assistant (กดเปิดเอง · FAB)
// =============================================================
export async function chatSupport(input: {
  message: string;
  context?: string; // current page context
  history?: Array<{ role: "user" | "assistant"; content: string }>;
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

  const messages = (input.history ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  messages.push({ role: "user", content: input.message });

  // B-002: explicit timeout
  const response = await anthropic.messages.create(
    {
      model: SONNET_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: messages as Anthropic.MessageParam[],
    },
    { timeout: 20_000 },
  );

  return response.content[0]?.type === "text" ? response.content[0].text : "";
}

function formatAnswer(val: unknown): string {
  if (val == null) return "-";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
