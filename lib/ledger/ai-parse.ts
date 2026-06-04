// LedgerLine — AI receipt parser.
//
// REUSE of the CashHub OCR pattern (app/api/cashhub/ocr-slip/route.ts):
//   - same @google/genai Gemini Vision call (responseMimeType=application/json)
//   - same budget guard (lib/ai/cost-cap: checkAiBudget before, recordAiUsage after)
// Difference: receipts (ใบเสร็จ/ใบกำกับภาษี) carry far more structure than a
// transfer slip — vendor, tax id, doc date, subtotal/VAT/WHT/total, line items,
// payment method, a suggested category, AND a per-field confidence score.
//
// Model: gemini-3.1-flash-lite (primary, cheapest). On budget exhaustion or a
// hard Gemini failure the caller may escalate to Claude — kept as a thin
// fallback here (TODO[ledger-secret] for a dedicated Claude key/route in M3).
//
// NEVER guesses: the prompt forces null for unreadable fields. recheck.ts then
// re-adds the numbers; a human always confirms (no auto-post).

import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import type { ParsedReceipt, FieldConfidence, ExpenseItem } from "./types";

const PRIMARY_MODEL = "gemini-3.1-flash-lite";

// Gemini Vision cost is dominated by the image (~1290 input tokens/รูป) plus a
// small JSON output. We log fixed estimates like CashHub does — exact token
// accounting isn't returned by the inline-image API.
const EST_INPUT_TOKENS = 1500;
const EST_OUTPUT_TOKENS = 400;

export class AiBudgetError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AiBudgetError";
  }
}

const RECEIPT_PROMPT = `คุณเป็นผู้เชี่ยวชาญอ่านใบเสร็จ/ใบกำกับภาษีไทย (receipt / tax invoice)

จากรูป ดึงข้อมูลเป็น JSON เท่านั้น (ห้ามมีคำอธิบาย ห้าม markdown ห้าม code fence):

{
  "vendor": "<ชื่อร้าน/ผู้ขาย หรือ null>",
  "vendor_tax_id": "<เลขผู้เสียภาษี 13 หลัก หรือ null>",
  "vendor_doc_number": "<เลขที่เอกสาร/เลขที่ใบกำกับภาษีของร้าน หรือ null>",
  "vendor_address": "<ที่อยู่ผู้ขายแบบย่อ หรือ null>",
  "doc_date": "<วันที่ในเอกสาร YYYY-MM-DD หรือ null>",
  "subtotal": <ยอดก่อน VAT (ก่อนหักส่วนลด) เป็น number ไม่มีคอมม่า หรือ null>,
  "discount": <ส่วนลดระดับเอกสาร เป็น number หรือ 0 ถ้าไม่มี>,
  "vat": <ภาษีมูลค่าเพิ่ม เป็น number หรือ null>,
  "wht": <ภาษีหัก ณ ที่จ่าย เป็น number หรือ 0 ถ้าไม่มี>,
  "total": <ยอดสุทธิที่ต้องจ่าย เป็น number หรือ null>,
  "payment_method": "<cash | transfer | qr | credit_card | อื่นๆ หรือ null>",
  "suggested_category": "<หมวดที่เดาว่าใช่ เช่น ค่าน้ำมัน/ขนส่ง, ค่าน้ำ-ไฟ-เน็ต, ค่าวัตถุดิบ/สินค้า, ค่าเช่า, เบ็ดเตล็ด/จิปาถะ หรือ null>",
  "items": [
    { "description": "<ชื่อรายการ>", "qty": <number>, "unit_price": <number>, "amount": <number>, "vat_rate": <0.07 หรือ null> }
  ],
  "confidence": {
    "vendor": <0..1>, "vendor_tax_id": <0..1>, "doc_date": <0..1>,
    "subtotal": <0..1>, "vat": <0..1>, "total": <0..1>,
    "payment_method": <0..1>, "category": <0..1>
  }
}

กฎสำคัญ:
- ฟิลด์ไหนอ่านไม่ออก/ไม่มีในเอกสาร → คืน null (สำหรับ wht ใช้ 0) — ห้ามเดาเด็ดขาด
- ตัวเลขทั้งหมดเป็น number ตรง ๆ ไม่มีคอมม่า ไม่มี ฿
- ถ้าไม่มีรายการย่อยให้คืน "items": []
- confidence = ความมั่นใจจริงในการอ่านแต่ละฟิลด์ (0=เดา, 1=ชัดเจน)
- ถ้ารูปไม่ใช่ใบเสร็จ/ใบกำกับภาษี → คืนทุกฟิลด์เป็น null และ items: []`;

