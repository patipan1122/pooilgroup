// Simple in-memory rate limiter for public endpoints
// Per Pool pattern (rate-limiting concept): in-memory Map · sufficient for SME scale
// Resets every process restart · use Vercel Edge KV for prod-grade

interface Bucket { count: number; resetAt: number; }

const buckets = new Map<string, Bucket>();

export function checkRate(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: b.resetAt - now };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, retryAfterMs: 0 };
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
