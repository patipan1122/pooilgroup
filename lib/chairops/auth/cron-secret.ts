// Guard for cron-only endpoints. Returns a 401 NextResponse if the request
// header `x-cron-secret` does NOT match process.env.CRON_SECRET, or null when ok.
//
// HIGH-002 fix: timingSafeEqual to deter remote timing attacks on the secret.
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still drain a comparison to avoid length-leak (cheap; secret length is fixed in practice)
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function requireCronSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed — refuse to run if no secret is configured.
    return NextResponse.json(
      { error: "cron-secret-not-configured" },
      { status: 500 }
    );
  }
  // B-003 fix: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` by default.
  // Also accept `x-cron-secret` for custom invocations / curl smoke tests.
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const customHeader = request.headers.get("x-cron-secret") ?? "";
  if (!safeEqual(bearerToken, expected) && !safeEqual(customHeader, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
