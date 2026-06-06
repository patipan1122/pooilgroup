// LedgerLine Drive OAuth helpers (non-"use server"): callback URI + CSRF/state cookie.
// Drive is org-level (one shared connection per org → ChairopsDriveConnection),
// so the cookie carries the nonce + the company only for redirect continuity:
//   cookie value = `${nonce}:${companyId}`

import { headers } from "next/headers";

export const DRIVE_OAUTH_STATE_COOKIE = "ledger_drive_oauth_state";

export async function driveCallbackRedirectUri(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/ledger/drive/oauth/callback`;
}
