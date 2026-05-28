// Spare parts — split-view workspace (master list left · detail/add right).
// CEO feedback: "หน้าเพิ่มอะไหล่ + หน้ารายการ เอามารวมดูแบบซ้ายขวาได้".
// URL state `?selected=` drives the right pane (Server Component friendly):
//   - selected=new        → add form (reuses NewPartForm + createPart action)
//   - selected=<partId>   → that part's detail (reuses edit / adjust forms)
//   - (none)              → empty state
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { baht } from "@/lib/chairops/utils/format";
import { Prisma } from "@/lib/generated/prisma/client";
import { PartDetailPane } from "./part-detail-pane";
import { PartAddPane } from "./part-add-pane";

export default async function PartsWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; selected?: string }>;
}) {
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const selected = sp.selected?.trim() || undefined;

  // orgId on EVERY query (cross-org leak was P0 this session).
  const w: Prisma.ChairopsSparePartWhereInput = { orgId };
  if (q) {
    w.OR = [
      { partCode: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }

  const parts = await prisma.chairopsSparePart.findMany({
    where: w,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 500,
  });

  const lowCount = parts.filter((p) => p.stockOnHand <= p.reorderLevel).length;

  // Build the right pane based on `?selected=`.
  let rightPane: React.ReactNode;
  if (selected === "new") {
    rightPane = <PartAddPane />;
  } else if (selected) {
    rightPane = <PartDetailPane partId={selected} orgId={orgId} />;
  } else {
    rightPane = (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="text-4xl">🔧</div>
        <p className="text-sm text-muted-foreground">
          เลือกอะไหล่จากซ้าย หรือ กดเพิ่มใหม่
        </p>
        <Link href="/chairops/parts?selected=new">
          <Button variant="outline">＋ เพิ่มอะไหล่ใหม่</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">อะไหล่</h1>
          <p className="text-sm text-muted-foreground">
            ทั้งหมด {parts.length} รายการ
            {lowCount > 0 && (
              <span className="ml-2 text-danger">
                · {lowCount} รายการสต็อกต่ำกว่าจุดสั่งซื้อ
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Roomy 2-pane: list needs partCode + name + stock columns, so a 360px
          rail is more legible than MasterDetailShell's 260px sidebar. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* LEFT — searchable master list */}
        <div className="rounded-lg border border-border bg-card">
          <div className="sticky top-14 z-10 space-y-2 rounded-t-lg border-b border-border bg-card p-3 sm:top-16">
            <Link href="/chairops/parts?selected=new" className="block">
              <Button className="w-full">＋ เพิ่มอะไหล่ใหม่</Button>
            </Link>
            <form method="GET" className="flex gap-2">
              {/* keep current selection while searching */}
              {selected && (
                <input type="hidden" name="selected" value={selected} />
              )}
              <input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="ค้นหา รหัส / ชื่อ"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
              <button
                type="submit"
                className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                ค้นหา
              </button>
            </form>
          </div>

          <ul className="max-h-[calc(100dvh-16rem)] divide-y divide-border overflow-y-auto">
            {parts.length === 0 ? (
              <li className="px-3 py-12 text-center text-sm text-muted-foreground">
                {q ? "ไม่พบอะไหล่ที่ค้นหา" : "ยังไม่มีอะไหล่"}
              </li>
            ) : (
              parts.map((p) => {
                const low = p.stockOnHand <= p.reorderLevel;
                const active = selected === p.id;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/chairops/parts?selected=${p.id}${
                        q ? `&q=${encodeURIComponent(q)}` : ""
                      }`}
                      aria-current={active ? "true" : undefined}
                      className={
                        "flex items-center justify-between gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 " +
                        (active ? "bg-muted" : "")
                      }
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {p.partCode}
                          {p.category ? ` · ${p.category}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold">
                          {p.stockOnHand.toLocaleString("en-US")}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {p.unit}
                          </span>
                        </div>
                        {low ? (
                          <Badge tone="danger" className="mt-0.5 text-[10px]">
                            ต่ำ
                          </Badge>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            {p.unitPrice != null ? baht(p.unitPrice) : "—"}
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* RIGHT — detail / add / empty */}
        <div className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-6">
          {rightPane}
        </div>
      </div>
    </div>
  );
}
