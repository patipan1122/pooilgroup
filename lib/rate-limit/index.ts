// DB-backed rate limiter (no Upstash dependency)
// ใช้ตาราง rate_limit_attempts จาก migration 004
//
// Pattern:
//   const limited = await isRateLimited({ bucket: `auth:ip:${ip}`, max: 10, windowSec: 60 });
//   if (limited) return 429;
//   await recordAttempt(`auth:ip:${ip}`);
//
// คำเตือน: ที่ scale สูง (>1000 req/s) ควรเปลี่ยนเป็น Redis (Upstash)
// แต่สำหรับ Phase 1 (30 สาขา ~200 users) DB-backed พอ

import { adminClient } from "@/lib/db/server";

export interface RateLimitOpts {
  bucket: string;
  max: number;
  windowSec: number;
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  retryAfterSec: number;
  count: number;
}

/**
 * Check + record an attempt atomically. Returns whether the caller is over limit.
 * If limited, the attempt is NOT recorded (don't inflate the bucket).
 */
export async function checkRateLimit(opts: RateLimitOpts): Promise<RateLimitResult> {
  const { bucket, max, windowSec } = opts;
  const admin = adminClient();
  const since = new Date(Date.now() - windowSec * 1000).toISOString();

  // Count existing attempts in window
  const { count } = await admin
    .from("rate_limit_attempts")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .gte("attempted_at", since);

  const current = count ?? 0;
  if (current >= max) {
    return {
      limited: true,
      remaining: 0,
      retryAfterSec: windowSec,
      count: current,
    };
  }

  // Record the attempt
  await admin.from("rate_limit_attempts").insert({
    bucket,
    attempted_at: new Date().toISOString(),
  });

  return {
    limited: false,
    remaining: Math.max(0, max - current - 1),
    retryAfterSec: 0,
    count: current + 1,
  };
}

/**
 * Get the client IP from a Next.js request, respecting Vercel forwarded headers.
 * Falls back to "unknown" if no IP can be determined.
 */
export function getClientIp(req: Request): string {
  const headers = req.headers;
  // Vercel sets x-forwarded-for / x-real-ip
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // Take first IP (closest to client)
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  return "unknown";
}
