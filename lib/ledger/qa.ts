// LedgerLine — conversational Q&A (Thai) for the LINE group + web.
//
// "สรุปค่าใช้จ่ายวันนี้/เดือนนี้", "หมวดไหนเยอะสุด", "มีอะไรบ้าง", "งบเหลือเท่าไหร่"
// → parse intent → run the matching dashboard query → return a Thai text answer.
//
// CHEAP-FIRST: a deterministic keyword router handles the common questions with
// ZERO AI cost (so the LINE bot is free to chat). Only when keyword routing is
// unsure do we fall back to a light LLM intent-parse (gemini-2.0-flash-lite via
// the cost-cap budget guard) that maps the question to one of our known intents
// — we still answer from real DB numbers, never let the LLM invent figures.
//
// Reuses lib/ledger/dashboard for ALL numbers + lib/ai/cost-cap for the guard.

import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import {
  spendTotals,
  spendByCategory,
  spendByBranch,
  budgetVsActual,
  currentPeriodBangkok,
  todayBangkok,
  type DashboardScope,
} from "./dashboard";
import { prisma } from "@/lib/prisma";

const INTENT_MODEL = "gemini-2.0-flash-lite";
const EST_INPUT_TOKENS = 250;
const EST_OUTPUT_TOKENS = 30;

const baht = (n: number) =>
  n.toLocaleString("th-TH", { maximumFractionDigits: 0 });

/** Intents the router/LLM can resolve to. */
export type QaIntent =
  | "today" // สรุปวันนี้
  | "month" // สรุปเดือนนี้
  | "top_category" // หมวดไหนเยอะสุด
  | "by_category" // แจกแจงตามหมวด / มีอะไรบ้าง
  | "by_branch" // แต่ละสาขาเท่าไหร่
  | "budget" // งบเหลือเท่าไหร่ / เกินงบไหม
  | "vat" // VAT เท่าไหร่
  | "help" // ช่วยอะไรได้บ้าง
  | "unknown";

export interface QaResult {
  intent: QaIntent;
  answer: string;
  /** true when an LLM call was used to classify (for logging/cost visibility). */
  usedAi: boolean;
}

export interface QaScope extends DashboardScope {
  /** Caller's user id for the AI budget cap — null for LINE/system. */
  userId?: string | null;
  /** When false, never call the LLM (keyword-only — used by the free LINE bot
   *  unless we explicitly enable AI fallback). Default true. */
  allowAi?: boolean;
}

// ---------------------------------------------------------------------------
// Keyword router (free)
// ---------------------------------------------------------------------------

function routeKeyword(q: string): QaIntent {
  const s = q.toLowerCase().trim();

  // help / capability
  if (/(ช่วย|ทำอะไรได้|ถามอะไร|คำสั่ง|help|เมนู)/.test(s)) return "help";

  // VAT
  if (/(vat|ภาษีมูลค่าเพิ่ม|ภพ\.?30|ภ\.?พ\.?30)/.test(s)) return "vat";

  // budget
  if (/(งบ|budget|เกินงบ|เหลืองบ|งบเหลือ)/.test(s)) return "budget";

  // branch
  if (/(สาขา|แต่ละสาขา|ราย ?สาขา|branch)/.test(s)) return "by_branch";

  // top category
  if (/(เยอะสุด|มากสุด|สูงสุด|หมวดไหน|อันดับ|top)/.test(s)) return "top_category";

  // breakdown by category / "มีอะไรบ้าง"
  if (/(แต่ละหมวด|ตามหมวด|แจกแจง|มีอะไรบ้าง|รายการ|breakdown|หมวด)/.test(s))
    return "by_category";

  // today
  if (/(วันนี้|today|วันนี)/.test(s)) return "today";

  // month / "สรุปค่าใช้จ่าย"
  if (/(เดือนนี้|เดือน|month|สรุป|ค่าใช้จ่าย|รายจ่าย|ใช้ไปเท่าไหร่|ทั้งหมด)/.test(s))
    return "month";

  return "unknown";
}

// ---------------------------------------------------------------------------
// Light LLM intent-parse (fallback only)
// ---------------------------------------------------------------------------

const INTENT_SYSTEM = `จัดประเภทคำถามภาษาไทยเกี่ยวกับรายจ่ายบริษัท ให้ตอบเป็นคำเดียวจากรายการนี้เท่านั้น:
today | month | top_category | by_category | by_branch | budget | vat | help | unknown
- today = ถามยอดวันนี้
- month = ถามสรุป/ยอดรวมเดือนนี้
- top_category = ถามว่าหมวดไหนใช้เยอะสุด
- by_category = ขอแจกแจงตามหมวด / ถามว่ามีรายจ่ายอะไรบ้าง
- by_branch = ขอแยกตามสาขา
- budget = ถามเรื่องงบประมาณ/เกินงบ/งบเหลือ
- vat = ถามภาษีมูลค่าเพิ่ม
- help = ถามว่าระบบช่วยอะไรได้
ตอบเป็นคำเดียว ห้ามมีอย่างอื่น`;

