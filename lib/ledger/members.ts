// LedgerLine — member auto-seed + LINE profile helper.
//
// CEO model (2026-06-05): people who DROP receipts / type "จด" in a bound group
// should show up in the web back-office automatically (no invite needed) so the
// admin can assign which branch each oversees. This helper upserts a
// ledger_line_member row the first time we see a LINE user act in a group.
//
// Cheap by design: we look the member up by (orgId, lineUserId) FIRST and only
// fetch their LINE display name once (on first sight / when missing). Everything
// is best-effort — a failed profile fetch or a unique-race never blocks capture.

import { prisma } from "@/lib/prisma";

/** Fetch a LINE display name (group-member profile if in a group, else 1:1). */
async function fetchLineDisplayName(
  accessToken: string,
  groupId: string | null,
  userId: string,
): Promise<string | null> {
  const url = groupId
    ? `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`
    : `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { displayName?: unknown };
    return typeof j.displayName === "string" && j.displayName.trim()
      ? j.displayName.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Ensure a ledger_line_member row exists for this LINE user (auto-seed). Creates
 * one with role=staff and NO branch scope on first sight (the admin assigns the
 * branch later in the back-office), back-filling the display name when missing.
 * Never throws — all failures are swallowed so receipt capture is unaffected.
 */
export async function ensureLedgerMember(args: {
  orgId: string;
  companyId: string;
  lineUserId: string;
  groupId?: string | null;
  accessToken?: string | null;
}): Promise<void> {
  const { orgId, companyId, lineUserId, groupId = null, accessToken = null } = args;
  if (!orgId || !companyId || !lineUserId) return;
  try {
    const existing = await prisma.ledgerLineMember.findUnique({
      where: { orgId_lineUserId: { orgId, lineUserId } },
      select: { id: true, displayName: true },
    });
    if (existing) {
      // Back-fill the name once if we have a token and it's still blank.
      if (!existing.displayName && accessToken) {
        const name = await fetchLineDisplayName(accessToken, groupId, lineUserId);
        if (name) {
          await prisma.ledgerLineMember.update({
            where: { id: existing.id },
            data: { displayName: name },
          });
        }
      }
      return;
    }
    const displayName = accessToken
      ? await fetchLineDisplayName(accessToken, groupId, lineUserId)
      : null;
    await prisma.ledgerLineMember.create({
      data: {
        orgId,
        companyId,
        lineUserId,
        displayName,
        role: "staff",
        scopeBranchIds: [],
        scopeCategoryIds: [],
      },
    });
  } catch {
    // unique race (two photos at once) or any DB hiccup → ignore; the row that
    // won the race is fine, and seeding is never allowed to block capture.
  }
}
