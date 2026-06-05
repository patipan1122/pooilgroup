// Shared Gmail OAuth helpers (non-"use server") — callback URI + CSRF cookie name.

import { headers } from "next/headers";

export const OAUTH_STATE_COOKIE = "chairops_gmail_oauth_state";

export async function callbackRedirectUri(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/chairops/email/oauth/callback`;
}
