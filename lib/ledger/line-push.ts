// LedgerLine — push a flex message into a group FROM a web server action.
//
// The webhook has its own reply/push helpers (it already holds the channel token).
// The "ขอโอนเงิน" web action needs to push the request card into the executive
// (= slip-intake) group, so it must resolve the channel access token + the group id
// itself. Best-effort: a LINE outage must never fail the DB write of the request.
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/recruit/channel-crypto";
import type { LineFlexMessage } from "@/components/ledger/LineConfirmCard";

export interface PushResult {
  ok: boolean;
  /** the sent message id (LINE returns it) — stored for reply-to-card matching. */
  messageId?: string;
  /** the group the card was pushed to. */
  groupId?: string;
  reason?: "no_slip_group" | "no_channel" | "push_failed";
}

/** The org+company's slip-intake group id (the executive group) — null if unset. */
export async function slipIntakeGroupId(
  orgId: string,
  companyId: string,
): Promise<string | null> {
  const g = await prisma.ledgerLineGroup.findFirst({
    where: { orgId, companyId, isSlipIntake: true, active: true },
    select: { groupId: true },
    orderBy: { createdAt: "asc" },
  });
  return g?.groupId ?? null;
}

/** Resolve the active channel's decrypted access token for this org+company. */
async function channelAccessToken(orgId: string, companyId: string): Promise<string | null> {
  const ch = await prisma.ledgerLineChannel.findFirst({
    where: { orgId, companyId, active: true, accessTokenEnc: { not: null } },
    select: { accessTokenEnc: true },
    orderBy: { createdAt: "asc" },
  });
  if (!ch?.accessTokenEnc) return null;
  return decryptToken(ch.accessTokenEnc);
}

/** Push a flex card to the org+company's slip-intake (executive) group. */
export async function pushFlexToSlipGroup(
  orgId: string,
  companyId: string,
  flex: LineFlexMessage,
): Promise<PushResult> {
  const groupId = await slipIntakeGroupId(orgId, companyId);
  if (!groupId) return { ok: false, reason: "no_slip_group" };
  const accessToken = await channelAccessToken(orgId, companyId);
  if (!accessToken) return { ok: false, reason: "no_channel" };

  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: groupId, messages: [flex] }),
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) {
      console.error("[ledger:line-push] push failed", resp.status, await resp.text().catch(() => ""));
      return { ok: false, groupId, reason: "push_failed" };
    }
    const j = (await resp.json().catch(() => null)) as { sentMessages?: { id?: string }[] } | null;
    return { ok: true, groupId, messageId: j?.sentMessages?.[0]?.id };
  } catch (e) {
    console.error("[ledger:line-push] push error", e);
    return { ok: false, groupId, reason: "push_failed" };
  }
}

/** Push a plain text notice to the slip-intake group (e.g. "ยกเลิกคำขอแล้ว"). */
export async function pushTextToSlipGroup(
  orgId: string,
  companyId: string,
  text: string,
): Promise<PushResult> {
  const groupId = await slipIntakeGroupId(orgId, companyId);
  if (!groupId) return { ok: false, reason: "no_slip_group" };
  const accessToken = await channelAccessToken(orgId, companyId);
  if (!accessToken) return { ok: false, reason: "no_channel" };
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: groupId, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
      signal: AbortSignal.timeout(4000),
    });
    return resp.ok ? { ok: true, groupId } : { ok: false, groupId, reason: "push_failed" };
  } catch {
    return { ok: false, groupId, reason: "push_failed" };
  }
}
