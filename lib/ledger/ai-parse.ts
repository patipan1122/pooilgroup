// LedgerLine — AI receipt parser.
//
// REUSE of the CashHub OCR pattern (app/api/cashhub/ocr-slip/route.ts):
//   - same @google/genai Gemini Vision call (responseMimeType=application/json)
//   - same budget guard (lib/ai/cost-cap: checkAiBudget before, recordAiUsage after)
// Difference: receipts (ใบเสร็จ/ใบกำกับภาษี) carry far more structure than a
// transfer slip — vendor, tax id, doc date, subtotal/VAT/WHT/total, line items,
// payment method, a suggested category, AND a per-field confidence score.
//
// Model: gemini-3.1-flash-lite (primary). Chosen via 3 LIVE SPIKES on real JP
// Link receipts (2026-06-02, memory thai-receipt-ocr-research): fastest (~2s),
// cheapest, and the most accurate on the king field (total amount) — beat even
// gemini-2.5-pro. On a hard failure we fall back to FALLBACK_MODEL.
//
// ⚠️ DO NOT downgrade to gemini-2.0-* — Google RETIRED all 2.0 models on
// 2026-06-01 (the 84-fixes commit 392c2d6 wrongly set 2.0-flash-lite thinking
// 3.1 "didn't exist" → broke OCR in prod, every receipt read ฿0.00). 3.1-flash-
// lite GA'd 2026-05-07, earliest shutdown 2027-05-07. Verify model names against
// https://ai.google.dev/gemini-api/docs/deprecations before ever changing this.
//
// NEVER guesses: the prompt forces null for unreadable fields. recheck.ts then
// re-adds the numbers; a human always confirms (no auto-post).

import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import type { ParsedReceipt, FieldConfidence, ExpenseItem, ExpenseDocType } from "./types";
import { normalizePurchaseType } from "./types";

const PRIMARY_MODEL = "gemini-3.1-flash-lite";
// Same-accuracy backup (spike #3: 3.5-flash tied 3.1 at 12/10/8) for the rare
// case the primary errors/returns blank — keeps OCR working through a model
// hiccup instead of silently posting ฿0.00.
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

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
  "doc_type": "<ประเภทเอกสาร: tax_invoice (ใบกำกับภาษี) | receipt (ใบเสร็จรับเงิน) | cash_bill (บิลเงินสด) | quotation (ใบเสนอราคา/ใบแจ้งหนี้ที่ยังไม่ใช่ใบกำกับ) | delivery_note (ใบส่งของ) | other (อื่นๆ) — ดูจากหัวเอกสาร>",
  "vendor_tax_id": "<เลขผู้เสียภาษี 13 หลัก หรือ null>",
  "buyer_tax_id": "<เลขผู้เสียภาษีของผู้ซื้อบนเอกสาร ถ้ามี หรือ null — มองบล็อกลูกค้า/ผู้ซื้อ/ในนาม ไม่ใช่เลขร้านผู้ขาย ห้ามเดา>",
  "vendor_doc_number": "<เลขที่เอกสาร/เลขที่ใบกำกับภาษีของร้าน หรือ null>",
  "vendor_address": "<ที่อยู่ผู้ขายแบบย่อ หรือ null>",
  "doc_date": "<วันที่ในเอกสาร YYYY-MM-DD หรือ null>",
  "subtotal": <ยอดรวมค่าสินค้า/บริการ ก่อนหักส่วนลดท้ายบิล และก่อน VAT = ผลรวม amount ทุกบรรทัด (ต้อง = Σ items.amount เสมอ) · ห้ามเอายอด "คงเหลือ/หลังหักส่วนลด" ที่อยู่เหนือบรรทัด VAT มาใส่ช่องนี้ — number ไม่มีคอมม่า หรือ null>,
  "discount": <ส่วนลดท้ายบิลที่หักจากยอดรวมทั้งใบ เป็น number บาท (ไม่มี=0) · ถ้าส่วนลดถูกหักในแต่ละบรรทัดแล้ว→ใส่ 0 (ห้ามหักซ้ำ) · ถ้าเป็น %→แปลงเป็นบาทก่อน · ต้องได้ subtotal − discount + vat − wht = total>,
  "vat": <ภาษีมูลค่าเพิ่ม เป็น number หรือ null>,
  "wht": <ภาษีหัก ณ ที่จ่าย เป็น number หรือ 0 ถ้าไม่มี>,
  "total": <ยอดสุทธิที่ต้องจ่าย เป็น number หรือ null>,
  "payment_method": "<cash | transfer | qr | credit_card | อื่นๆ หรือ null>",
  "suggested_category": "<หมวดที่เดาว่าใช่ ต้องใช้ชื่อให้ตรง 1 ในผังนี้เป๊ะ ๆ: เงินเดือน/ค่าแรง, ค่าคอมมิชชั่น/นายหน้า, สินค้าเพื่อขายแบบมีสต๊อก, ค่าวัตถุดิบ/สินค้า (ไม่สต๊อก), งานก่อสร้าง/รีโนเวท (เหมารวม), ค่าซ่อมบำรุงรักษา, ค่าจ้าง/บริการทั่วไป, ค่าวิชาชีพ/บัญชี/ที่ปรึกษา, ค่าโฆษณา/การตลาด, ค่ารับรอง, ค่าประกันภัย, ค่าไฟฟ้า, ค่าน้ำประปา, ค่าโทรศัพท์/อินเทอร์เน็ต, วัสดุ/อุปกรณ์สำนักงาน, ค่าเช่าสำนักงาน, ค่าเช่ายานพาหนะ, ค่าน้ำมันยานพาหนะ, ค่าเดินทาง, ค่าธรรมเนียมธนาคาร, ภาษีป้าย, ค่าใช้จ่ายเบ็ดเตล็ด หรือ null ถ้าไม่แน่ใจ>",
  "purchase_type": "<ประเภทการซื้อ — เลือก 1 อย่าง: goods (ซื้อของ/สินค้า/วัสดุสิ้นเปลือง/อุปกรณ์) | service (ค่าบริการ/ค่าจ้าง/ค่าเช่า/ค่าน้ำ-ไฟ-เน็ต/ค่าธรรมเนียม/ที่ปรึกษา/ซ่อม) | construction (วัสดุก่อสร้าง/ต่อเติม/รับเหมา) หรือ null ถ้าไม่แน่ใจ>",
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
- ถ้ารูปไม่ใช่ใบเสร็จ/ใบกำกับภาษี → คืนทุกฟิลด์เป็น null และ items: []

