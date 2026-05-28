// Pre-flight: check if account is locked BEFORE calling Supabase signIn.
// Returns 423 Locked with retry-after if user has hit 5 failed attempts.
// Otherwise 200 with attemptsRemaining.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkLockStatus } from "@/lib/auth/login-tracker";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const Schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  // BUG-014: IP-based rate limit (กัน brute-force ข้าม email หลายตัว)
  // 10 check-login calls / IP / minute — เกินนี้ block 60 วินาที
  const ip = getClientIp(req);
  const rl = await checkRateLimit({
    bucket: `auth-check:ip:${ip}`,
    max: 10,
    windowSec: 60,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: "ลอง login บ่อยเกินไป กรุณารอ 1 นาที" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const status = await checkLockStatus(parsed.data.email);
  if (status.locked) {
    return NextResponse.json(
      {
        locked: true,
        retryAfterSeconds: status.retryAfterSeconds,
        message: `บัญชีถูกล็อก ลองอีกครั้งใน ${Math.ceil(
          (status.retryAfterSeconds ?? 0) / 60,
        )} นาที`,
      },
      {
        status: 423,
        headers: {
          "Retry-After": String(status.retryAfterSeconds ?? 0),
        },
      },
    );
  }

  return NextResponse.json({
    locked: false,
    attemptsRemaining: status.attemptsRemaining,
  });
}
