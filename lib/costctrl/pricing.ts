// CostCtrl pricing constants — USD per unit
// Source: provider pricing pages as of 2026-05-31 · audit & update quarterly

// ── AI tokens (USD per 1M tokens) ───────────────────────────
export const AI_PRICING_USD_PER_M = {
  // Anthropic Claude — https://www.anthropic.com/pricing
  "claude-opus-4-7":     { in: 15.0,  out: 75.0 },
  "claude-opus-4-8":     { in: 15.0,  out: 75.0 },
  "claude-sonnet-4-5":   { in: 3.0,   out: 15.0 },
  "claude-sonnet-4-6":   { in: 3.0,   out: 15.0 },
  "claude-haiku-4-5":    { in: 1.0,   out: 5.0  },
  // Google Gemini — https://ai.google.dev/pricing
  "gemini-2.5-flash":    { in: 0.075, out: 0.30 },
  "gemini-2.5-pro":      { in: 1.25,  out: 5.0  },
  // OpenAI (placeholder, none deployed yet)
  "gpt-4o":              { in: 2.5,   out: 10.0 },
} as const;

export type KnownModel = keyof typeof AI_PRICING_USD_PER_M;

export function computeAiCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = (AI_PRICING_USD_PER_M as Record<string, { in: number; out: number }>)[model];
  if (!p) return 0;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

export function modelToProvider(model: string): "anthropic" | "gemini" | "openai" | "unknown" {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("gpt")) return "openai";
  return "unknown";
}

// ── Infra free-tier limits (used to compute % usage) ─────────
export const FREE_TIER_LIMITS = {
  vercel: {
    bandwidth_gb: 100,        // Hobby
    function_invocations: 1_000_000,
    build_minutes: 6_000,
    edge_requests: 1_000_000,
  },
  supabase: {
    db_size_mb: 500,
    egress_gb: 5,
    mau: 50_000,
    realtime_concurrent: 200,
  },
  r2: {
    storage_gb: 10,
    class_a_ops: 1_000_000,    // monthly
    class_b_ops: 10_000_000,
    egress_gb: Infinity,        // R2 has free egress
  },
  anthropic: {
    // Anthropic doesn't have a free tier — billed from $0
    cost_usd: Infinity,
  },
  gemini: {
    requests_per_day: 1_500,    // Flash 2.5 free tier
    cost_usd: Infinity,
  },
} as const;

export type ProviderSlug = keyof typeof FREE_TIER_LIMITS;

// ── Pretty-print helpers ──────────────────────────────────
export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatNumber(n: number, unit?: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M${unit ? " " + unit : ""}`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k${unit ? " " + unit : ""}`;
  return `${n.toFixed(0)}${unit ? " " + unit : ""}`;
}

export function pctBar(value: number, max: number): { pct: number; tone: "ok" | "warn" | "alarm" } {
  if (!isFinite(max) || max <= 0) return { pct: 0, tone: "ok" };
  const pct = Math.min(100, Math.round((value / max) * 100));
  const tone = pct >= 100 ? "alarm" : pct >= 80 ? "warn" : "ok";
  return { pct, tone };
}
