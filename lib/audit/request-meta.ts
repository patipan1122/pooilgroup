// Extract IP/UA from a NextRequest for audit() calls.
// Use in route handlers like:
//   await audit({ ..., ...getRequestMeta(req) })
//
// 2026-05-20: added per Finance Manager audit — sensitive routes must
// capture IP + User-Agent so external auditor can trace "เครื่องไหน IP อะไร
// กดอนุมัติ/ปลดล็อก". Without this, audit_logs schema has the column but
// route handlers never fill it.

import type { NextRequest } from "next/server";

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Pull `x-forwarded-for` (first hop · client real IP behind Vercel/CF)
 * or `x-real-ip` fallback · plus user-agent.
 *
 * Never throws — if headers missing, returns empty object so caller's
 * spread `...getRequestMeta(req)` is a no-op.
 */
export function getRequestMeta(req: NextRequest): RequestMeta {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent") ?? undefined;

  // x-forwarded-for can be "client, proxy1, proxy2" — first is the real client.
  const ip = forwarded?.split(",")[0]?.trim() || realIp || undefined;

  return {
    ipAddress: ip,
    userAgent: ua,
  };
}
