// LedgerLine Gmail OAuth helpers (non-"use server"): callback URI + CSRF/state cookie.
//
// A mailbox is connected for a SPECIFIC legal entity (company), so the state
// cookie carries both the CSRF nonce AND the target companyId:
//   cookie value = `${nonce}:${companyId}`   (state param = nonce only)

import { headers } from "next/headers";

export const OAUTH_STATE_COOKIE = "ledger_gmail_oauth_state";

export async function callbackRedirectUri(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/ledger/email/oauth/callback`;
}
