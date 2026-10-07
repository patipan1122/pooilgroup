// Impersonation cookie — lets super_admin/org_admin/admin temporarily browse
// the app as another (lower-ranked) user (debugging, fixing data on their
// behalf, ChairOps office playing-as a maid), with a one-click return to
// their own account.
//
// Design:
// - Cookie holds {adminId, targetId, exp} signed with HMAC-SHA256.
// - getSession() honors the cookie ONLY if the real authenticated user's id
//   matches `adminId`, that user has an allowed real role (session.ts's
//   IMPERSONATION_ALLOWED_ROLES), AND that user out-ranks the target
//   (canManageUser — ultramobileux audit P0-5, 2026-10-07). So the cookie is
//   bound to a specific admin, cannot be re-used by anyone else, and cannot
//   be used to reach a peer or superior.
// - 1-hour expiry. Return-to-self just clears the cookie.
// - Audit log on enter + exit (handled in route handlers).
//
// Why HMAC-only (no DB session table): single-tenant ERP, secret is server-side,
// cookie is httpOnly. DB table would be cleaner for forced revocation but
// adds a query on every request — not worth the cost here.

import { createHmac, timingSafeEqual } from "node:crypto";

export const IMPERSONATION_COOKIE = "pooil_acting_as";
const TTL_MS = 60 * 60 * 1000; // 1 hour

export type ImpersonationPayload = {
  adminId: string;
  targetId: string;
  exp: number;
};

function getSecret(): string {
  // Reuse service role key as HMAC secret — it's already a high-entropy
  // server-only secret. If you ever want to invalidate all impersonation
  // cookies at once, rotate this (along with the service role key).
  const secret =
    process.env.IMPERSONATION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Impersonation secret not configured");
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function encodeImpersonationCookie(
  adminId: string,
  targetId: string,
): string {
  const exp = Date.now() + TTL_MS;
  const payload: ImpersonationPayload = { adminId, targetId, exp };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function decodeImpersonationCookie(
  cookie: string | undefined,
): ImpersonationPayload | null {
  if (!cookie) return null;
  const dot = cookie.indexOf(".");
  if (dot < 0) return null;
  const body = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = sign(body);
  if (sig.length !== expected.length) return null;
  if (
    !timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<ImpersonationPayload>;
    if (
      typeof parsed.adminId !== "string" ||
      typeof parsed.targetId !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp < Date.now()) return null;
    return parsed as ImpersonationPayload;
  } catch {
    return null;
  }
}
