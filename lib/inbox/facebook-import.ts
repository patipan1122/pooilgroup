// Read the signed cookie our /facebook-oauth/callback set, returning the
// page list to the picker page (Server Component).

import crypto from "node:crypto";
import { cookies } from "next/headers";

export interface OauthPageRow {
  id: string;
  name: string;
  category: string | null;
  accessTokenEnc: string;
}

const COOKIE_NAME = "inbox_fb_oauth_pages";

function key(): string {
  return (
    process.env.OAUTH_STATE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "fallback-dev-only"
  );
}

export async function readOauthCookie(): Promise<{
  ts: number;
  pages: OauthPageRow[];
} | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  if (
    expected.length !== mac.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (Date.now() - parsed.ts > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearOauthCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
