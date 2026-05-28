// View mode toggle — List ↔ Kanban
// Used in both /recruit (inbox) and /recruit/pipeline pages
// Preserves all current filters (status, posting, query) via search params

import Link from "next/link";
import { Inbox, KanbanSquare } from "lucide-react";

interface Props {
  current: "list" | "kanban";
  listHref: string;
  kanbanHref: string;
}

export function ViewToggle({ current, listHref, kanbanHref }: Props) {
  return (
    <div className="inline-flex items-center rounded-xl border border-zinc-200 bg-zinc-50/40 p-0.5">
      <Link
        href={listHref}
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-bold rounded-lg transition-colors ${
          current === "list"
            ? "bg-white text-zinc-900 shadow-sm"
            : "text-zinc-500 hover:text-zinc-900"
        }`}
        title="ดูแบบรายการ"
      >
        <Inbox className="size-3.5" />
        List
      </Link>
      <Link
        href={kanbanHref}
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-bold rounded-lg transition-colors ${
          current === "kanban"
            ? "bg-white text-zinc-900 shadow-sm"
            : "text-zinc-500 hover:text-zinc-900"
        }`}
        title="ดูแบบ Kanban"
      >
        <KanbanSquare className="size-3.5" />
        Kanban
      </Link>
    </div>
  );
}