กฎส่วนลด (ทำผิดบ่อย — อ่านให้ครบ):
- subtotal = ยอด "ก่อน" หักส่วนลดเสมอ = ผลรวม amount ทุกบรรทัด · ใบมักพิมพ์บันได: รวมเงิน → หักส่วนลด → คงเหลือ → VAT → สุทธิ · เอา "รวมเงิน" (ก่อนส่วนลด) เป็น subtotal ห้ามเอา "คงเหลือ" มาใส่
- ส่วนลดต่อบรรทัด (มีคอลัมน์ส่วนลดรายแถว) → amount แต่ละแถว = ยอดสุทธิหลังหักแถวนั้น แล้ว discount = 0 (ห้ามหักซ้ำ)
- ส่วนลดท้ายบิลก้อนเดียว → ใส่เป็นบาทใน discount, amount แต่ละแถวเป็นราคาเต็ม
- ส่วนลด % (เช่น "10%") → discount = subtotal × % ÷ 100 (ห้ามกรอกเลข % ตรง ๆ)
- ส่วนลดที่พิมพ์เป็นแถวติดลบใน items → อย่าเก็บเป็น item ให้ย้ายไปเป็น discount

กฎ VAT (ตัวการทำยอดไม่ตรงมากสุด — บิลไทยส่วนใหญ่เป็นราคารวม VAT):
- แยก vat > 0 เฉพาะเมื่อบิลพิมพ์บรรทัด "ภาษีมูลค่าเพิ่ม / VAT 7%" เป็นตัวเลขแยกต่างหากชัดเจน → ตอนนั้น subtotal/discount = ยอด "ก่อน VAT" และ vat ≈ (subtotal − discount) × 0.07
- ถ้าไม่มีบรรทัด VAT แยก หรือเขียน "ราคารวม VAT/รวมภาษีแล้ว" → vat = 0 เสมอ · เก็บ subtotal/discount/total เป็นราคาตามที่พิมพ์ · ให้ subtotal − discount = total · ห้ามแกะ VAT ออกมาเอง (แกะ VAT บนบิลราคารวม = ยอดเกิน คิดภาษีซ้ำ = สาเหตุยอดไม่ตรงที่พบบ่อยสุด)
- เหตุผล: ใบกำกับภาษีเต็มรูปตามกฎหมายต้องโชว์ VAT แยกบรรทัดอยู่แล้ว · ไม่โชว์แยก = บิลราคารวม → ปล่อย vat=0 ให้คนยืนยัน

