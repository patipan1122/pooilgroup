// ClawHub (JOLLY PLAY) — inbox: list conversations (latest first, unread badge).

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { PageHeader, EmptyState } from "../_components/ui";
import { fmtDateTime } from "../_lib";

export const dynamic = "force-dynamic";

export default async function ClawhubInboxPage() {
  const orgId = await clawhubOrgId();

  const convs = await prisma.clawhubConversation.findMany({
    where: { orgId },
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="กล่อง" accent="แชท" subtitle="ข้อความจากลูกค้าผ่าน LINE OA" />

      {convs.length === 0 ? (
        <EmptyState>ยังไม่มีบทสนทนา</EmptyState>
      ) : (
        <div className="cw-card divide-y" style={{ borderColor: "var(--cw-border)" }}>
          {convs.map((c) => (
            <Link
              key={c.id}
              href={`/clawhub/inbox/${c.id}`}
              className="flex items-center gap-3 p-3 transition-colors hover:bg-[var(--cw-bg-3)]"
              style={{ borderColor: "var(--cw-border)" }}
            >
              {c.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.pictureUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold"
                  style={{ background: "var(--cw-brand-100)", color: "var(--cw-brand-700)" }}
                >
                  {(c.displayName ?? "?").slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{c.displayName ?? "ลูกค้า LINE"}</span>
                  {!c.botEnabled ? (
                    <span className="cw-chip" style={{ height: 22, fontSize: 11 }}>
                      บอทปิด
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs" style={{ color: "var(--cw-text-3)" }}>
                  {c.lastMessageText ?? "—"}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[11px]" style={{ color: "var(--cw-text-3)" }}>
                  {fmtDateTime(c.lastMessageAt)}
                </span>
                {c.unreadCount > 0 ? (
                  <span
                    className="cw-tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
                    style={{ background: "var(--cw-red)" }}
                  >
                    {c.unreadCount}
                  </span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
