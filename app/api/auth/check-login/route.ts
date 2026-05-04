// Pre-flight: check if account is locked BEFORE calling Supabase signIn.
// Returns 423 Locked with retry-after if user has hit 5 failed attempts.
// Otherwise 200 with attemptsRemaining.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkLockStatus } from "@/lib/auth/login-tracker";

const Schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
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
