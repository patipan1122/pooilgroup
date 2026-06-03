// Shared (non-"use server") Google Drive OAuth helpers so both the connect
// server action and the callback route compute an IDENTICAL redirect_uri and
// share the CSRF state cookie name. (A "use server" file may only export async
// functions, so these can't live in actions.ts.)

import { headers } from "next/headers";

export const OAUTH_STATE_COOKIE = "chairops_drive_oauth_state";

/** Public callback URL — must match the one registered in Google Cloud. */
export async function callbackRedirectUri(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/chairops/drive/oauth/callback`;
}
