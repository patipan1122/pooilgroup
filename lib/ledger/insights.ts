// LedgerLine — AI business-insights generator.
//
// Opt-in / triggered ONLY (no auto-cron) per [[ceo-prefers-manual-ai-triggers]]:
// the accountant/CEO clicks "วิเคราะห์ด้วย AI" on the dashboard → this runs.
//
// Two layers:
//   1. DETERMINISTIC bullets computed from the dashboard snapshot (anomaly,
//      VAT-due reminder, top categories, MoM trend). These are FREE, always
//      returned, and never wrong — they read the real aggregates.
//   2. An OPTIONAL LLM narrative summary on top (gemini-2.0-flash-lite via the
//      cost-cap budget guard). If budget is exhausted or the key is missing we
//      still return the deterministic bullets — AI is additive, never blocking.
//
// Reuses lib/ledger/dashboard for ALL numbers (no Prisma here) and lib/ai/cost-cap
// for the budget guard, same as ai-parse.ts.

import { checkAiBudget, recordAiUsage } from "@/lib/ai/cost-cap";
import {
  dashboardSnapshot,
  spendByCategory,
  shiftPeriod,
  currentPeriodBangkok,
  type DashboardScope,
  type DashboardSnapshot,
  type CategorySpend,
} from "./dashboard";

const INSIGHT_MODEL = "gemini-2.0-flash-lite";
const EST_INPUT_TOKENS = 700;
const EST_OUTPUT_TOKENS = 350;

/** Above this MoM jump on a single category we flag it as an anomaly. */
const ANOMALY_MOM_PCT = 40;
/** A category must be at least this many baht to bother flagging its spike. */
const ANOMALY_MIN_BAHT = 1000;

export type InsightLevel = "info" | "warn" | "alert";

export interface Insight {
  level: InsightLevel;
  /** stable key so the UI can icon/sort (anomaly|budget|vat|trend|top|draft). */
  kind: string;
  text: string;
}

export interface InsightsResult {
  period: string;
  /** Deterministic bullets — always present. */
  bullets: Insight[];
  /** Optional LLM narrative (Thai prose). null when AI was skipped/over-budget. */
  summary: string | null;
  /** Why summary is null, for the UI ("เกิน budget AI" / "ไม่ได้เปิด AI"). */
  aiNote: string | null;
}

const baht = (n: number) =>
  n.toLocaleString("th-TH", { maximumFractionDigits: 0 });

// ---------------------------------------------------------------------------
// Deterministic bullets (the truth layer)
// ---------------------------------------------------------------------------

