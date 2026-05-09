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
const PRICING = {
  "claude-haiku-input": 1.0 / 1_000_000,
  "claude-haiku-output": 5.0 / 1_000_000,
  "gemini-flash-input": 0,    // ฟรี tier
  "gemini-flash-output": 0,
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

export async function recordAiUsage(opts: {
  userId: string;
  orgId: string;
  endpoint: string;
  provider?: "claude-haiku" | "gemini-flash";
  inputTokens?: number;
  outputTokens?: number;
}) {
  const {
    userId,
    orgId,
    endpoint,
    provider = "claude-haiku",
    inputTokens = 0,
    outputTokens = 0,
  } = opts;
  const inKey = `${provider}-input` as keyof typeof PRICING;
  const outKey = `${provider}-output` as keyof typeof PRICING;
  const cost = inputTokens * (PRICING[inKey] ?? 0) + outputTokens * (PRICING[outKey] ?? 0);
  const admin = adminClient();
  await admin.from("ai_usage").insert({
    org_id: orgId,
    user_id: userId,
    endpoint,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: cost,
  });
}
