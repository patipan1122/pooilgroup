// Shared (non-"use server") Google Drive OAuth helpers so both the connect
// server action and the callback route compute an IDENTICAL redirect_uri and
// share the CSRF state cookie name. (A "use server" file may only export async
// functions, so these can't live in actions.ts.)

import { headers } from "next/headers";

export const OAUTH_STATE_COOKIE = "chairops_drive_oauth_state";

// After the OAuth round-trip the callback normally lands on the ChairOps Drive
// settings page. Other modules (e.g. Recruit) that reuse the SAME org-level
// Google connection set this cookie at connect-start so the callback bounces
// the user back to THEIR settings page instead — the Drive login is one shared
// company-wide connection, but the button can live in any program.
export const OAUTH_RETURN_COOKIE = "drive_oauth_return";

/** Only allow bouncing back to an internal admin path (never an open redirect). */
export function safeReturnPath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // must be a same-origin absolute path like "/recruit/settings" (not "//evil")
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(raw)) return null;
  return raw;
}

/** Public callback URL — must match the one registered in Google Cloud. */
export async function callbackRedirectUri(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/chairops/drive/oauth/callback`;
}
