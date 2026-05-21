// In-memory rate limiter (per [[rate-limiting]] pattern from Pool)
// Reset every server cold start. For multi-region Vercel this is per-instance.
// Sufficient for login/reset bot deterrence. NOT a DDoS shield.

type Key = string;
const buckets = new Map<Key, { count: number; resetAt: number }>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetIn: number; // ms
}

export function rateLimit(
  key: Key,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, resetIn: opts.windowMs };
  }
  b.count += 1;
  if (b.count > opts.limit) {
    return { ok: false, remaining: 0, resetIn: b.resetAt - now };
  }
  return { ok: true, remaining: opts.limit - b.count, resetIn: b.resetAt - now };
}

// Sweep oldest entries periodically (best-effort, no global timer)
export function gcRateLimit() {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

// Pre-configured policies
export const LIMITS = {
  login: { limit: 5, windowMs: 15 * 60_000 },        // 5 / 15 min / IP+email
  resetPassword: { limit: 3, windowMs: 60 * 60_000 }, // 3 / hr / email
  r2Presign: { limit: 60, windowMs: 60_000 },         // 60 / min / user
  cashCollect: { limit: 20, windowMs: 60_000 },       // 20 / min / user
  posUpload: { limit: 10, windowMs: 60_000 },         // 10 / min / user
} as const;
