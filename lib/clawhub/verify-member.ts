// ClawHub (JOLLY PLAY) — server-side LIFF id_token → verified member.
//
// SECURITY (W-014 iOS cookie-drop): the customer LIFF app NEVER sends a member id.
// Every WRITE (consent / refund / redeem) POSTs the LINE id_token and we verify it
// HERE, on the server, against ClawHub's OWN Login channel — then resolve the LINE
// `sub` → ClawhubMember. This is the same verification the Pool line-login route does
// (POST https://api.line.me/oauth2/v2.1/verify with client_id = the channel that
// issued the token), but ClawHub does not mint a Supabase session: a customer is just
// a ClawhubMember row keyed by the verified LINE id, so we skip the magic-link dance.
//
// Why a dedicated verifier instead of reusing /api/auth/line-login: that route resolves
// to a *Pool user* (staff/maid) and mints a Supabase cookie session. ClawHub customers
// have no Pool user — they only exist as ClawhubMember. Mixing them through line-login
// would self-register junk ChairOps maids. We keep the two identity stores separate.

import type { ClawhubMember } from "@/lib/generated/prisma/client";
import { loginChannelIdForModule } from "@/lib/line/channels";
import { clawhubOrgId } from "./org";
import { getOrCreateMember } from "./member";

/** Verified LINE identity from a LIFF id_token. */
export type VerifiedLine = {
  lineUserId: string;
  displayName?: string;
  pictureUrl?: string;
};

/**
 * Verify a LIFF id_token against ClawHub's Login channel via LINE's official endpoint.
 * Returns the verified `sub` (LINE userId) + name/picture, or null if the token is
 * invalid / the channel id is unset. NEVER trust a client-sent userId — only the `sub`
 * inside a token LINE signed.
 */
export async function verifyClawhubIdToken(
  idToken: string,
): Promise<VerifiedLine | null> {
  const channelId = loginChannelIdForModule("clawhub");
  if (!channelId) return null;
  if (typeof idToken !== "string" || idToken.length < 20) return null;

  try {
    const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      sub?: string;
      name?: string;
      picture?: string;
    };
    if (!j.sub) return null;
    return {
      lineUserId: j.sub,
      displayName: typeof j.name === "string" ? j.name : undefined,
      pictureUrl: typeof j.picture === "string" ? j.picture : undefined,
    };
  } catch {
    return null;
  }
}

export type ResolvedMember = {
  orgId: string;
  member: ClawhubMember;
  line: VerifiedLine;
};

/**
 * Verify the id_token and resolve (or create) the ClawhubMember for that LINE user in
 * the single Pooilgroup org. Returns null if the token is invalid. This is the ONE
 * trusted path every write route uses to learn "who is this customer".
 *
 * `profile` (displayName/pictureUrl) from the client is only a *hint* used to enrich a
 * freshly-created member's denorm fields — it can never change WHICH member we resolve
 * (that's pinned to the verified `sub`).
 */
export async function resolveMemberFromIdToken(
  idToken: string,
  profile?: { displayName?: string; pictureUrl?: string },
): Promise<ResolvedMember | null> {
  const line = await verifyClawhubIdToken(idToken);
  if (!line) return null;

  const orgId = await clawhubOrgId();
  const member = await getOrCreateMember(orgId, {
    lineUserId: line.lineUserId,
    displayName: line.displayName ?? profile?.displayName,
    pictureUrl: line.pictureUrl ?? profile?.pictureUrl,
  });

  return { orgId, member, line };
}