กฎเงินสด/เงินทอน (บิลเงินสด/POS):
- ห้ามเอาบรรทัด "เงินสด/รับเงิน/เงินรับ/รับมา/จ่ายมา/เงินทอน/ทอน/Cash/Tender/Change" มาเป็น subtotal หรือ total เด็ดขาด — นั่นคือเงินที่ลูกค้ายื่นให้ + เงินทอน ไม่ใช่ยอดบิล
- total = ตัวเลขข้างป้าย "รวมทั้งสิ้น/รวมสุทธิ/สุทธิ/ยอดชำระ" (มักอยู่ล่างสุด/ตัวหนา) ไม่ใช่เลขที่ใหญ่ที่สุดบนใบ · ตรวจ: (เงินรับ − เงินทอน) ควร = total

ตรวจก่อนตอบ (บังคับ): subtotal − discount + vat − wht ต้อง = total (คลาด ≤ 1 บาท) และ Σ items.amount = subtotal · ถ้าไม่ตรง → ส่วนใหญ่เกิดจากแกะ VAT บนบิลราคารวม (แก้: vat=0) หรือหักส่วนลดซ้ำ หรือหยิบเงินสด/เงินทอนมา → ทบทวนแล้วอ่านใหม่ก่อนคืนค่า

ตัวอย่าง (ทำตามให้ผ่านสมการ):
(ก) ราคารวม VAT + ส่วนลดท้ายบิล · ไม่มีบรรทัด VAT แยก → vat=0: ของ 7500 → ลด 500 → สุทธิ 7000
{"subtotal":7500,"discount":500,"vat":0,"wht":0,"total":7000,"items":[{"description":"สินค้า","qty":1,"unit_price":7500,"amount":7500,"vat_rate":null}]}
(ข) ใบกำกับภาษีเต็มรูป มี VAT แยก + ส่วนลดต่อบรรทัด: เก้าอี้ 10 ตัว (ลดในแถวแล้ว=4500) + โต๊ะ=2400 · รวม 6900 → ลดท้ายบิล 400 → VAT 455 → สุทธิ 6955
{"subtotal":6900,"discount":400,"vat":455,"wht":0,"total":6955,"items":[{"description":"เก้าอี้","qty":10,"unit_price":500,"amount":4500,"vat_rate":0.07},{"description":"โต๊ะ","qty":2,"unit_price":1200,"amount":2400,"vat_rate":0.07}]}
(ค) บิลเงินสด POS: รวม 83 · เงินสด 100 · เงินทอน 17 (ข้าม 100 กับ 17) → vat=0
{"subtotal":83,"discount":0,"vat":0,"wht":0,"total":83,"items":[{"description":"นม","qty":2,"unit_price":24,"amount":48,"vat_rate":null},{"description":"ขนมปัง","qty":1,"unit_price":35,"amount":35,"vat_rate":null}]}`;

interface RawParsed {
  vendor?: string | null;
  doc_type?: string | null;
  vendor_tax_id?: string | null;
  buyer_tax_id?: string | null;
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
  purchase_type?: string | null;
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

/**
 * Map the AI's doc_type (enum slug OR Thai words) onto our ExpenseDocType.
 * Defaults to "tax_invoice" (matches the DB default) when unreadable/missing —
 * so a non-receipt image stays consistent with current behaviour.
 */
function normalizeDocType(raw: unknown): ExpenseDocType {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!v) return "tax_invoice";
  if (v === "tax_invoice" || v.includes("กำกับ")) return "tax_invoice";
  if (v === "receipt" || v.includes("เสร็จ")) return "receipt";
  // ใบเสนอราคา / ใบแจ้งหนี้ที่ยังไม่ใช่ใบกำกับ (D1) — ตรวจก่อน cash_bill เพราะ
  // cash_bill จับคำว่า "บิล" ซึ่งกว้างเกินไป.
  if (v === "quotation" || v.includes("เสนอราคา") || v.includes("ใบเสนอ"))
    return "quotation";
  if (v === "delivery_note" || v.includes("ส่งของ") || v.includes("ส่งสินค้า"))
    return "delivery_note";
  if (v === "cash_bill" || v.includes("เงินสด") || v.includes("บิล"))
    return "cash_bill";
  if (v === "other" || v.includes("อื่น")) return "other";
  return "tax_invoice";
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

/** One generateContent call against a given model id. Returns the raw text. */
async function callGeminiModel(
  ai: import("@google/genai").GoogleGenAI,
  model: string,
  base64: string,
  mimeType: string,
): Promise<{ raw: string; finishReason: string | undefined; ok: boolean }> {
  const result = await ai.models.generateContent({
    model,
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
  const finishReason = result.candidates?.[0]?.finishReason;
  const raw = result.text ?? "";
  const ok = raw.length >= 5;
  if (!ok) {
    console.warn(`[ledger:ocr] model=${model} returned empty/blank. finishReason=${finishReason} candidateCount=${result.candidates?.length ?? 0} promptFeedback=${JSON.stringify(result.promptFeedback)}`);
  } else {
    console.log(`[ledger:ocr] model=${model} responded OK finishReason=${finishReason} rawLen=${raw.length}`);
  }
  return { raw, finishReason, ok };
}

async function callGemini(
  base64: string,
  mimeType: string,
): Promise<{ parsed: RawParsed; raw: string; modelUsed: string }> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const imgSizeKb = Math.round((base64.length * 3) / 4 / 1024);
  console.log(`[ledger:ocr] calling Gemini model=${PRIMARY_MODEL} mimeType=${mimeType} imgSize≈${imgSizeKb}KB`);

  // Try the primary model; on a thrown error OR a blank response, fall back to
  // FALLBACK_MODEL once (covers a retired/overloaded primary or a one-off block).
  let raw = "";
  let modelUsed = PRIMARY_MODEL;
  try {
    const r = await callGeminiModel(ai, PRIMARY_MODEL, base64, mimeType);
    raw = r.raw;
    if (!r.ok) throw new Error(`primary ${PRIMARY_MODEL} blank (finishReason=${r.finishReason})`);
  } catch (e) {
    console.warn(`[ledger:ocr] primary failed (${e instanceof Error ? e.message : e}) → trying ${FALLBACK_MODEL}`);
    const r = await callGeminiModel(ai, FALLBACK_MODEL, base64, mimeType);
    raw = r.raw;
    modelUsed = FALLBACK_MODEL;
  }

  return { parsed: safeParseJson(raw), raw, modelUsed };
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

  // 3. Call Gemini (primary → fallback on blank/error).
  const { parsed, raw, modelUsed } = await callGemini(base64, mimeType);

  // 4. Record usage (reuse cost-cap; model id drives accurate pricing).
  await recordAiUsage({
    userId,
    orgId,
    endpoint: "ledger.ocr-receipt",
    provider: "gemini-flash",
    model: modelUsed,
    moduleName: "ledger",
    inputTokens: EST_INPUT_TOKENS,
    outputTokens: EST_OUTPUT_TOKENS,
  });

  // 5. Normalize → ParsedReceipt.
  return {
    vendor: parsed.vendor?.trim() || null,
    docType: normalizeDocType(parsed.doc_type),
    vendorTaxId: parsed.vendor_tax_id?.replace(/\D/g, "") || null,
    buyerTaxIdOnDoc: parsed.buyer_tax_id?.replace(/\D/g, "") || null,
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
    purchaseType: normalizePurchaseType(parsed.purchase_type),
    items: normalizeItems(parsed.items),
    confidence: normalizeConfidence(parsed.confidence),
    ocrModel: modelUsed,
    raw,
  };
}

// P1#13 — slip-focused prompt (payment slip / โอนเงิน). Only extracts the 4
// fields needed to dedup + match a bill. Far fewer tokens than RECEIPT_PROMPT
// (~20 fields) — a PromptPay/banking slip never has line items, tax IDs, etc.
const SLIP_PROMPT = `คุณเป็นผู้อ่านสลิปโอนเงิน/สลิปชำระเงินไทย (PromptPay, โอนธนาคาร, QR payment)

