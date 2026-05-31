// CostCtrl read-side data helpers — Server-Component friendly
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { FREE_TIER_LIMITS, pctBar, type ProviderSlug } from "./pricing";

export type ProviderSummary = {
  id: string;
  slug: string;
  displayName: string;
  category: string;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  budgetUsd: number;             // current month
  costMtdUsd: number;            // current month cost
  budgetPctTone: "ok" | "warn" | "alarm";
  budgetPct: number;
  metrics: Array<{
    metric: string;
    unit: string;
    value: number;
    free?: number;               // free-tier ceiling if known
    pct?: number;                // % of free tier
    tone?: "ok" | "warn" | "alarm";
  }>;
};

function firstOfMonth(d = new Date()): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return out;
}

function ymKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function pickBudget(budgetMonthly: Prisma.JsonValue, ymOrDefault: string): number {
  if (!budgetMonthly || typeof budgetMonthly !== "object" || Array.isArray(budgetMonthly)) return 0;
  const obj = budgetMonthly as Record<string, unknown>;
  const v = obj[ymOrDefault] ?? obj["default"];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

export async function listProviderSummaries(): Promise<ProviderSummary[]> {
  const month = firstOfMonth();
  const providers = await prisma.costProvider.findMany({
    orderBy: [{ enabled: "desc" }, { category: "asc" }, { slug: "asc" }],
  });

  const summaries: ProviderSummary[] = [];
  for (const p of providers) {
    // Latest snapshots for current month, per metric (keep max capturedAt per metric)
    const snaps = await prisma.costSnapshot.findMany({
      where: { providerId: p.id, periodMonth: month },
      orderBy: { capturedAt: "desc" },
    });
    // dedupe — keep first (latest) per metric
    const seen = new Set<string>();
    const latest = snaps.filter((s) => {
      if (seen.has(s.metric)) return false;
      seen.add(s.metric);
      return true;
    });

    const budget = pickBudget(p.budgetMonthly, ymKey(month));
    const costRow = latest.find((s) => s.metric === "cost_usd");
    const costMtd = costRow ? Number(costRow.costUsd) : latest.reduce((sum, s) => sum + Number(s.costUsd), 0);
    const { pct: bp, tone: bt } = pctBar(costMtd, budget);

    const freeTier = (FREE_TIER_LIMITS as Record<string, Record<string, number>>)[p.slug] ?? {};
    const metrics = latest.map((s) => {
      const free = freeTier[s.metric];
      const value = Number(s.value);
      if (free != null && isFinite(free)) {
        const { pct, tone } = pctBar(value, free);
        return { metric: s.metric, unit: s.unit, value, free, pct, tone };
      }
      return { metric: s.metric, unit: s.unit, value };
    });

    summaries.push({
      id: p.id,
      slug: p.slug,
      displayName: p.displayName,
      category: p.category,
      enabled: p.enabled,
      lastSyncAt: p.lastSyncAt,
      lastSyncStatus: p.lastSyncStatus,
      budgetUsd: budget,
      costMtdUsd: costMtd,
      budgetPct: bp,
      budgetPctTone: bt,
      metrics,
    });
  }
  return summaries;
}

export async function getProviderBySlug(slug: string) {
  return prisma.costProvider.findUnique({ where: { slug } });
}

export type DailyPoint = { day: string; costUsd: number };

export async function getProviderDailyCosts(providerId: string, days = 30): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 86400_000);
  // Group by date(captured_at) for cost_usd metric
  const rows: Array<{ day: string; cost_usd: string | number }> = await prisma.$queryRaw`
    SELECT DATE(captured_at)::text AS day, SUM(cost_usd)::text AS cost_usd
    FROM public.cost_snapshot
    WHERE provider_id = ${providerId}::uuid
      AND captured_at >= ${since}
      AND metric = 'cost_usd'
    GROUP BY DATE(captured_at)
    ORDER BY DATE(captured_at)
  `;
  return rows.map((r) => ({ day: r.day, costUsd: Number(r.cost_usd) }));
}

export async function listRecentAlertEvents(limit = 20) {
  return prisma.costAlertEvent.findMany({
    orderBy: { triggeredAt: "desc" },
    take: limit,
    include: { rule: { include: { provider: true } } },
  });
}

export async function listAlertRules() {
  return prisma.costAlertRule.findMany({
    orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    include: { provider: true },
  });
}

export async function listCredentials() {
  return prisma.costApiCredential.findMany({
    orderBy: { createdAt: "desc" },
    include: { provider: true },
  });
}

// ── AI Usage aggregation (reads ai_usage table directly) ──
export type AiUsageRow = {
  provider: string | null;
  model: string | null;
  module: string | null;
  endpoint: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  calls: number;
};

export async function aggregateAiUsageMtd(): Promise<AiUsageRow[]> {
  const month = firstOfMonth();
  const rows: Array<{
    provider: string | null;
    model: string | null;
    module: string | null;
    endpoint: string;
    input_tokens: string | number;
    output_tokens: string | number;
    cost_usd: string | number;
    calls: string | number;
  }> = await prisma.$queryRaw`
    SELECT
      COALESCE(provider, '(legacy)') AS provider,
      COALESCE(model, '(unknown)') AS model,
      COALESCE(module, split_part(endpoint, '.', 1)) AS module,
      endpoint,
      SUM(input_tokens)::text  AS input_tokens,
      SUM(output_tokens)::text AS output_tokens,
      SUM(cost_usd)::text      AS cost_usd,
      COUNT(*)::text           AS calls
    FROM public.ai_usage
    WHERE created_at >= ${month}
    GROUP BY 1, 2, 3, 4
    ORDER BY SUM(cost_usd) DESC NULLS LAST
  `;
  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    module: r.module,
    endpoint: r.endpoint,
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    cost_usd: Number(r.cost_usd),
    calls: Number(r.calls),
  }));
}

export async function aiUsageMtdTotalsByProvider(): Promise<Array<{ provider: string; tokensIn: number; tokensOut: number; costUsd: number; calls: number }>> {
  const all = await aggregateAiUsageMtd();
  const map = new Map<string, { provider: string; tokensIn: number; tokensOut: number; costUsd: number; calls: number }>();
  for (const r of all) {
    const key = r.provider ?? "(legacy)";
    const cur = map.get(key) ?? { provider: key, tokensIn: 0, tokensOut: 0, costUsd: 0, calls: 0 };
    cur.tokensIn += r.input_tokens;
    cur.tokensOut += r.output_tokens;
    cur.costUsd += r.cost_usd;
    cur.calls += r.calls;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.costUsd - a.costUsd);
}
