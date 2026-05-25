// Exec Home · ChairOps (W1 · claude-design Phase 2)
// Spec: /tmp/claude-design_chairops_plan.md §W1
// Audit ref: docs/AUDIT_chairops_2026-05-25.md §3 row "/chairops (executive home)"
//
// CEO 10-min morning scan layout:
//   • 5 KPI tiles (2x3 on sm · 5-col strip on md+ per OWN Phase 3 critique)
//   • Branches leaderboard (worst-shortage first · click → reconcile detail)
//   • Recent critical alerts inline (top 5 · link to /alerts for the rest)
//
// Defense-in-depth: (office)/layout.tsx already gates OFFICE+ · we re-call
// requireRole here so streamed nested renders never trust shell state.

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { ChairopsKpiTile } from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import { baht, thaiRelative } from "@/lib/chairops/utils/format";
import { getExecHomeKpis } from "@/lib/chairops/queries/exec-home";
import {
  ChairopsAlertLevel,
  ChairopsAlertStatus,
} from "@/lib/generated/prisma/enums";
import {
  AlertTriangle,
  Banknote,
  Bell,
  Building2,
  Coins,
  RefreshCcw,
} from "lucide-react";
import { BranchesLeaderboard } from "./_components/branches-leaderboard";

export const dynamic = "force-dynamic";

const ALERT_LEVEL_TONE: Record<
  ChairopsAlertLevel,
  "danger" | "warning" | "neutral"
> = {
  CRITICAL: "danger",
  WARN: "warning",
  INFO: "neutral",
};

export default async function ExecHomePage() {
  const session = await requireRole("OFFICE");
  const kpis = await getExecHomeKpis();

  // Recent critical/warn alerts — cheap read · 5 rows for at-a-glance triage.
  // Full alerts UI lives at /chairops/alerts (W4).
  const recentAlerts = await prisma.chairopsAlert.findMany({
    where: {
      status: {
        in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK],
      },
    },
    orderBy: [{ level: "desc" }, { createdAt: "desc" }],
    take: 5,
    include: { branch: { select: { name: true, slug: true, id: true } } },
  });

  // Leaderboard top 10 worst-shortage. Full branch list lives in (office)/reconcile.
  const leaderboardRows = kpis.branches
    .filter((r) => r.isActive)
    .slice(0, 10);

  const driftTone =
    kpis.cumulativeDriftTotal > 0 ? "danger" : "success";
  const shortageTone =
    kpis.shortageBranchCount > 0 ? "danger" : "success";
  const alertTone =
    kpis.criticalOpenAlertCount > 0 ? "danger" : "success";

  return (
    <div className="flex flex-col gap-6">
      {/* page header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-zinc-500">
            สวัสดี · {session.user.displayName}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">
            สรุปภาพรวม ChairOps
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {kpis.activeBranchCount.toLocaleString("th-TH")} สาขาทำการ ·
            อัพเดทล่าสุด {thaiRelative(kpis.computedAt)}
          </p>
        </div>
        <Link
          href="/chairops"
          className="inline-flex h-9 items-center gap-1.5 self-start rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted sm:self-auto"
        >
          <RefreshCcw className="size-3.5" aria-hidden="true" />
          รีเฟรช
        </Link>
      </header>

      {/* KPI strip — 2x3 on mobile · 5-col strip on md+ per OWN Phase 3 */}
      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-5 md:gap-4"
        aria-label="ตัวชี้วัดวันนี้"
      >
        <ChairopsKpiTile
          label="ยอดขาย POS วันนี้"
          value={baht(kpis.todayPosRevenue)}
          tone="info"
          icon={<Banknote className="size-4" aria-hidden="true" />}
          href="/chairops/pos-ingest"
        />
        <ChairopsKpiTile
          label="ฝากแม่บ้านวันนี้"
          value={baht(kpis.todayDepositTotal)}
          tone="neutral"
          icon={<Coins className="size-4" aria-hidden="true" />}
          href="/chairops/reconcile"
        />
        <ChairopsKpiTile
          label="ยอดขาดสุทธิ"
          value={
            kpis.cumulativeDriftTotal > 0
              ? `-${kpis.cumulativeDriftTotal.toLocaleString("th-TH")}`
              : baht(0)
          }
          unit={kpis.cumulativeDriftTotal > 0 ? "บาท" : undefined}
          tone={driftTone}
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          href="/chairops/reconcile"
        />
        <ChairopsKpiTile
          label="สาขามี shortage"
          value={kpis.shortageBranchCount}
          unit="สาขา"
          tone={shortageTone}
          icon={<Building2 className="size-4" aria-hidden="true" />}
          href="/chairops/reconcile"
        />
        <ChairopsKpiTile
          label="Alerts P0 ค้าง"
          value={kpis.criticalOpenAlertCount}
          unit="รายการ"
          tone={alertTone}
          icon={<Bell className="size-4" aria-hidden="true" />}
          href="/chairops/alerts?level=CRITICAL"
        />
      </section>

      {/* Branches leaderboard */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground sm:text-lg">
              สาขาที่ต้องเข้าดูก่อน
            </h2>
            <p className="text-xs text-muted-foreground">
              10 อันดับขาดสะสมมากสุด · คลิกแถวเพื่อเปิด timeline
            </p>
          </div>
          <Link
            href="/chairops/reconcile"
            className="text-sm font-medium text-primary hover:underline"
          >
            ดูทั้งหมด →
          </Link>
        </div>
        <BranchesLeaderboard rows={leaderboardRows} />
      </section>

      {/* Recent alerts */}
      <section className="rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground sm:text-lg">
              แจ้งเตือนล่าสุด
            </h2>
            <p className="text-xs text-muted-foreground">
              เปิด/รับทราบอยู่ · เรียงตามความรุนแรง
            </p>
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
                <StatusPill
                  tone={ALERT_LEVEL_TONE[a.level]}
                  size="xs"
                  dot
                  className="mt-0.5 shrink-0"
                >
                  {a.level}
                </StatusPill>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <p className="truncate text-sm font-medium text-foreground">
                      {a.title}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {thaiRelative(a.createdAt)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.message}
                  </p>
                  {a.branch && (
                    <Link
                      href={`/chairops/reconcile/${a.branch.id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {a.branch.name} →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