function buildBullets(
  snap: DashboardSnapshot,
  prevByCategory: CategorySpend[],
): Insight[] {
  const out: Insight[] = [];

  // 1. Headline + MoM trend.
  if (snap.totals.count === 0) {
    out.push({
      level: "info",
      kind: "top",
      text: `เดือน ${snap.period} ยังไม่มีรายจ่ายที่ยืนยันแล้ว`,
    });
  } else {
    out.push({
      level: "info",
      kind: "top",
      text: `เดือน ${snap.period} ยืนยันรายจ่ายแล้ว ${baht(snap.totals.total)} บาท (${snap.totals.count} รายการ)`,
    });
    if (snap.momPct != null) {
      const dir = snap.momPct >= 0 ? "เพิ่มขึ้น" : "ลดลง";
      const lvl: InsightLevel = snap.momPct >= 25 ? "warn" : "info";
      out.push({
        level: lvl,
        kind: "trend",
        text: `รายจ่ายรวม${dir} ${Math.abs(snap.momPct).toFixed(0)}% จากเดือนก่อน (${baht(snap.prevTotal)} → ${baht(snap.totals.total)} บาท)`,
      });
    }
  }

  // 2a. Per-category MoM anomaly ("ค่า X สูงผิดปกติ +N%"). Compare each
  //     category's spend to the SAME category last month; flag big jumps on
  //     amounts large enough to matter.
  const prevByCat = new Map(
    prevByCategory.filter((c) => c.categoryId).map((c) => [c.categoryId!, c.total]),
  );
  for (const c of snap.byCategory) {
    if (!c.categoryId || c.total < ANOMALY_MIN_BAHT) continue;
    const prev = prevByCat.get(c.categoryId) ?? 0;
    if (prev <= 0) continue; // brand-new category isn't an "anomaly", just new
    const jumpPct = ((c.total - prev) / prev) * 100;
    if (jumpPct >= ANOMALY_MOM_PCT) {
      out.push({
        level: jumpPct >= 100 ? "alert" : "warn",
        kind: "anomaly",
        text: `ค่า "${c.categoryName ?? "ไม่ระบุ"}" สูงผิดปกติ +${jumpPct.toFixed(0)}% (${baht(prev)} → ${baht(c.total)} บาท) เทียบเดือนก่อน`,
      });
    }
  }

  // 2b. Concentration anomaly — when ONE category dominates the month's spend
  //     ("หมวด X กระจุกตัวสูง"). Catches the "one big unexpected bill" case even
  //     when there's no prior month to compare against.
  const topCat = snap.byCategory[0];
  if (topCat && snap.totals.total > 0) {
    const share = (topCat.total / snap.totals.total) * 100;
    if (share >= 60 && topCat.total >= ANOMALY_MIN_BAHT) {
      out.push({
        level: "warn",
        kind: "anomaly",
        text: `หมวด "${topCat.categoryName ?? "ไม่ระบุ"}" คิดเป็น ${share.toFixed(0)}% ของรายจ่ายทั้งหมด (${baht(topCat.total)} บาท) — กระจุกตัวสูง ควรตรวจ`,
      });
    }
  }

  // 3. Budget alerts (over alert-pct / over budget).
  for (const b of snap.budgets) {
    if (b.overBudget) {
      out.push({
        level: "alert",
        kind: "budget",
        text: `หมวด "${b.categoryName ?? "ไม่ระบุ"}" ใช้เกินงบ: ${baht(b.actual)} / งบ ${baht(b.budget)} บาท (${b.usedPct.toFixed(0)}%)`,
      });
    } else if (b.overAlert) {
      out.push({
        level: "warn",
        kind: "budget",
        text: `หมวด "${b.categoryName ?? "ไม่ระบุ"}" ใช้งบใกล้เต็ม: ${b.usedPct.toFixed(0)}% (${baht(b.actual)} / ${baht(b.budget)} บาท)`,
      });
    }
  }

  // 4. Top categories (give a quick read even when nothing is wrong).
  const top3 = snap.byCategory.slice(0, 3).filter((c) => c.total > 0);
  if (top3.length > 0) {
    out.push({
      level: "info",
      kind: "top",
      text:
        "หมวดที่ใช้มากสุด: " +
        top3
          .map((c) => `${c.categoryName ?? "ไม่ระบุ"} ${baht(c.total)} บาท`)
          .join(" · "),
    });
  }

  // 5. VAT-due reminder — PP30 (VAT return) is due ~15th of the NEXT month.
  if (snap.totals.vat > 0) {
    const due = vatDueDate(snap.period);
    out.push({
      level: "info",
      kind: "vat",
      text: `VAT ซื้อเดือนนี้รวม ${baht(snap.totals.vat)} บาท — เตรียมยื่น ภ.พ.30 ภายใน ${due}`,
    });
  }

  // 6. Drafts still waiting (gentle nudge — these aren't counted as spend yet).
  if (snap.totals.draftCount > 0) {
    out.push({
      level: "warn",
      kind: "draft",
      text: `มีร่างที่ยังไม่ยืนยัน ${snap.totals.draftCount} รายการ (~${baht(snap.totals.draftTotal)} บาท) — ยังไม่นับเป็นรายจ่าย จนกว่าบัญชีจะยืนยัน`,
    });
  }

  return out;
}

/** PP30 (VAT return) deadline = 15th of the month AFTER the spend month. */
function vatDueDate(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 15)); // m (0-based +1) day 15 = next month 15th
  const thMonths = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  return `15 ${thMonths[next.getUTCMonth()]} ${next.getUTCFullYear() + 543}`;
}

// ---------------------------------------------------------------------------
// Optional LLM narrative
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `คุณเป็นนักวิเคราะห์การเงินของ SME ไทย ช่วยเจ้าของธุรกิจอ่านรายจ่ายของบริษัท
- เขียนเป็นภาษาไทย กระชับ เป็นภาษาธุรกิจ (ห้ามศัพท์เทคนิค/บัญชีลึก)
- 3-5 ประโยค สรุปภาพรวมรายจ่าย + จุดที่ควรระวัง + ข้อเสนอแนะ 1 ข้อ
- ใช้เฉพาะตัวเลขที่ให้มา ห้ามเดาตัวเลขใหม่
- ถ้าข้อมูลน้อย/ไม่มี ให้บอกตรง ๆ ว่ายังมีข้อมูลไม่พอวิเคราะห์`;

