// LedgerLine — LINE group metadata helper.
//
// A bound group row (ledger_line_group) used to show only an opaque id tail
// ("กลุ่ม 0dae3553") because `label` was never populated. This helper fetches the
// REAL group name + member count from the LINE Messaging API and snapshots them
// onto the row, so the web back-office shows "ชื่อกลุ่มจริง · 5 คน" — admins can
// tell groups apart at a glance and never mis-bind a branch.
//
// All calls are best-effort with a short timeout — a failed fetch never blocks a
// command reply or receipt capture.

import { prisma } from "@/lib/prisma";

/** Fetch a LINE group's display name + member count (best-effort, never throws). */
export async function fetchLineGroupMeta(
  accessToken: string,
  groupId: string,
): Promise<{ name: string | null; count: number | null }> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [name, count] = await Promise.all([
    (async () => {
      try {
        const r = await fetch(
          `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`,
          { headers, signal: AbortSignal.timeout(3000) },
        );
        if (!r.ok) return null;
        const j = (await r.json()) as { groupName?: unknown };
        return typeof j.groupName === "string" && j.groupName.trim()
          ? j.groupName.trim()
          : null;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const r = await fetch(
          `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/members/count`,
          { headers, signal: AbortSignal.timeout(3000) },
        );
        if (!r.ok) return null;
        const j = (await r.json()) as { count?: unknown };
        return typeof j.count === "number" ? j.count : null;
      } catch {
        return null;
      }
    })(),
  ]);
  return { name, count };
}

/**
 * Refresh the stored name + member count for an ALREADY-bound group row. Does NOT
 * create a row (binding happens via `/setting สาขา`) — it only updates an existing
 * one so the list stays = configured groups, just with proper names. Safe to call
 * on any admin /setting command; swallows all errors.
 */
export async function refreshLedgerGroupMeta(args: {
  orgId: string;
  companyId: string;
  groupId: string;
  accessToken: string;
}): Promise<void> {
  const { orgId, companyId, groupId, accessToken } = args;
  if (!orgId || !companyId || !groupId || !accessToken) return;
  try {
    const { name, count } = await fetchLineGroupMeta(accessToken, groupId);
    if (name == null && count == null) return; // nothing learned → leave as-is
    await prisma.ledgerLineGroup.updateMany({
      where: { orgId, companyId, groupId },
      data: {
        ...(name != null ? { label: name } : {}),
        ...(count != null ? { memberCount: count } : {}),
      },
    });
  } catch {
    // best-effort — never block the command reply.
  }
}
