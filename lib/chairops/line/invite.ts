// Signed maid-invite tokens — let an admin generate a one-tap LINE onboarding
// link instead of copy-pasting LINE IDs. The token binds a specific
// ChairopsUser; when the maid opens the link + does LINE login, the verified
// LINE userId is bound to that user (see /api/auth/line-login `invite` path).
//
// Token = base64url(payload).hexHmac  ·  payload = { u: chairopsUserId, e: expMs }
// HMAC-SHA256 with NEXTAUTH_SECRET (server-only) — unforgeable. Bearer token
// per [[refid-as-bearer-token-pattern]]: signed + expiring + single-bind
// (line-login refuses to rebind an already-bound user to a different LINE id).

import crypto from "node:crypto";

const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET (or AUTH_SECRET) required to sign maid invites");
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", secret()).update(payloadB64).digest("hex");
}

export function signInvite(chairopsUserId: string): string {
  const payload = JSON.stringify({ u: chairopsUserId, e: Date.now() + TTL_MS });
  const payloadB64 = b64url(Buffer.from(payload, "utf8"));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Returns the chairopsUserId if the token is valid + unexpired, else null. */
export function verifyInvite(token: string | undefined | null): string | null {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64);
  // constant-time compare
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const { u, e } = JSON.parse(fromB64url(payloadB64).toString("utf8")) as {
      u?: string;
      e?: number;
    };
    if (!u || typeof e !== "number" || Date.now() > e) return null;
    return u;
  } catch {
    return null;
  }
}