const VALID_INTENTS: QaIntent[] = [
  "today", "month", "top_category", "by_category",
  "by_branch", "budget", "vat", "help", "unknown",
];

async function llmIntent(
  q: string,
  userId: string | null,
  orgId: string,
): Promise<{ intent: QaIntent; used: boolean }> {
  const budget = await checkAiBudget({ userId, orgId, endpoint: "ledger.qa-intent" });
  if (!budget.allowed || !process.env.GEMINI_API_KEY) {
    return { intent: "unknown", used: false };
  }
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: INTENT_MODEL,
      contents: [{ role: "user", parts: [{ text: q }] }],
      config: {
        systemInstruction: INTENT_SYSTEM,
        temperature: 0,
        maxOutputTokens: 8,
      },
    });
    await recordAiUsage({
      userId,
      orgId,
      endpoint: "ledger.qa-intent",
      provider: "gemini-flash",
      model: INTENT_MODEL,
      moduleName: "ledger",
      inputTokens: EST_INPUT_TOKENS,
      outputTokens: EST_OUTPUT_TOKENS,
    });
    const raw = (result.text ?? "").trim().toLowerCase();
    const match = VALID_INTENTS.find((i) => raw.includes(i));
    return { intent: match ?? "unknown", used: true };
  } catch (err) {
    console.error("[ledger:qa] intent llm failed", err);
    return { intent: "unknown", used: false };
  }
}

// ---------------------------------------------------------------------------
// Answer builders (read real DB numbers)
// ---------------------------------------------------------------------------

/** Spend confirmed on a specific Bangkok day (doc_date = that day). */
async function answerToday(scope: DashboardScope): Promise<string> {
  const day = todayBangkok();
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(Date.UTC(y, m - 1, d + 1));
  const agg = await prisma.ledgerExpense.aggregate({
    where: {
      orgId: scope.orgId,
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      status: { in: ["confirmed", "locked"] },
      docDate: { gte: start, lt: end },
    },
    _sum: { total: true },
    _count: { _all: true },
  });
  const total =
    agg._sum.total == null
      ? 0
      : typeof agg._sum.total === "number"
        ? agg._sum.total
        : agg._sum.total.toNumber();
  if (agg._count._all === 0) return `วันนี้ (${day}) ยังไม่มีรายจ่ายที่ยืนยันแล้ว`;
  return `วันนี้ (${day}) ยืนยันรายจ่าย ${baht(total)} บาท จาก ${agg._count._all} รายการ`;
}

async function answerMonth(scope: DashboardScope): Promise<string> {
  const period = scope.period ?? currentPeriodBangkok();
  const t = await spendTotals({ ...scope, period });
  if (t.count === 0) {
    const tail =
      t.draftCount > 0
        ? ` (มีร่างรอยืนยัน ${t.draftCount} รายการ ~${baht(t.draftTotal)} บาท)`
        : "";
    return `เดือน ${period} ยังไม่มีรายจ่ายที่ยืนยันแล้ว${tail}`;
  }
  let ans = `เดือน ${period} ยืนยันรายจ่ายแล้ว ${baht(t.total)} บาท จาก ${t.count} รายการ (VAT ${baht(t.vat)} บาท)`;
  if (t.draftCount > 0) {
    ans += `\nมีร่างรอยืนยันอีก ${t.draftCount} รายการ ~${baht(t.draftTotal)} บาท`;
  }
  return ans;
}

async function answerTopCategory(scope: DashboardScope): Promise<string> {
  const period = scope.period ?? currentPeriodBangkok();
  const cats = await spendByCategory({ ...scope, period });
  const top = cats[0];
  if (!top || top.total === 0) return `เดือน ${period} ยังไม่มีรายจ่ายให้จัดอันดับ`;
  return `เดือน ${period} หมวดที่ใช้มากสุดคือ "${top.categoryName ?? "ไม่ระบุ"}" ${baht(top.total)} บาท (${top.count} รายการ)`;
}