จากรูป ดึงข้อมูลเป็น JSON เท่านั้น (ห้ามมีคำอธิบาย ห้าม markdown ห้าม code fence):

{
  "amount": <ยอดโอน เป็น number ไม่มีคอมม่า หรือ null>,
  "bank": "<ชื่อธนาคารผู้โอน เช่น กสิกร, กรุงเทพ, SCB, ออมสิน หรือ null>",
  "transaction_ref": "<เลขอ้างอิงธุรกรรม/เลขที่รายการ หรือ null>",
  "date": "<วันที่โอน YYYY-MM-DD หรือ null>",
  "recipient_name": "<ชื่อบัญชีผู้รับเงิน/ปลายทาง (คนละคนกับผู้โอน) หรือ null>",
  "recipient_account": "<เลขบัญชี/พร้อมเพย์ของผู้รับ ตามที่เห็นจริงในสลิป — คงเครื่องหมาย x ที่ปิดหลักไว้ ห้ามเดาหลักที่ถูกปิด หรือ null>"
}

กฎสำคัญ:
- ฟิลด์ไหนอ่านไม่ออก → คืน null ห้ามเดา
- amount เป็น number ตรง ๆ ไม่มีสัญลักษณ์
- recipient_name = ชื่อ "ผู้รับเงิน/ปลายทาง" เท่านั้น (มักอยู่ใต้คำว่า "ไปยัง/ผู้รับ/เข้าบัญชี") ไม่ใช่ชื่อผู้โอน
- recipient_account = เลขที่เห็นจริงเท่านั้น เก็บ x/* ที่ปิดหลักไว้ตามเดิม ห้ามแต่งเลขที่ถูกปิด
- ถ้าภาพไม่ใช่สลิปโอนเงิน → คืนทุกฟิลด์เป็น null`;

interface RawSlip {
  amount?: number | null;
  bank?: string | null;
  transaction_ref?: string | null;
  date?: string | null;
  recipient_name?: string | null;
  recipient_account?: string | null;
}

export interface ParsedSlip {
  amount: number | null;
  bank: string | null;
  transactionRef: string | null;
  date: string | null;
  /** ชื่อผู้รับเงินที่อ่านได้จากสลิป (verify ว่าโอนถูกคนไหม). */
  recipientName: string | null;
  /** เลขบัญชี/พร้อมเพย์ผู้รับตามที่เห็น (อาจถูกปิดบางหลัก) — verify บัญชีปลายทาง. */
  recipientAcct: string | null;
  ocrModel: string;
}

