// Reconcile dashboard — per-branch table with drift status
// Pulls `getDashboardRows()` from drift-engine · sortable by clicking column headers (URL-driven).
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { OfficeShell } from "@/app/(admin)/chairops/dashboard-office/layout";
import { Badge } from "@/components/chairops/ui/badge";
import { Button } from "@/components/chairops/ui/button";
import { baht, thaiDate, thaiRelative } from "@/lib/chairops/utils/format";
import { getDashboardRows, recomputeAllDrifts } from "@/lib/chairops/reconcile/drift-engine";

type SortKey = "drift" | "age" | "lastCollection" | "branch" | "deposit" | "pos";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "drift", label: "DRIFT" },
  { key: "age", label: "อายุ DRIFT" },
  { key: "lastCollection", label: "วันที่เก็บล่าสุด" },
  { key: "pos", label: "POS รวม" },
  { key: "deposit", label: "ฝากรวม" },
  { key: "branch", label: "สาขา" },
];

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; recompute?: string; q?: string }>;
}) {
  const session = await requireRole("OFFICE");
  const sp = await searchParams;
  const sort = (sp.sort ?? "drift") as SortKey;
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const q = (sp.q ?? "").trim().toLowerCase();

  // Optional manual recompute trigger via ?recompute=1
  if (sp.recompute === "1") {
    await recomputeAllDrifts();
  }

  let rows = await getDashboardRows();
  if (q) {
    rows = rows.filter(
      (r) =>
        r.branchName.toLowerCase().includes(q) ||
        r.branchSlug.toLowerCase().includes(q) ||
        (r.mallGroup ?? "").toLowerCase().includes(q)
    );
  }

  rows = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case "drift":
        cmp = a.driftAmount - b.driftAmount;
        break;
      case "age":
        cmp = a.driftHours - b.driftHours;
        break;
      case "lastCollection": {
        const at = a.lastCollectionAt ? a.lastCollectionAt.getTime() : 0;
        const bt = b.lastCollectionAt ? b.lastCollectionAt.getTime() : 0;
        cmp = at - bt;
        break;
      }
      case "pos":
        cmp = a.posTotal - b.posTotal;
        break;
      case "deposit":
        cmp = a.depositTotal - b.depositTotal;
        break;
      case "branch":
        cmp = a.branchName.localeCompare(b.branchName, "th");
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });

  const summary = {
    branches: rows.length,
    totalDrift: rows.reduce((s, r) => s + Math.max(r.driftAmount, 0), 0),
    shortageBranches: rows.filter((r) => r.driftAmount > 0 && r.driftHours >= 24).length,
    missedBranches: rows.filter((r) => r.daysSinceLastCollection > 1).length,
  };

  return (
    <OfficeShell session={session} active="/chairops/reconcile">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ตรวจยอด (Reconcile)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            drift = ΣPOS − Σแม่บ้านฝาก · เรียงจากค้างมากสุดก่อน · คลิกหัวคอลัมน์เพื่อเรียงใหม่
          </p>
        </div>
        <Link
          href="/chairops/reconcile?recompute=1"
          className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
        >
          🔄 Recompute ทุกสาขา
        </Link>
      </div>

      {/* search */}
      <form className="mb-3" action="/chairops/reconcile" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="ค้นหาชื่อสาขา / slug / mall"
          className="h-9 w-full max-w-md rounded-md border border-border bg-background px-3 text-sm"
        />
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
      </form>

      {/* summary tiles */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="สาขาทั้งหมด" value={summary.branches.toString()} />
        <Tile label="DRIFT รวมขาด" value={baht(summary.totalDrift)} tone="danger" />
        <Tile label="สาขามี shortage" value={summary.shortageBranches.toString()} tone="warning" />
        <Tile label="สาขาแม่บ้านไม่ส่ง" value={summary.missedBranches.toString()} tone="warning" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="sticky top-14 z-20 bg-muted text-xs uppercase text-muted-foreground">
            <tr className="text-left">
              <SortHeader current={sort} dir={dir} sortKey="branch" align="left">
                สาขา
              </SortHeader>
              <SortHeader current={sort} dir={dir} sortKey="pos" align="right">
                POS รวม
              </SortHeader>
              <SortHeader current={sort} dir={dir} sortKey="deposit" align="right">
                ฝากรวม
              </SortHeader>
              <SortHeader current={sort} dir={dir} sortKey="drift" align="right">
                DRIFT
              </SortHeader>
              <SortHeader current={sort} dir={dir} sortKey="age" align="right">
                อายุ DRIFT
              </SortHeader>
              <SortHeader current={sort} dir={dir} sortKey="lastCollection" align="left">
                เก็บล่าสุด
              </SortHeader>
              <th className="px-2 py-2 font-medium">สถานะ</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                  ยังไม่มีข้อมูล drift · ลอง <Link href="/chairops/reconcile?recompute=1" className="underline">recompute</Link> ก่อน
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const status = classifyDrift(r);
              return (
                <tr key={r.branchId} className="hover:bg-muted/40">
                  <td className="px-2 py-2">
                    <div className="font-medium">{r.branchName}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.mallGroup ?? "—"} {r.floor ? `· ${r.floor}` : ""}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{baht(r.posTotal)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{baht(r.depositTotal)}</td>
                  <td
                    className={
                      "px-2 py-2 text-right tabular-nums font-semibold " +
                      (r.driftAmount > 0
                        ? "text-[hsl(0,84%,48%)]"
                        : r.driftAmount < -100
                          ? "text-[hsl(38,92%,38%)]"
                          : "text-foreground")
                    }
                  >
                    {baht(r.driftAmount, true)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                    {r.driftAmount > 0 ? `${r.driftHours} ชม.` : "—"}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {r.lastCollectionAt ? (
                      <>
                        <div>{thaiDate(r.lastCollectionAt)}</div>
                        <div className="text-xs">{thaiRelative(r.lastCollectionAt)}</div>
                      </>
                    ) : (
                      <span className="text-danger">ไม่เคยเก็บ</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Link
                      href={`/chairops/reconcile/${r.branchId}`}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    >
                      เปิด timeline →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </OfficeShell>
  );
}

function classifyDrift(r: { driftAmount: number; driftHours: number; daysSinceLastCollection: number }): {
  label: string;
  variant: "success" | "warning" | "danger" | "secondary";
} {
  if (r.daysSinceLastCollection > 1) return { label: "แม่บ้านไม่ส่ง", variant: "danger" };
  if (r.driftAmount > 0 && r.driftHours >= 24) return { label: "shortage", variant: "danger" };
  if (r.driftAmount > 0) return { label: "ค้าง <24 ชม.", variant: "warning" };
  if (r.driftAmount < -100) return { label: "ส่วนเกิน?", variant: "warning" };
  return { label: "OK", variant: "success" };
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  const toneClass =
    tone === "danger" ? "text-[hsl(0,84%,48%)]" : tone === "warning" ? "text-[hsl(38,92%,38%)]" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function SortHeader({
  current,
  dir,
  sortKey,
  align,
  children,
}: {
  current: SortKey;
  dir: "asc" | "desc";
  sortKey: SortKey;
  align: "left" | "right";
  children: React.ReactNode;
}) {
  const isActive = current === sortKey;
  const nextDir = isActive ? (dir === "asc" ? "desc" : "asc") : sortKey === "branch" ? "asc" : "desc";
  const _ignored = SORTS;
  void _ignored;
  return (
    <th className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <Link
        href={`/chairops/reconcile?sort=${sortKey}&dir=${nextDir}`}
        className={isActive ? "text-foreground" : "hover:text-foreground"}
      >
        {children} {isActive ? (dir === "asc" ? "↑" : "↓") : ""}
      </Link>
    </th>
  );
}