interface RawParsed {
  vendor?: string | null;
  vendor_tax_id?: string | null;
  vendor_doc_number?: string | null;
  vendor_address?: string | null;
  doc_date?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  vat?: number | null;
  wht?: number | null;
  total?: number | null;
  payment_method?: string | null;
  suggested_category?: string | null;
  items?: Array<{
    description?: string;
    qty?: number;
    unit_price?: number;
    amount?: number;
    vat_rate?: number | null;
  }>;
  confidence?: Record<string, number>;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeItems(raw: RawParsed["items"]): ExpenseItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it) => it && typeof it.description === "string" && it.description.trim())
    .map((it) => ({
      description: it.description!.trim(),
      qty: numOrNull(it.qty) ?? 1,
      unitPrice: numOrNull(it.unit_price) ?? 0,
      amount: numOrNull(it.amount) ?? 0,
      vatRate: numOrNull(it.vat_rate),
    }));
}

function normalizeConfidence(raw: Record<string, number> | undefined): FieldConfidence {
  const out: FieldConfidence = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.max(0, Math.min(1, v));
    }
  }
  return out;
}

/** Pull the first {...} JSON object from a (possibly fenced) model reply. */
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

async function callGemini(
  base64: string,
  mimeType: string,
): Promise<{ parsed: RawParsed; raw: string }> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const result = await ai.models.generateContent({
    model: PRIMARY_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: RECEIPT_PROMPT },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens: 1200,
      responseMimeType: "application/json",
    },
  });

  const raw = result.text ?? "";
  return { parsed: safeParseJson(raw), raw };
}

/** Normalize a base64 data URL or raw base64 string → { base64, mimeType }. */
function decodeImageInput(imageUrlOrBase64: string): {
  base64: string;
  mimeType: string;
} {
  const dataUrl = imageUrlOrBase64.match(/^data:(.+?);base64,([\s\S]*)$/);
  if (dataUrl) {
    return { mimeType: dataUrl[1], base64: dataUrl[2] };
  }
  // Already raw base64 — default to jpeg (Gemini is tolerant of the hint).
  return { mimeType: "image/jpeg", base64: imageUrlOrBase64 };
}

/**
 * Parse a receipt image into structured fields + per-field confidence.
 *
 * @param imageUrlOrBase64 a base64 data URL, raw base64, OR an http(s) URL
 *                         (e.g. an R2 public URL — we fetch it server-side).
 * @param userId           the caller's user id, OR null for system ingest
 *                         (e.g. the LINE webhook with no session). null →
 *                         org-only budget cap, user_id stored as null.
 * @throws AiBudgetError when the org/user is over their AI budget.
 * @throws Error on a hard Gemini/network failure (caller may escalate).
 */
export async function parseReceipt(
  imageUrlOrBase64: string,
  userId: string | null,
  orgId: string,
): Promise<ParsedReceipt> {
  // 1. Budget guard (reuse cost-cap) — same gate CashHub uses.
  const budget = await checkAiBudget({
    userId,
    orgId,
    endpoint: "ledger.ocr-receipt",
  });
  if (!budget.allowed) {
    throw new AiBudgetError(budget.reason ?? "เกิน budget AI");
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // 2. Resolve image bytes → base64.
  let base64: string;
  let mimeType: string;
  if (/^https?:\/\//.test(imageUrlOrBase64)) {
    const resp = await fetch(imageUrlOrBase64, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`fetch image failed: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    base64 = buf.toString("base64");
    mimeType = resp.headers.get("content-type") ?? "image/jpeg";
  } else {
    ({ base64, mimeType } = decodeImageInput(imageUrlOrBase64));
  }

  // 3. Call Gemini.
  const { parsed, raw } = await callGemini(base64, mimeType);

  // 4. Record usage (reuse cost-cap; model id drives accurate pricing).
  await recordAiUsage({
    userId,
    orgId,
    endpoint: "ledger.ocr-receipt",
    provider: "gemini-flash",
    model: PRIMARY_MODEL,
    moduleName: "ledger",
    inputTokens: EST_INPUT_TOKENS,
    outputTokens: EST_OUTPUT_TOKENS,
  });

  // 5. Normalize → ParsedReceipt.
  return {
    vendor: parsed.vendor?.trim() || null,
    vendorTaxId: parsed.vendor_tax_id?.replace(/\D/g, "") || null,
    vendorDocNumber: parsed.vendor_doc_number?.trim() || null,
    vendorAddress: parsed.vendor_address?.trim() || null,
    docDate: parsed.doc_date ?? null,
    subtotal: numOrNull(parsed.subtotal),
    discount: numOrNull(parsed.discount) ?? 0,
    vat: numOrNull(parsed.vat),
    wht: numOrNull(parsed.wht) ?? 0,
    total: numOrNull(parsed.total),
    paymentMethod: parsed.payment_method?.trim() || null,
    suggestedCategory: parsed.suggested_category?.trim() || null,
    items: normalizeItems(parsed.items),
    confidence: normalizeConfidence(parsed.confidence),
    ocrModel: PRIMARY_MODEL,
    raw,
  };
}
