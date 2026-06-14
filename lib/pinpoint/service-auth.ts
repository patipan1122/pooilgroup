// Pinpoint — constant-time Bearer CRON_SECRET check for no-login service calls
// (mark-fixed by the developer "พิม", purge cron). Mirrors the codebase's
// HIGH-002 hardening (lib/chairops/auth/cron-secret.ts) so timing side-channels
// can't probe the secret. Fail-closed: no secret configured → reject.

import "server-only";
import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Drain a comparison to avoid leaking length via timing.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** True when the request carries a valid `Authorization: Bearer <CRON_SECRET>`.
 *  Constant-time; returns false when CRON_SECRET is unset (fail-closed). */
export function verifyServiceSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return safeEqual(token, secret);
}
