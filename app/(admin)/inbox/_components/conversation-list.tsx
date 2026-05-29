"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { businessLabel, topicLabel } from "@/lib/inbox/business";
import type { ConversationListItem } from "@/lib/inbox/queries";
import { shortThaiTime } from "./format";
import { MessageSquare } from "lucide-react";

interface Props {
  conversations: ConversationListItem[];
  selectedId: string | null;
  /** Builds the href that keeps current filters but swaps the ?c= param. */
  hrefForConversation: (id: string) => string;
}

function PlatformChip({ platform }: { platform: "LINE" | "FACEBOOK" }) {
  const isLine = platform === "LINE";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
        isLine ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-700"
      }`}
    >
      {isLine ? "LINE" : "Facebook"}
    </span>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  hrefForConversation,
}: Props) {
  if (conversations.length === 0) {
    return (
      <div className="p-8 text-center">
        <MessageSquare className="size-12 mx-auto text-zinc-300" />
        <p className="mt-4 font-bold text-zinc-900">ไม่พบบทสนทนาตามที่กรอง</p>
        <p className="text-xs text-zinc-500 mt-1">
          ลองล้างตัวกรอง หรือรอข้อความใหม่เข้ามา
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {conversations.map((c) => {
        const isSelected = c.id === selectedId;
        const name = c.displayName || "ลูกค้าไม่ระบุชื่อ";
        return (
          <li key={c.id}>
            <Link
              href={hrefForConversation(c.id)}
              className={`block px-4 py-3 transition-colors ${
                isSelected
                  ? "bg-[var(--color-brand-50)] border-l-4 border-[var(--color-brand-500)]"
                  : "border-l-4 border-transparent hover:bg-zinc-50"
              }`}
              aria-current={isSelected ? "true" : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className={`text-sm truncate ${
                    c.unreadCount > 0 ? "font-extrabold text-zinc-900" : "font-semibold text-zinc-800"
                  }`}
                >
                  {name}
                </p>
                <span className="shrink-0 text-[10px] text-zinc-400 tabular-nums">
                  {shortThaiTime(c.lastMessageAt)}
                </span>
              </div>

              <div className="mt-1 flex items-center gap-1.5">
                <PlatformChip platform={c.platform} />
                <span className="text-[11px] text-zinc-500 truncate">
                  {c.channelName}
                  {c.businessTag ? ` · ${businessLabel(c.businessTag)}` : ""}
                </span>
              </div>

              <p className="mt-1 text-xs text-zinc-600 line-clamp-1">
                {c.lastSnippet || "—"}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {c.needsHuman && (
                  <Badge tone="danger" className="text-[10px]">
                    🙋 ต้องคนตอบ
                  </Badge>
                )}
                {c.isUrgent && (
                  <Badge tone="orange" className="text-[10px]">
                    ด่วน
                  </Badge>
                )}
                {c.isLead && (
                  <Badge tone="purple" className="text-[10px]">
                    สนใจซื้อ
                  </Badge>
                )}
                {c.topicTag && (
                  <Badge tone="neutral" className="text-[10px]">
                    {topicLabel(c.topicTag)}
                  </Badge>
                )}
                {c.status === "SNOOZED" && (
                  <Badge tone="warning" className="text-[10px]">
                    พักไว้
                  </Badge>
                )}
                {c.status === "CLOSED" && (
                  <Badge tone="neutral" className="text-[10px]">
                    ปิดแล้ว
                  </Badge>
                )}
                {c.unreadCount > 0 && (
                  <span className="ml-auto inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                    {c.unreadCount}
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
