import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { listCustomers, type CustomerFilter } from "@/lib/fuelos/customers-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { formatBaht, bkkRelative } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { Plus, Search, AlertTriangle, Sparkles } from "lucide-react";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = (["all", "overdue", "prospect", "mine"].includes(sp.filter ?? "") ? sp.filter : "all") as CustomerFilter;
  const list = await listCustomers(user.orgId, { filter, q: sp.q, userId: user.id });

  const tabs = [
    { key: "all", label: "ทั้งหมด" },
    { key: "mine", label: "ของฉัน" },
    { key: "overdue", label: "เกินรอบซื้อ" },
    { key: "prospect", label: "ลูกค้าใหม่" },
  ];

  return (
    <div>
      <PageHeader
        title="ลูกค้า"
        subtitle={`${list.length} ราย`}
        actions={
          <Link href="/customers/new" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-medium">
            <Plus className="size-4" /> เพิ่มลูกค้า
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1.5">
          {tabs.map((t) => (
            <Link key={t.key} href={`/customers?filter=${t.key}`}
              className={cn("px-3 h-9 rounded-lg text-sm font-medium inline-flex items-center", filter === t.key ? "bg-brand-600 text-white" : "bg-surface border border-border text-zinc-600")}>
              {t.label}
            </Link>
          ))}
        </div>
        <form className="ml-auto relative" action="/customers">
          <input type="hidden" name="filter" value={filter} />
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="ค้นหาลูกค้า…"
            className="h-9 w-48 sm:w-64 rounded-lg border border-border bg-surface pl-9 pr-3 text-sm" />
        </form>
      </div>

      <div className="grid gap-2">
        {list.length === 0 && <div className="text-center text-zinc-400 py-10 text-sm">ไม่พบลูกค้า</div>}
        {list.map((c) => {
          const pct = c.creditLimit ? Math.min(100, Math.round((c.creditUsed / c.creditLimit) * 100)) : 0;
          return (
            <Link key={c.id} href={`/customers/${c.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 hover:shadow-sm transition-shadow">
              <div className="size-11 rounded-full bg-brand-100 text-brand-700 grid place-items-center font-bold shrink-0">{c.name.slice(0, 1)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{c.name}</span>
                  {c.overdue && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning"><AlertTriangle className="size-3" />เกินรอบ</span>}
                  {c.isProspect && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-info/10 text-info"><Sparkles className="size-3" />ใหม่</span>}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 truncate">
                  {c.zone ? `โซน ${c.zone}` : "—"} · {c.owner ?? "ไม่มีเจ้าของ"}
                  {c.lastOrderAt ? ` · ซื้อล่าสุด ${bkkRelative(c.lastOrderAt)}` : " · ยังไม่เคยซื้อ"}
                </div>
              </div>
              {c.creditLimit != null && (
                <div className="hidden sm:block w-32 shrink-0">
                  <div className="text-[11px] text-zinc-500 mb-1 text-right">{formatBaht(c.creditUsed)} / {formatBaht(c.creditLimit)}</div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className={cn("h-full rounded-full", pct > 90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-leaf-500")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
