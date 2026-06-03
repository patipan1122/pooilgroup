// LedgerLine — parse a short Thai expense note typed in LINE into structured
// fields. ONLY called when the message starts with the trigger word "จด"
// (CEO rule: free text stays free; AI fires only on an explicit "จด"), so the
// org's AI budget is never drained by ordinary group chatter.
//
// Mirrors ai-parse.ts: same cost-cap budget guard + Gemini flash-lite, but
// text-in / JSON-out (much cheaper than vision). NEVER guesses the amount — if
// there's no clear number, total=null and the webhook nudges the user.

import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import { AiBudgetError } from "./ai-parse";

const MODEL = "gemini-3.1-flash-lite";
const EST_INPUT_TOKENS = 260;
const EST_OUTPUT_TOKENS = 120;

export interface ParsedTextExpense {
  total: number | null;
  vendor: string | null;
  paymentMethod: string | null;
  suggestedCategory: string | null;
  docDate: string | null; // YYYY-MM-DD
  note: string | null;
  confidence: Record<string, number>;
}

interface RawText {
  total?: number | null;
  vendor?: string | null;
  payment_method?: string | null;
  suggested_category?: string | null;
  doc_date?: string | null;
  note?: string | null;
  confidence?: Record<string, number>;
}

function bangkokToday(): string {
  const bkk = new Date(Date.now() + 7 * 3600 * 1000);
  return `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}-${String(bkk.getUTCDate()).padStart(2, "0")}`;
}

function prompt(today: string): string {
  return `คุณเป็นผู้ช่วยบันทึกค่าใช้จ่ายภาษาไทย วันนี้คือ ${today} (Asia/Bangkok)

ผู้ใช้พิมพ์โน้ตค่าใช้จ่ายสั้น ๆ ดึงเป็น JSON เท่านั้น (ห้ามคำอธิบาย ห้าม markdown):
{
  "total": <จำนวนเงินเป็น number ไม่มีคอมม่า/฿ หรือ null ถ้าไม่มีตัวเลขเงินชัดเจน>,
  "vendor": "<ชื่อร้าน/สิ่งที่ซื้อ เช่น กาแฟ, ค่าอาหารกลางวัน, แท็กซี่ หรือ null>",
  "payment_method": "<cash | transfer | qr | credit_card หรือ null>",
  "suggested_category": "<เดาหมวด เช่น ค่าน้ำมัน/ขนส่ง, ค่าวัตถุดิบ/สินค้า, ค่ารับรอง, เบ็ดเตล็ด/จิปาถะ หรือ null>",
  "doc_date": "<YYYY-MM-DD แปลงจากคำเช่น 'เมื่อวาน'='${today} ลบ 1 วัน', 'วันนี้'='${today}'; ไม่ระบุ=null>",
  "note": "<ข้อความเดิมที่เหลือ หรือ null>",
  "confidence": { "total": <0..1>, "vendor": <0..1>, "category": <0..1> }
}
กฎ: ตัวเลขเป็น number ตรง ๆ · อ่านไม่ออก→null · ห้ามเดายอดเงิน (ถ้าไม่มีเลข total=null)`;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function clampConf(raw?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(0, Math.min(1, v));
  }
  return out;
}
function safeJson(raw: string): RawText {
  try {
    return JSON.parse(raw) as RawText;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as RawText;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

/**
 * Parse "กาแฟ 45" / "ค่าอาหารกลางวัน 120" / "เมื่อวาน เดินทาง 30" → fields.
 * @param text  the note WITHOUT the leading "จด" trigger.
 * @throws AiBudgetError when over the org AI budget.
 */
export async function parseExpenseText(
  text: string,
  userId: string | null,
  orgId: string,
): Promise<ParsedTextExpense> {
  const budget = await checkAiBudget({ userId, orgId, endpoint: "ledger.parse-text" });
  if (!budget.allowed) throw new AiBudgetError(budget.reason ?? "เกิน budget AI");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const result = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt(bangkokToday()) }, { text: `โน้ต: ${text}` }] }],
    config: { temperature: 0, maxOutputTokens: 400, responseMimeType: "application/json" },
  });
  const raw = result.text ?? "";
  const parsed = safeJson(raw);

  await recordAiUsage({
    userId,
    orgId,
    endpoint: "ledger.parse-text",
    provider: "gemini-flash",
    model: MODEL,
    moduleName: "ledger",
    inputTokens: EST_INPUT_TOKENS,
    outputTokens: EST_OUTPUT_TOKENS,
  });

  return {
    total: numOrNull(parsed.total),
    vendor: parsed.vendor?.trim() || null,
    paymentMethod: parsed.payment_method?.trim() || null,
    suggestedCategory: parsed.suggested_category?.trim() || null,
    docDate: parsed.doc_date ?? null,
    note: parsed.note?.trim() || null,
    confidence: clampConf(parsed.confidence),
  };
}

/** Detect + strip the "จด" trigger. Returns the note, or null if not a record. */
export function stripJodTrigger(text: string): string | null {
  const t = text.trim();
  // Accept "จด ...", "จด...", and the playful "จดให้หน่อย ..." → strip leading จด.
  const m = t.match(/^จด\s*([\s\S]*)$/);
  if (!m) return null;
  return m[1].trim();
}
