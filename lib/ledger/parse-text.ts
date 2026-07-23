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
import { normalizePurchaseType, type PurchaseType, type ExpenseItem } from "./types";

const MODEL = "gemini-2.0-flash-lite";
const EST_INPUT_TOKENS = 260;
const EST_OUTPUT_TOKENS = 120;

export interface ParsedTextExpense {
  total: number | null;
  vendor: string | null;
  paymentMethod: string | null;
  suggestedCategory: string | null;
  purchaseType: PurchaseType | null;
  docDate: string | null; // YYYY-MM-DD
  note: string | null;
  /** รายการสินค้าในบิลเดียว — "จด น้ำดื่ม 10, ข้าวไข่ดาว 50" → 2 รายการ (total = ผลรวม). */
  items: ExpenseItem[];
  confidence: Record<string, number>;
}

interface RawItem {
  name?: string | null;
  qty?: number | null;
  amount?: number | null;
}
interface RawText {
  items?: RawItem[] | null;
  total?: number | null;
  vendor?: string | null;
  payment_method?: string | null;
  suggested_category?: string | null;
  purchase_type?: string | null;
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

ผู้ใช้พิมพ์โน้ตค่าใช้จ่ายสั้น ๆ — อาจมี "หลายรายการ" คั่นด้วย , หรือขึ้นบรรทัดใหม่ ดึงเป็น JSON เท่านั้น (ห้ามคำอธิบาย ห้าม markdown):
{
  "items": [
    { "name": "<ชื่อสินค้า/สิ่งที่ซื้อ เช่น น้ำดื่ม, ข้าวไข่ดาว, ค่าแท็กซี่>", "qty": <จำนวนชิ้น number · ไม่ระบุ=1>, "amount": <ราคารวมของรายการนี้ number ไม่มีคอมม่า/฿> }
  ],
  "vendor": "<ชื่อร้าน ถ้าระบุชัด · ไม่มี=null>",
  "payment_method": "<cash | transfer | qr | credit_card หรือ null>",
  "suggested_category": "<เดาหมวดรวมของบิล ต้องใช้ชื่อให้ตรง 1 ในผังนี้เป๊ะ ๆ: เงินเดือน/ค่าแรง, ค่าคอมมิชชั่น/นายหน้า, สินค้าเพื่อขายแบบมีสต๊อก, ค่าวัตถุดิบ/สินค้า (ไม่สต๊อก), งานก่อสร้าง/รีโนเวท (เหมารวม), ค่าซ่อมบำรุงรักษา, ค่าจ้าง/บริการทั่วไป, ค่าวิชาชีพ/บัญชี/ที่ปรึกษา, ค่าโฆษณา/การตลาด, ค่ารับรอง, ค่าประกันภัย, ค่าไฟฟ้า, ค่าน้ำประปา, ค่าโทรศัพท์/อินเทอร์เน็ต, วัสดุ/อุปกรณ์สำนักงาน, ค่าเช่าสำนักงาน, ค่าเช่ายานพาหนะ, ค่าน้ำมันยานพาหนะ, ค่าเดินทาง, ค่าธรรมเนียมธนาคาร, ภาษีป้าย, ค่าใช้จ่ายเบ็ดเตล็ด หรือ null>",
  "purchase_type": "<goods (ซื้อของ/สินค้า) | service (ค่าบริการ/ค่าจ้าง/ค่าเช่า) | construction (วัสดุก่อสร้าง/ต่อเติม) หรือ null>",
  "doc_date": "<YYYY-MM-DD แปลงจากคำเช่น 'เมื่อวาน'='${today} ลบ 1 วัน', 'วันนี้'='${today}'; ไม่ระบุ=null>",
  "note": "<ข้อความเดิมที่เหลือ หรือ null>",
  "confidence": { "total": <0..1>, "vendor": <0..1>, "category": <0..1> }
}
กฎ:
- แยกทุกรายการที่คั่นด้วย , หรือขึ้นบรรทัดใหม่ เป็น items แยกกัน (เช่น "น้ำดื่ม 10, ข้าวไข่ดาว 50" = 2 รายการ)
- ราคาเป็น number ตรง ๆ · อ่านราคาของรายการไหนไม่ออก→ข้ามรายการนั้น (ห้ามเดาราคา)
- ถ้าไม่มีรายการที่มีราคาชัดเจนเลย → "items": []
- รายการเดียวก็ใส่ใน items 1 ตัว`;
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

  // แต่ละรายการต้องมีราคา (amount) — ตัดรายการที่อ่านราคาไม่ออกทิ้ง (ไม่เดา)
  let items: ExpenseItem[] = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((it): ExpenseItem | null => {
      const amount = numOrNull(it?.amount);
      if (amount == null) return null;
      const rawQty = numOrNull(it?.qty);
      const qty = rawQty && rawQty > 0 ? rawQty : 1;
      const name = (it?.name ?? "").trim() || "รายการ";
      return { description: name, qty, unitPrice: amount / qty, amount, vatRate: null };
    })
    .filter((x): x is ExpenseItem => x !== null);

  // Fallback: โมเดลตอบแบบเดิม (total เดี่ยว ไม่มี items) → ทำเป็น 1 รายการ
  const legacyTotal = numOrNull(parsed.total);
  if (items.length === 0 && legacyTotal != null) {
    items = [{ description: parsed.vendor?.trim() || "รายการ", qty: 1, unitPrice: legacyTotal, amount: legacyTotal, vatRate: null }];
  }

  // total = ผลรวมของรายการที่มีราคา · ไม่มีเลย = null (webhook จะเตือนให้ใส่ยอด)
  const total = items.length > 0 ? items.reduce((s, it) => s + it.amount, 0) : null;

  return {
    total,
    vendor: parsed.vendor?.trim() || null,
    paymentMethod: parsed.payment_method?.trim() || null,
    suggestedCategory: parsed.suggested_category?.trim() || null,
    purchaseType: normalizePurchaseType(parsed.purchase_type),
    docDate: parsed.doc_date ?? null,
    note: parsed.note?.trim() || null,
    items,
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
