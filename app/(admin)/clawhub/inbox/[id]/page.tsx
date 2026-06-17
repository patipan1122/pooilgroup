// ClawHub (JOLLY PLAY) — conversation thread view + reply.
// Opening the thread clears its unread badge (direct update — this Server Component
// is already gated by the module layout). Image messages stored in R2 get a signed
// GET url (private content), same pattern as refund screenshots.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { fmtDateTime } from "../../_lib";
import {
  ReplyBox,
  ThreadControls,
  MessageBubble,
  type ThreadMessage,
} from "./_thread";

export const dynamic = "force-dynamic";

async function signedUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return await getSignedDownloadUrl(key, 900);
  } catch {
    return null;
  }
}

export default async function ClawhubThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orgId = await clawhubOrgId();

  const conv = await prisma.clawhubConversation.findUnique({ where: { id } });
  if (!conv || conv.orgId !== orgId) notFound();

  // Clear unread on open (no-op if already 0).
  if (conv.unreadCount > 0) {
    await prisma.clawhubConversation
      .update({ where: { id: conv.id }, data: { unreadCount: 0 } })
      .catch(() => undefined);
  }

  const messages = await prisma.clawhubMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const thread: ThreadMessage[] = await Promise.all(
    messages.map(async (m) => ({
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      text: m.text,
      imageUrl: m.kind === "IMAGE" ? await signedUrl(m.r2Key) : null,
      byBot: m.byBot,
      createdAt: fmtDateTime(m.createdAt),
    })),
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col p-4 sm:p-6">
      {/* Header */}
      <div className="mb-3 flex items-center gap-3">
        <Link href="/clawhub/inbox" className="text-sm" style={{ color: "var(--cw-text-2)" }}>
          ←
        </Link>
        {conv.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={conv.pictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
            style={{ background: "var(--cw-brand-100)", color: "var(--cw-brand-700)" }}
          >
            {(conv.displayName ?? "?").slice(0, 1)}
          </div>
        )}
        <div className="flex-1">
          <div className="font-bold">{conv.displayName ?? "ลูกค้า LINE"}</div>
        </div>
        <ThreadControls conversationId={conv.id} botEnabled={conv.botEnabled} />
      </div>

      {/* Messages */}
      <div
        className="cw-card flex-1 space-y-2 overflow-y-auto p-3"
        style={{ background: "var(--cw-bg-3)" }}
      >
        {thread.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: "var(--cw-text-3)" }}>
            ยังไม่มีข้อความ
          </div>
        ) : (
          thread.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
      </div>

      {/* Reply */}
      <div className="cw-card mt-2 overflow-hidden">
        <ReplyBox conversationId={conv.id} />
      </div>
    </div>
  );
}