async function answerByCategory(scope: DashboardScope): Promise<string> {
  const period = scope.period ?? currentPeriodBangkok();
  const cats = (await spendByCategory({ ...scope, period })).filter((c) => c.total > 0);
  if (cats.length === 0) return `เดือน ${period} ยังไม่มีรายจ่ายตามหมวด`;
  const lines = cats
    .slice(0, 8)
    .map((c, i) => `${i + 1}. ${c.categoryName ?? "ไม่ระบุ"} — ${baht(c.total)} บาท`);
  return `รายจ่ายเดือน ${period} ตามหมวด:\n${lines.join("\n")}`;
}

async function answerByBranch(scope: DashboardScope): Promise<string> {
  const period = scope.period ?? currentPeriodBangkok();
  const branches = (await spendByBranch({ ...scope, period })).filter((b) => b.total > 0);
  if (branches.length === 0) return `เดือน ${period} ยังไม่มีรายจ่ายแยกตามสาขา`;
  const lines = branches
    .slice(0, 10)
    .map((b, i) => `${i + 1}. ${b.branchName ?? "ไม่ระบุสาขา"} — ${baht(b.total)} บาท`);
  return `รายจ่ายเดือน ${period} ตามสาขา:\n${lines.join("\n")}`;
}

async function answerBudget(scope: DashboardScope): Promise<string> {
  const period = scope.period ?? currentPeriodBangkok();
  const rows = await budgetVsActual({ ...scope, period });
  if (rows.length === 0) return `ยังไม่ได้ตั้งงบประมาณสำหรับเดือน ${period}`;
  const lines = rows.map((b) => {
    const remain = b.budget - b.actual;
    const flag = b.overBudget ? " ⚠️เกินงบ" : b.overAlert ? " ⚠️ใกล้เต็ม" : "";
    return `- ${b.categoryName ?? "ไม่ระบุ"}: ใช้ ${baht(b.actual)} / งบ ${baht(b.budget)} บาท (${b.usedPct.toFixed(0)}%) เหลือ ${baht(remain)}${flag}`;
  });
  return `งบประมาณเดือน ${period}:\n${lines.join("\n")}`;
}

async function answerVat(scope: DashboardScope): Promise<string> {
  const period = scope.period ?? currentPeriodBangkok();
  const t = await spendTotals({ ...scope, period });
  if (t.vat === 0) return `เดือน ${period} ยังไม่มี VAT ซื้อที่ยืนยันแล้ว`;
  return `VAT ซื้อเดือน ${period} ที่ยืนยันแล้วรวม ${baht(t.vat)} บาท (จากรายจ่าย ${baht(t.total)} บาท) — ใช้เตรียมยื่น ภ.พ.30`;
}

function answerHelp(): string {
  return [
    "ถามได้เลย เช่น:",
    "• สรุปค่าใช้จ่ายวันนี้",
    "• สรุปเดือนนี้",
    "• หมวดไหนใช้เยอะสุด",
    "• แจกแจงตามหมวด / ตามสาขา",
    "• งบเหลือเท่าไหร่",
    "• VAT เดือนนี้เท่าไหร่",
  ].join("\n");
}

async function runIntent(intent: QaIntent, scope: DashboardScope): Promise<string> {
  switch (intent) {
    case "today":
      return answerToday(scope);
    case "month":
      return answerMonth(scope);
    case "top_category":
      return answerTopCategory(scope);
    case "by_category":
      return answerByCategory(scope);
    case "by_branch":
      return answerByBranch(scope);
    case "budget":
      return answerBudget(scope);
    case "vat":
      return answerVat(scope);
    case "help":
      return answerHelp();
    case "unknown":
    default:
      return (
        "ขอโทษ ยังไม่เข้าใจคำถามนี้ครับ\n" + answerHelp()
      );
  }
}

/**
 * Answer a Thai question about this company's expenses.
 *
 * Flow: keyword router (free) → if unknown AND allowAi, light LLM intent-parse
 * (budget-guarded) → run the matching dashboard query → Thai answer. Numbers
 * always come from the DB; the LLM only ever picks an intent.
 */
export async function answerQuestion(
  question: string,
  scope: QaScope,
): Promise<QaResult> {
  const q = (question ?? "").trim();
  if (!q) {
    return { intent: "help", answer: answerHelp(), usedAi: false };
  }

  let intent = routeKeyword(q);
  let usedAi = false;

  if (intent === "unknown" && scope.allowAi !== false) {
    const r = await llmIntent(q, scope.userId ?? null, scope.orgId);
    intent = r.intent;
    usedAi = r.used;
  }

  const answer = await runIntent(intent, {
    orgId: scope.orgId,
    companyId: scope.companyId,
    branchId: scope.branchId ?? null,
    period: scope.period ?? null,
  });

  return { intent, answer, usedAi };
}