async function callGeminiSlip(
  base64: string,
  mimeType: string,
): Promise<RawSlip> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const result = await ai.models.generateContent({
    model: PRIMARY_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: SLIP_PROMPT },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens: 200, // slip response is tiny
      responseMimeType: "application/json",
    },
  });
  const raw = result.text ?? "";
  try {
    return JSON.parse(raw) as RawSlip;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]) as RawSlip; } catch { /* fall */ }
    }
    return {};
  }
}

/**
 * P1#13 — Parse a payment slip image with a focused minimal prompt.
 * Only extracts: amount, bank, transactionRef, date — the full RECEIPT_PROMPT
 * (20+ fields) is overkill for a PromptPay/transfer slip.
 *
 * @param imageUrlOrBase64 http(s) URL, raw base64, or data URL.
 * @param userId           null for webhook / system ingest.
 * @param orgId            for budget cap.
 */
export async function parseSlipImage(
  imageUrlOrBase64: string,
  userId: string | null,
  orgId: string,
): Promise<ParsedSlip> {
  const budget = await checkAiBudget({
    userId,
    orgId,
    endpoint: "ledger.ocr-slip",
  });
  if (!budget.allowed) {
    throw new AiBudgetError(budget.reason ?? "เกิน budget AI (slip)");
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  let base64: string;
  let mimeType: string;
  if (/^https?:\/\//.test(imageUrlOrBase64)) {
    const resp = await fetch(imageUrlOrBase64, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`fetch slip image failed: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    base64 = buf.toString("base64");
    mimeType = resp.headers.get("content-type") ?? "image/jpeg";
  } else {
    const dataUrl = imageUrlOrBase64.match(/^data:(.+?);base64,([\s\S]*)$/);
    if (dataUrl) {
      mimeType = dataUrl[1];
      base64 = dataUrl[2];
    } else {
      mimeType = "image/jpeg";
      base64 = imageUrlOrBase64;
    }
  }

  const parsed = await callGeminiSlip(base64, mimeType);

  await recordAiUsage({
    userId,
    orgId,
    endpoint: "ledger.ocr-slip",
    provider: "gemini-flash",
    model: PRIMARY_MODEL,
    moduleName: "ledger",
    inputTokens: 1500, // still image-dominated
    outputTokens: 60,  // tiny JSON output
  });

  return {
    amount: numOrNull(parsed.amount),
    bank: parsed.bank?.trim() || null,
    transactionRef: parsed.transaction_ref?.trim() || null,
    date: parsed.date?.trim() || null,
    recipientName: parsed.recipient_name?.trim() || null,
    recipientAcct: parsed.recipient_account?.trim() || null,
    ocrModel: PRIMARY_MODEL,
  };
}
