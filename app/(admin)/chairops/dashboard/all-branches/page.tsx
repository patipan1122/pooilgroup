// All-branches card grid · TV/showcase view · grouped by mall
import Link from "next/link";
import { getDashboardRows } from "@/lib/chairops/reconcile/drift-engine";
import { baht } from "@/lib/chairops/utils/format";
import {
  StatusBadge,
  deriveStatus,
  formatAgeThai,
} from "../_components/status-badge";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

function tileTone(status: ReturnType<typeof deriveStatus>): string {
  switch (status) {
    case "shortage":
    case "missed":
      return "bg-danger/10 border-danger/40";
    case "watch":
    case "surplus":
      return "bg-warning/10 border-warning/40";
    case "inactive":
      return "bg-muted border-border";
    case "ok":
    default:
      return "bg-success/5 border-success/30";
  }
}

export default async function AllBranchesGrid() {
  const rows = await getDashboardRows();

  // Group by mall (fallback "อื่นๆ")
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.mallGroup ?? "อื่นๆ";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "th"));

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/chairops/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← กลับสรุปภาพรวม
        </Link>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">สาขาทั้งหมด</h1>
        <p className="text-sm text-muted-foreground">
          มุมมองตามห้าง · เหมาะสำหรับจอใหญ่/ดูสรุปไว ({rows.length} สาขา)
        </p>
      </div>

      {sortedGroups.map(([mall, list]) => (
        <section key={mall}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{mall}</span>
            <span className="text-xs font-normal">({list.length})</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((r) => {
              const status = deriveStatus({
                isActive: r.isActive,
                driftAmount: r.driftAmount,
                driftHours: r.driftHours,
                daysSinceLastCollection: r.daysSinceLastCollection,
              });
              return (
                <Link
                  key={r.branchId}
                  href={`/chairops/dashboard/${r.branchSlug}`}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-shadow hover:shadow-md",
                    tileTone(status)
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.branchName}</p>
                      <p className="text-xs text-muted-foreground">{r.floor ?? "—"}</p>
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <span className="text-muted-foreground">POS</span>
                    <span className="text-right font-semibold tabular-nums">
                      {baht(r.posTotal)}
                    </span>
                    <span className="text-muted-foreground">ฝาก</span>
                    <span className="text-right font-semibold tabular-nums">
                      {baht(r.depositTotal)}
                    </span>
                    <span className="text-muted-foreground">DRIFT</span>
                    <span
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        r.driftAmount > 0
                          ? "text-[hsl(0,84%,40%)]"
                          : r.driftAmount < -100
                          ? "text-[hsl(38,92%,32%)]"
                          : ""
                      )}
                    >
                      {baht(r.driftAmount, true)}
                    </span>
                    {r.driftAmount > 0 ? (
                      <>
                        <span className="text-muted-foreground">อายุ</span>
                        <span className="text-right text-muted-foreground">
                          {formatAgeThai(r.driftHours)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
