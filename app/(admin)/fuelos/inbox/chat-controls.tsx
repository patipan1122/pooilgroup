"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignConv, setSegment } from "./actions";
import type { ConvSegment } from "@/lib/generated/prisma/enums";

export function ChatControls({
  convId,
  segment,
  assigneeId,
  salesUsers,
}: {
  convId: string;
  segment: ConvSegment;
  assigneeId: string | null;
  salesUsers: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-surface overflow-x-auto">
      <span className="text-[11px] text-zinc-400 shrink-0">กลุ่ม:</span>
      <select
        defaultValue={segment} disabled={pending}
        onChange={(e) => start(async () => { await setSegment(convId, e.target.value as ConvSegment); router.refresh(); })}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-xs shrink-0"
      >
        <option value="NEW">ลูกค้าใหม่</option>
        <option value="OLD">ลูกค้าเก่า</option>
        <option value="PRICE_CHECK">เช็คราคา</option>
      </select>
      <span className="text-[11px] text-zinc-400 shrink-0 ml-1">ผู้ดูแล:</span>
      <select
        defaultValue={assigneeId ?? ""} disabled={pending}
        onChange={(e) => start(async () => { await assignConv(convId, e.target.value); router.refresh(); })}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-xs shrink-0"
      >
        <option value="">— ยังไม่มอบหมาย —</option>
        {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </div>
  );
}
