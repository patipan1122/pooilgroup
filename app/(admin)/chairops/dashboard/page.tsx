// CEO HOME — single scrollable view: KPI tiles + 30-branch table + recent alerts
// Server Component · all data fetched server-side · no client fetches
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDashboardRows } from "@/lib/chairops/reconcile/drift-engine";
import { baht, thaiRelative, ageHours } from "@/lib/chairops/utils/format";
import { BranchesTable } from "./_components/branches-table";
import { KpiTile } from "./_components/kpi-tile";
import { RefreshButton } from "./_components/refresh-button";
import { Badge } from "@/components/chairops/ui/badge";

export const dynamic = "force-dynamic";

const ALERT_LEVEL_VARIANT = {
  CRITICAL: "danger" as const,
  WARN: "warning" as const,
  INFO: "secondary" as const,
};

export default async function DashboardHome() {
  // Today (Asia/Bangkok day boundary) — naive UTC midnight is fine for daily aggregate
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [rows, todaysPos, openDamageOverdue, recentAlerts] = await Promise.all([
    getDashboardRows(),
    prisma.chairopsPosDaily.aggregate({
      where: { bizDate: { gte: todayStart } },
      _sum: { totalRevenue: true },
    }),
    prisma.chairopsDamageTicket.findMany({
      where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS"] } },
      select: { id: true, openedAt: true },
    }),
    prisma.chairopsAlert.findMany({
      where: { status: { in: ["OPEN", "ACK"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { branch: { select: { name: true, slug: true } } },
    }),
  ]);

  const shortageCount = rows.filter(
    (r) => r.isActive && r.driftAmount > 0 && r.driftHours >= 24
  ).length;
  const missedCount = rows.filter(
    (r) => r.isActive && r.daysSinceLastCollection > 1
  ).length;
  const damageOverdueCount = openDamageOverdue.filter(
    (t) => ageHours(t.openedAt) > 48
  ).length;
  const todayRevenue = todaysPos._sum.totalRevenue ?? 0;
  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">สรุปภาพรวม</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount} สาขาทำการ · อัพเดทล่าสุดเมื่อรีเฟรชหน้า
          </p>
        </div>
        <RefreshButton />
      </div>

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile
          label="สาขามีปัญหาเงิน"
          value={shortageCount}
          hint="เงินขาดเกิน 24 ชม."
          tone="red"
        />
        <KpiTile
          label="แม่บ้านไม่ส่งยอด"
          value={missedCount}
          hint="ค้างเกิน 1 วัน"
          tone="orange"
        />
        <KpiTile
          label="ของเสียค้าง 48 ชม.+"
          value={damageOverdueCount}
          hint="ตั๋วซ่อมเปิดอยู่"
          tone="yellow"
        />
        <KpiTile
          label="POS วันนี้รวม"
          value={baht(todayRevenue)}
          hint="ทุกสาขา · วันนี้"
          tone="green"
        />
      </section>

      {/* 30-branch table */}
      <section>
        <BranchesTable rows={rows} />
      </section>

      {/* Recent alerts */}
      <section className="rounded-xl border border-border bg-background p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold sm:text-lg">แจ้งเตือนล่าสุด</h2>
            <p className="text-xs text-muted-foreground">10 รายการที่ยังเปิด/รับทราบอยู่</p>
          </div>
          <Link
            href="/chairops/alerts"
            className="text-sm font-medium text-primary hover:underline"
          >
            ดูทั้งหมด →
          </Link>
        </div>
        {recentAlerts.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            ไม่มี alert ค้าง · ทุกสาขาราบรื่น
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {recentAlerts.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-3">
                <Badge variant={ALERT_LEVEL_VARIANT[a.level]} className="mt-0.5 shrink-0">
                  {a.level}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {thaiRelative(a.createdAt)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{a.message}</p>
                  {a.branch ? (
                    <Link
                      href={`/chairops/dashboard/${a.branch.slug}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {a.branch.name} →
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
