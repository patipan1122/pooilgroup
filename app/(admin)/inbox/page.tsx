// /inbox — กล่องข้อความรวม (unified omnichannel inbox)
// 3-pane workspace: filter rail (left) · conversation list (middle) · detail (right)
// Selection via ?c=<conversationId>. Server component reads searchParams + fetches.

import { requireSession } from "@/lib/auth/session";
import {
  listConversations,
  getConversationWithMessages,
  inboxCounts,
  type ConversationFilter,
} from "@/lib/inbox/queries";
import { listChannels } from "@/lib/inbox/channel-actions";
import { InboxWorkspace } from "./_components/inbox-workspace";

export const dynamic = "force-dynamic";

interface SearchParams {
  c?: string;
  status?: string;
  channel?: string;
  biz?: string;
  human?: string;
  urgent?: string;
  lead?: string;
  q?: string;
}

function parseStatus(
  v: string | undefined,
): "OPEN" | "SNOOZED" | "CLOSED" | undefined {
  if (v === "OPEN" || v === "SNOOZED" || v === "CLOSED") return v;
  return undefined;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const params = await searchParams;

  const selectedId = params.c ?? null;

  const filter: ConversationFilter = {
    status: parseStatus(params.status),
    channelId: params.channel || undefined,
    businessTag: params.biz || undefined,
    needsHuman: params.human === "1" ? true : undefined,
    isUrgent: params.urgent === "1" ? true : undefined,
    isLead: params.lead === "1" ? true : undefined,
    q: params.q?.trim() || undefined,
  };

  const [conversations, counts, channels] = await Promise.all([
    listConversations(orgId, filter),
    inboxCounts(orgId),
    listChannels(),
  ]);

  const selected = selectedId
    ? await getConversationWithMessages(orgId, selectedId)
    : null;

  const channelOptions = channels.map((c) => ({
    id: c.id,
    platform: c.platform,
    displayName: c.displayName,
    businessTag: c.businessTag,
  }));

  return (
    <InboxWorkspace
      orgId={orgId}
      conversations={conversations}
      counts={counts}
      channels={channelOptions}
      selected={selected}
      activeFilters={{
        status: params.status ?? "",
        channel: params.channel ?? "",
        biz: params.biz ?? "",
        human: params.human === "1",
        urgent: params.urgent === "1",
        lead: params.lead === "1",
        q: params.q ?? "",
      }}
    />
  );
}
