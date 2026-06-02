"use server";

// Ledger AI server actions — thin wrappers over the canonical Partition B layer.
//
// Two CEO-facing AI features off the dashboard:
//   1) generateInsights() — "AI วิเคราะห์ธุรกิจ": deterministic Thai bullets
//      (anomaly / budget risk / VAT-due / top categories / MoM) + an optional
//      LLM narrative on top → lib/ledger/insights.generateInsights().
//   2) askLedgerQa()      — "ถาม AI": conversational Q&A (keyword routing first,
//      light LLM intent fallback) → lib/ledger/qa.answerQuestion().
//
// Both are READ-ONLY (no posting/mutation), org+company scoped, module/role
// gated, and reuse the existing budget guard (lib/ai/cost-cap) inside the
// Partition B layer. These actions only do auth + scope + shape the result for
// the UI (signatures are STABLE — InsightsPanel/QaBox depend on them).

import { requireSession, type DbUser } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { audit } from "@/lib/audit/log";
import { prisma } from "@/lib/prisma";
import { generateInsights as generateInsightsCore } from "@/lib/ledger/insights";
import { answerQuestion } from "@/lib/ledger/qa";
import type { Insight } from "@/lib/ledger/insights";

export type InsightsResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type QaResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

// CEO/accountant-tier only — the dashboard shows org-wide P&L which front-line
// roles must not see (matches dashboard page requireRole + nav policy).
function canViewDashboard(role: DbUser["role"]): boolean {
  return isAdminTier(role) || role === "area_manager" || role === "viewer";
}

/** Resolve session + module entitlement (server actions bypass the layout gate). */
async function gate(): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>> }
  | { ok: false; error: string }
> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!canViewDashboard(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์ดูรายงานนี้" };
  }
  if (!isAdminTier(session.user.role)) {
    const has = await userHasModuleAccess(session.user, "ledger");
    if (!has) return { ok: false, error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
  }
  return { ok: true, session };
}

/** Confirm the company belongs to the caller's org (defence in depth). */
async function assertCompanyInOrg(orgId: string, companyId: string): Promise<boolean> {
  const c = await prisma.company.findFirst({
    where: { id: companyId, orgId },
    select: { id: true },
  });
  return !!c;
}

/** Render the structured insights (bullets + optional summary) into Thai text
 *  for the existing InsightsPanel, which expects a single `text` string. */
function renderInsights(bullets: Insight[], summary: string | null): string {
  const icon = (lvl: Insight["level"]) =>
    lvl === "alert" ? "🔴" : lvl === "warn" ? "🟡" : "•";
  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (bullets.length) {
    parts.push(bullets.map((b) => `${icon(b.level)} ${b.text}`).join("\n"));
  }
  return parts.join("\n\n").trim() || "ยังมีข้อมูลไม่พอวิเคราะห์ในงวดนี้";
}

/** "AI วิเคราะห์ธุรกิจ" — generate a Thai business read of the period. */
export async function generateInsights(input: {
  companyId: string;
  branchId?: string | null;
  period: string;
}): Promise<InsightsResult> {
  const g = await gate();
  if (!g.ok) return g;
  const { session } = g;
  const orgId = session.user.org_id;

  if (!/^\d{4}-\d{2}$/.test(input.period)) {
    return { ok: false, error: "งวดไม่ถูกต้อง" };
  }
  if (!(await assertCompanyInOrg(orgId, input.companyId))) {
    return { ok: false, error: "ไม่พบบริษัท" };
  }

  try {
    // Budget guard + AI usage logging live inside generateInsightsCore.
    const res = await generateInsightsCore({
      orgId,
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      period: input.period,
      userId: session.user.id,
      useAi: true,
    });

    await audit({
      orgId,
      userId: session.user.id,
      action: "LEDGER_EXPENSE_UPDATED",
      resourceType: "ledger_insights",
      diff: { new: { period: input.period, companyId: input.companyId } },
    });

    return { ok: true, text: renderInsights(res.bullets, res.summary) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "สร้างบทวิเคราะห์ไม่สำเร็จ",
    };
  }
}

/** "ถาม AI" — conversational Q&A over the period aggregates. */
export async function askLedgerQa(input: {
  companyId: string;
  branchId?: string | null;
  period: string;
  question: string;
}): Promise<QaResult> {
  const g = await gate();
  if (!g.ok) return g;
  const { session } = g;
  const orgId = session.user.org_id;

  const question = (input.question ?? "").trim();
  if (question.length < 2) return { ok: false, error: "พิมพ์คำถามก่อน" };
  if (question.length > 500) return { ok: false, error: "คำถามยาวเกินไป" };
  if (!/^\d{4}-\d{2}$/.test(input.period)) {
    return { ok: false, error: "งวดไม่ถูกต้อง" };
  }
  if (!(await assertCompanyInOrg(orgId, input.companyId))) {
    return { ok: false, error: "ไม่พบบริษัท" };
  }

  try {
    // Budget guard + AI usage logging live inside answerQuestion (LLM fallback).
    const res = await answerQuestion(question, {
      orgId,
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      period: input.period,
      userId: session.user.id,
      allowAi: true,
    });
    return { ok: true, answer: res.answer };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "ตอบคำถามไม่สำเร็จ",
    };
  }
}
