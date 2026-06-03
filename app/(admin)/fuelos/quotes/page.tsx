import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { listQuotes, countByStatus, parseQuoteFilter } from "@/lib/fuelos/quotes-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { formatBaht, bkkDate } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { QUOTE_STATUS } from "./quote-status";
import { Plus, FileText, Sparkles } from "lucide-react";

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "PENDING", label: "รอผล" },
  { key: "WON", label: "ชนะ" },
  { key: "LOST", label: "แพ้" },
  { key: "DECLINED", label: "ปฏิเสธ" },
  { key: "NO_RESPONSE", label: "ไม่ตอบ" },
];

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = parseQuoteFilter(sp.status);
  const [list, counts] = await Promise.all([
    listQuotes(user.orgId, filter),
    countByStatus(user.orgId),
  ]);

  return (
    <div>
      <PageHeader
        title="ใบเสนอราคา"
        subtitle={`${counts.all ?? 0} ใบ`}
        actions={
          <Link
            href="/quotes/new"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-medium"
          >
            <Plus className="size-4" /> สร้างใบเสนอราคา
          </Link>
        }
      />

      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const active = filter === t.key;
          const count = counts[t.key] ?? 0;
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? "/quotes" : `/quotes?status=${t.key}`}
              className={cn(
                "shrink-0 px-3 h-9 rounded-lg text-sm font-medium inline-flex items-center gap-1.5",
                active ? "bg-brand-600 text-white" : "bg-surface border border-border text-zinc-600",
              )}
            >
              {t.label}
              <span className={cn("text-[11px] tabular-nums", active ? "text-white/70" : "text-zinc-400")}>{count}</span>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-2">
        {list.length === 0 && (
          <div className="text-center text-zinc-400 py-12 text-sm">
            <FileText className="size-8 mx-auto mb-2 opacity-40" />
            ยังไม่มีใบเสนอราคา
          </div>
        )}
        {list.map((q) => {
          const s = QUOTE_STATUS[q.status];
          return (
            <Link
              key={q.id}
              href={`/quotes/${q.id}`}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 hover:shadow-sm transition-shadow"
            >
              <div className="size-11 rounded-xl bg-brand-50 text-brand-600 grid place-items-center shrink-0">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{q.name}</span>
                  {q.isProspect && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-info/10 text-info shrink-0">
                      <Sparkles className="size-3" /> ผู้สนใจใหม่
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 truncate font-[family-name:var(--font-plex-mono)]">
                  {q.quoteNo} · {bkkDate(q.quoteDate)} · {q.sales}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold tabular-nums">{formatBaht(q.subtotal)}</div>
                <span className={cn("inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full", s.tone)}>{s.label}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
