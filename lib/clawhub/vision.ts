// ClawHub (JOLLY PLAY) — AI vision: read the claw-machine LCD screen.
//
// The machine has a blue LCD showing: Credit, Time, Coin ("1 Coin / 1 Play"),
// Price: (e.g. 35), Add up: (e.g. 0 = amount accumulated this play). We extract
// these so the refund engine can cross-check the customer's typed baht amount.
//
// Mirrors the Gemini pattern from lib/ledger/ai-parse.ts: same model id, inlineData
// base64, safeParseJson, and the checkAiBudget / recordAiUsage budget guard — but
// with moduleName "clawhub" and endpoint "clawhub.read-screen".

import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import type { VisionResult } from "./types";

const PRIMARY_MODEL = "gemini-3.1-flash-lite";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

const EST_INPUT_TOKENS = 1400;
const EST_OUTPUT_TOKENS = 120;

const SCREEN_PROMPT = `คุณคือผู้ช่วยอ่านหน้าจอ LCD สีฟ้าของตู้คีบตุ๊กตา (claw machine).
จอแสดงค่าเหล่านี้ (ภาษาอังกฤษบนจอจริง):
- "Credit"  = เครดิตคงเหลือ (จำนวนเหรียญ)
- "Time"    = เวลานับถอยหลัง (ข้ามได้)
- "Coin"    = ปกติเขียน "1 Coin / 1 Play" (เหรียญต่อการเล่น 1 ครั้ง)
- "Price:"  = ราคา/ค่าเล่น เช่น 35
- "Add up:" = ยอดสะสมที่หยอดเข้าไปแล้วในรอบนี้ เช่น 0

อ่านตัวเลขจากรูปให้แม่นที่สุด ถ้าฟิลด์ไหนอ่านไม่ออกหรือไม่มี ให้ใส่ null.
ตอบเป็น JSON เท่านั้น รูปแบบนี้:
{
  "credit": <number|null>,
  "price": <number|null>,
  "add_up": <number|null>,
  "coin_per_play": <number|null>,
  "raw_text": "<ข้อความทั้งหมดที่อ่านได้จากจอ>",
  "confidence": <0..1 ความมั่นใจว่าตัวเลขที่อ่านถูกต้องและรูปคือหน้าจอตู้จริง>
}
ถ้ารูปไม่ใช่หน้าจอตู้ หรือเบลอ/มืดจนอ่านไม่ได้ → confidence ต่ำ (< 0.4).`;

type RawParsed = {
  credit?: number | null;
  price?: number | null;
  add_up?: number | null;
  coin_per_play?: number | null;
  raw_text?: string;
  confidence?: number;
};

function safeParseJson(raw: string): RawParsed {
  try {
    return JSON.parse(raw) as RawParsed;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as RawParsed;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.round(v);
}

function clampConfidence(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

const FAIL: VisionResult = {
  addUp: null,
  price: null,
  credit: null,
  coinPerPlay: null,
  rawText: "",
  confidence: 0,
};

/** Fetch an image URL into base64 + mime (for the r2Url input path). */
async function fetchAsBase64(
  url: string,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType };
}

export async function readMachineScreen(
  input: { base64?: string; mimeType?: string; r2Url?: string },
  ctx: { orgId: string; userId?: string | null },
): Promise<VisionResult> {
  // Resolve image bytes.
  let base64 = input.base64 ?? "";
  let mimeType = input.mimeType ?? "image/jpeg";
  try {
    if (!base64 && input.r2Url) {
      const fetched = await fetchAsBase64(input.r2Url);
      base64 = fetched.base64;
      mimeType = fetched.mimeType;
    }
  } catch {
    return FAIL;
  }
  if (!base64) return FAIL;

  // Budget guard — same shape as ledger ai-parse.
  const budget = await checkAiBudget({
    userId: ctx.userId ?? null,
    orgId: ctx.orgId,
    endpoint: "clawhub.read-screen",
  });
  if (!budget.allowed) {
    return { ...FAIL, rawText: `[budget] ${budget.reason ?? "blocked"}` };
  }

  let modelUsed = PRIMARY_MODEL;
  let text = "";
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const run = async (model: string) => {
      const result = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { text: SCREEN_PROMPT },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: 600,
          responseMimeType: "application/json",
        },
      });
      return result.text ?? "";
    };

    try {
      text = await run(PRIMARY_MODEL);
    } catch {
      modelUsed = FALLBACK_MODEL;
      text = await run(FALLBACK_MODEL);
    }
  } catch {
    return FAIL;
  }

  // Record usage regardless of parse outcome (we spent the call).
  await recordAiUsage({
    userId: ctx.userId ?? null,
    orgId: ctx.orgId,
    endpoint: "clawhub.read-screen",
    provider: "gemini-flash",
    model: modelUsed,
    moduleName: "clawhub",
    inputTokens: EST_INPUT_TOKENS,
    outputTokens: EST_OUTPUT_TOKENS,
  });

  const parsed = safeParseJson(text);
  return {
    addUp: toIntOrNull(parsed.add_up),
    price: toIntOrNull(parsed.price),
    credit: toIntOrNull(parsed.credit),
    coinPerPlay: toIntOrNull(parsed.coin_per_play),
    rawText: typeof parsed.raw_text === "string" ? parsed.raw_text : "",
    confidence: clampConfidence(parsed.confidence),
  };
}