function snapshotToPromptText(snap: DashboardSnapshot, bullets: Insight[]): string {
  const lines: string[] = [];
  lines.push(`งวด: ${snap.period}`);
  lines.push(`รายจ่ายที่ยืนยันแล้วรวม: ${baht(snap.totals.total)} บาท (${snap.totals.count} รายการ)`);
  if (snap.momPct != null) {
    lines.push(`เทียบเดือนก่อน (${snap.prevPeriod}): ${baht(snap.prevTotal)} บาท → ${snap.momPct >= 0 ? "+" : ""}${snap.momPct.toFixed(0)}%`);
  }
  if (snap.byCategory.length) {
    lines.push("รายจ่ายตามหมวด:");
    for (const c of snap.byCategory.slice(0, 8)) {
      lines.push(`  - ${c.categoryName ?? "ไม่ระบุ"}: ${baht(c.total)} บาท (${c.count} รายการ)`);
    }
  }
  if (snap.byBranch.length > 1) {
    lines.push("รายจ่ายตามสาขา:");
    for (const b of snap.byBranch.slice(0, 6)) {
      lines.push(`  - ${b.branchName ?? "ไม่ระบุสาขา"}: ${baht(b.total)} บาท`);
    }
  }
  if (snap.budgets.length) {
    lines.push("งบ vs จริง:");
    for (const b of snap.budgets) {
      lines.push(`  - ${b.categoryName ?? "ไม่ระบุ"}: ใช้ ${baht(b.actual)} / งบ ${baht(b.budget)} บาท (${b.usedPct.toFixed(0)}%)`);
    }
  }
  if (bullets.length) {
    lines.push("ประเด็นที่ระบบตรวจพบ:");
    for (const b of bullets) lines.push(`  - ${b.text}`);
  }
  return lines.join("\n");
}

async function llmNarrative(
  promptText: string,
  userId: string | null,
  orgId: string,
): Promise<{ summary: string | null; note: string | null }> {
  const budget = await checkAiBudget({
    userId,
    orgId,
    endpoint: "ledger.insights",
  });
  if (!budget.allowed) {
    return { summary: null, note: budget.reason ?? "เกิน budget AI" };
  }
  if (!process.env.GEMINI_API_KEY) {
    return { summary: null, note: "ยังไม่ได้ตั้งค่า AI (GEMINI_API_KEY)" };
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: INSIGHT_MODEL,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.4,
        maxOutputTokens: 500,
      },
    });
    const summary = (result.text ?? "").trim() || null;

    await recordAiUsage({
      userId,
      orgId,
      endpoint: "ledger.insights",
      provider: "gemini-flash",
      model: INSIGHT_MODEL,
      moduleName: "ledger",
      inputTokens: EST_INPUT_TOKENS,
      outputTokens: EST_OUTPUT_TOKENS,
    });

    return { summary, note: summary ? null : "AI ไม่ได้คืนคำตอบ" };
  } catch (err) {
    console.error("[ledger:insights] llm failed", err);
    return { summary: null, note: "วิเคราะห์ด้วย AI ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export interface GenerateInsightsOptions extends DashboardScope {
  /** Caller's user id (for the AI budget cap) — null for system/no-session. */
  userId?: string | null;
  /** When false, skip the LLM and return only deterministic bullets (free). */
  useAi?: boolean;
}

/**
 * Generate business insights for a company/period. Triggered (no cron).
 * Always returns deterministic bullets; the LLM narrative is best-effort.
 */
export async function generateInsights(
  opts: GenerateInsightsOptions,
): Promise<InsightsResult> {
  const period = opts.period ?? currentPeriodBangkok();
  const prevPeriod = shiftPeriod(period, -1);
  const scope: DashboardScope = {
    orgId: opts.orgId,
    companyId: opts.companyId,
    branchId: opts.branchId ?? null,
  };
  const [snap, prevByCategory] = await Promise.all([
    dashboardSnapshot({ ...scope, period }),
    spendByCategory({ ...scope, period: prevPeriod }),
  ]);
  const bullets = buildBullets(snap, prevByCategory);

  if (opts.useAi === false) {
    return { period, bullets, summary: null, aiNote: "ไม่ได้เปิดวิเคราะห์ AI" };
  }

  const { summary, note } = await llmNarrative(
    snapshotToPromptText(snap, bullets),
    opts.userId ?? null,
    opts.orgId,
  );

  return { period, bullets, summary, aiNote: note };
}
