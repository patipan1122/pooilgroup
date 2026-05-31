// AI cost cap — track usage per user × org and reject when over budget.
// Backed by ai_usage table (migration 004).
//
// Usage:
//   const ok = await checkAiBudget({ userId, orgId, endpoint });
//   if (!ok.allowed) return 429;
//   ... call AI ...
//   await recordAiUsage({ userId, orgId, endpoint, inputTokens, outputTokens });

import { adminClient } from "@/lib/db/server";

// Pricing reference (USD per 1M tokens) — เก็บเป็น const กลาง อ่านง่าย
// Gemini Flash 2.5: $0.075/M input · $0.30/M output (above free tier 1500/day)
// Set actual rates so budget cap kicks in if free quota exhausted
const PRICING = {
  "claude-haiku-input": 1.0 / 1_000_000,
  "claude-haiku-output": 5.0 / 1_000_000,
  "gemini-flash-input": 0.075 / 1_000_000,
  "gemini-flash-output": 0.30 / 1_000_000,
};

// Budget caps (USD)
const PER_USER_HOURLY_CALLS = 30;        // ป้องกัน loop attack
const PER_USER_DAILY_USD = 5.0;          // safety net
const PER_ORG_MONTHLY_USD = 200.0;       // org-level circuit breaker

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remainingHourlyCalls?: number;
  remainingDailyUsd?: number;
  remainingMonthlyOrgUsd?: number;
}

export async function checkAiBudget(opts: {
  userId: string;
  orgId: string;
  endpoint: string;
}): Promise<BudgetCheckResult> {
  const { userId, orgId } = opts;
  const admin = adminClient();
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  // 1. Per-user hourly call cap
  const { count: hourlyCalls } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);
  if ((hourlyCalls ?? 0) >= PER_USER_HOURLY_CALLS) {
    return {
      allowed: false,
      reason: `เรียก AI เกิน ${PER_USER_HOURLY_CALLS} ครั้ง/ชม. — รอ 1 ชั่วโมง`,
      remainingHourlyCalls: 0,
    };
  }

  // 2. Per-user daily $ cap
  const { data: dailyRows } = await admin
    .from("ai_usage")
    .select("cost_usd")
    .eq("user_id", userId)
    .gte("created_at", oneDayAgo);
  const dailyUsd = (dailyRows ?? []).reduce(
    (s, r) => s + Number(r.cost_usd ?? 0),
    0,
  );
  if (dailyUsd >= PER_USER_DAILY_USD) {
    return {
      allowed: false,
      reason: `เกิน budget ส่วนตัว $${PER_USER_DAILY_USD}/วัน — รอ 24 ชั่วโมง`,
      remainingDailyUsd: 0,
    };
  }

  // 3. Org-level monthly $ cap
  const { data: orgRows } = await admin
    .from("ai_usage")
    .select("cost_usd")
    .eq("org_id", orgId)
    .gte("created_at", startOfMonth.toISOString());
  const orgMonthlyUsd = (orgRows ?? []).reduce(
    (s, r) => s + Number(r.cost_usd ?? 0),
    0,
  );
  if (orgMonthlyUsd >= PER_ORG_MONTHLY_USD) {
    return {
      allowed: false,
      reason: `Org เกิน budget AI $${PER_ORG_MONTHLY_USD}/เดือน — ติดต่อ admin`,
      remainingMonthlyOrgUsd: 0,
    };
  }

  return {
    allowed: true,
    remainingHourlyCalls: PER_USER_HOURLY_CALLS - (hourlyCalls ?? 0),
    remainingDailyUsd: PER_USER_DAILY_USD - dailyUsd,
    remainingMonthlyOrgUsd: PER_ORG_MONTHLY_USD - orgMonthlyUsd,
  };
}

/**
 * Record one AI call. Backwards-compatible: legacy callers pass
 * `provider: "claude-haiku" | "gemini-flash"` (used only for cost calc).
 * NEW callers pass:
 *   model: full model id (e.g. "claude-sonnet-4-6") → routed through
 *          @/lib/costctrl/pricing.computeAiCostUsd for accurate cost
 *   moduleName: short module slug ("cashhub"|"docuflow"|"recruit"|"inbox"|...)
 * Both new columns are nullable so old rows keep working. CostCtrl reads
 * provider/model/module for grouping; legacy rows fall back to endpoint
 * parsing on the read side.
 */
export async function recordAiUsage(opts: {
  userId?: string | null;
  orgId: string;
  endpoint: string;
  provider?: string;
  model?: string;
  moduleName?: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  const {
    userId,
    orgId,
    endpoint,
    provider,
    model,
    moduleName,
    inputTokens = 0,
    outputTokens = 0,
  } = opts;

  let cost = 0;
  if (model) {
    const { computeAiCostUsd } = await import("@/lib/costctrl/pricing");
    cost = computeAiCostUsd(model, inputTokens, outputTokens);
  } else if (provider) {
    const inKey = `${provider}-input` as keyof typeof PRICING;
    const outKey = `${provider}-output` as keyof typeof PRICING;
    cost = inputTokens * (PRICING[inKey] ?? 0) + outputTokens * (PRICING[outKey] ?? 0);
  }

  let provTag: string | undefined = provider;
  if (model) {
    if (model.startsWith("claude")) provTag = "anthropic";
    else if (model.startsWith("gemini")) provTag = "gemini";
    else if (model.startsWith("gpt")) provTag = "openai";
  } else if (provider === "claude-haiku") provTag = "anthropic";
  else if (provider === "gemini-flash") provTag = "gemini";

  const mod = moduleName ?? endpoint.split(".")[0] ?? null;

  const admin = adminClient();
  await admin.from("ai_usage").insert({
    org_id: orgId,
    user_id: userId ?? null,
    endpoint,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: cost,
    provider: provTag ?? null,
    model: model ?? null,
    module: mod,
  });
}
