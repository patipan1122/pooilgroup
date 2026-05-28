// Exec Dashboard · ChairOps (mockup-100% rebuild · bigfeature 2026-05-28)
// Spec: /tmp/chairops-bigfeature/MOCKUP_SPEC.md §B Dashboard + GOAL_LOCK.md
// Mockup: _design-reference/chairops-mockup-2026-05-28/jsx/screens/dashboard.jsx
//
// Layout (matches mockup exactly):
//   • Page head — breadcrumb + title + date chip + Export + อัพ POS
//   • Attention strip — red banner (conditional: only if critical/missed/drift)
//   • 5 KPI tile strip (auto-fit minmax(180px,1fr))
//   • 2-col grid — LEFT (2/3) critical branches table · RIGHT (1/3) missed maids + alerts
//   • System status footer — cron labels + POS imports today + events today
//
// Defense-in-depth: (office)/layout.tsx already gates OFFICE+ entitlement & role.
// We re-call requireRole here so streamed nested renders never trust shell state.
// Module entitlement enforced by layout — not re-checked here per task brief.

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import {
  ChairopsKpiTile,
  StatusDot,
} from "@/components/chairops/_kit";
import {
  baht,
  thaiDate,
  thaiDateLong,
  thaiRelative,
} from "@/lib/chairops/utils/format";
import {
  getExecHomeKpis,
  getCriticalBranches,
  getMissedMaidsToday,
  getRecentAlerts,
  getSystemStatus,
  MAID_CUTOFF_HOUR,
} from "@/lib/chairops/queries/exec-home";
import { ChairopsAlertLevel } from "@/lib/generated/prisma/enums";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Calendar,
  Coins,
  Download,
  Info,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";
import { CriticalBranchesTable } from "./_components/critical-branches-table";
import { MissedMaidsCard } from "./_components/missed-maids-card";

export const dynamic = "force-dynamic";

const ALERT_SEV_STYLE: Record<
  ChairopsAlertLevel,
  { box: string; icon: typeof AlertTriangle }
> = {
  CRITICAL: { box: "bg-rose-50 text-rose-600", icon: AlertTriangle },
  WARN: { box: "bg-amber-50 text-amber-600", icon: AlertTriangle },
  INFO: { box: "bg-blue-50 text-blue-600", icon: Info },
};

function pctLabel(pct: number | null): {
  text: string;
  dir: "up" | "down" | "flat";
} {
  if (pct == null) return { text: "—", dir: "flat" };
  const dir = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  const sign = pct > 0 ? "+" : "";
  return { text: `${sign}${pct.toFixed(1)}%`, dir };
}

function cutoffCountdownLabel(): string {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(MAID_CUTOFF_HOUR, 0, 0, 0);
  const diffMs = cutoff.getTime() - now.getTime();
  if (diffMs <= 0) return "เลยเวลาแล้ว";
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `เหลือ ${h} ชม. ${m} นาที`;
}

export default async function ExecDashboardPage() {
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;

  const [kpis, criticalBranches, missedMaids, recentAlerts, systemStatus] =
    await Promise.all([
      getExecHomeKpis(orgId),
      getCriticalBranches(orgId, { take: 8 }),
      getMissedMaidsToday(orgId, { take: 5 }),
      getRecentAlerts(orgId, { take: 5 }),
      getSystemStatus(orgId),
    ]);

  const posDelta = pctLabel(kpis.posDeltaPct);
  const profitDelta = pctLabel(kpis.profit30dDeltaPct);
  const driftTone = kpis.cumulativeDriftTotal > 0 ? "danger" : "success";

  // Attention strip only renders when there's actually something to flag.
  const showAttention =
    kpis.shortageBranchCount > 0 ||
    kpis.missedMaidCount > 0 ||
    kpis.cumulativeDriftTotal > 0;

  const driftSigned =
    kpis.cumulativeDriftTotal > 0
      ? `+${kpis.cumulativeDriftTotal.toLocaleString("en-US")} ฿`
      : "0 ฿";

  return (
    <div className="flex flex-col gap-4">
      {/* page head */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <nav className="mb-1 flex items-center gap-1 text-xs text-zinc-500">
            <span>ChairOps</span>
            <span aria-hidden="true">›</span>
            <span className="font-medium text-zinc-700">Dashboard</span>
          </nav>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            สวัสดี · เช้านี้มีอะไรต้องดู
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {thaiDateLong(kpis.computedAt)} ·{" "}
            {kpis.activeBranchCount.toLocaleString("th-TH")} สาขาทำการ · อัพเดท{" "}
            {thaiRelative(kpis.computedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700">
            <Calendar className="size-3" aria-hidden="true" />
            {thaiDate(kpis.computedAt, "d MMM")}
          </span>
          <Link
            href="/chairops/reports"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <Download className="size-3" aria-hidden="true" />
            Export
          </Link>
          <Link
            href="/chairops/pos-ingest/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <Upload className="size-3" aria-hidden="true" />
            อัพ POS
          </Link>
        </div>
      </header>

      {/* attention strip (conditional) */}
      {showAttention && (
        <Link
          href="/chairops/alerts"
          className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] transition-colors hover:bg-rose-100/70"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full border border-rose-200 bg-white text-rose-600">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
          </span>
          <span className="flex-1">
            <span className="font-semibold text-zinc-900">
              {kpis.shortageBranchCount} สาขาวิกฤต ·{" "}
              {kpis.missedMaidCount} แม่บ้านยังไม่ส่งยอด
            </span>
            <span className="text-zinc-500">
              {" "}
              · drift รวมวันนี้ {driftSigned}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700">
            ดู alerts ทั้งหมด <ArrowRight className="size-3" aria-hidden="true" />
          </span>
        </Link>
      )}

      {/* KPI strip — auto-fit minmax(180px, 1fr) */}
      <section
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
        aria-label="ตัวชี้วัดวันนี้"
      >
        <ChairopsKpiTile
          label="POS วันนี้"
          value={baht(kpis.todayPosRevenue)}
          tone="info"
          icon={<Banknote className="size-4" aria-hidden="true" />}
          delta={`${posDelta.text} vs. 7 วันก่อน`}
          deltaDirection={posDelta.dir}
          href="/chairops/pos-ingest"
        />
        <ChairopsKpiTile
          label="ฝากแม่บ้านวันนี้"
          value={baht(kpis.todayDepositTotal)}
          tone="neutral"
          icon={<Coins className="size-4" aria-hidden="true" />}
          delta={`${kpis.depositedBranchCount}/${kpis.activeBranchCount} สาขาส่งแล้ว`}
          href="/chairops/reconcile"
        />
        <ChairopsKpiTile
          label="DRIFT รวม"
          value={driftSigned}
          tone={driftTone}
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          delta={`POS − ฝาก · ${kpis.shortageBranchDays} วันสาขา-วัน`}
          href="/chairops/reconcile"
        />
        <ChairopsKpiTile
          label="แม่บ้านยังไม่ส่ง"
          value={kpis.missedMaidCount}
          unit="คน"
          tone="warning"
          icon={<Users className="size-4" aria-hidden="true" />}
          delta={`ตัด cut-off ${MAID_CUTOFF_HOUR}:00 · ${cutoffCountdownLabel()}`}
          href="/chairops/reconcile"
        />
        <ChairopsKpiTile
          label="กำไร 30 วัน"
          value={baht(kpis.profit30d)}
          tone="success"
          icon={<TrendingUp className="size-4" aria-hidden="true" />}
          delta={`${profitDelta.text} หลังหักต้นทุนสาขา`}
          deltaDirection={profitDelta.dir}
          href="/chairops/reports"
        />
      </section>

      {/* main 2-col grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* LEFT 2/3 */}
        <div className="lg:col-span-2">
          <CriticalBranchesTable rows={criticalBranches} />
        </div>

        {/* RIGHT 1/3 */}
        <div className="flex flex-col gap-4">
          <MissedMaidsCard rows={missedMaids} />

          {/* recent alerts */}
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Alerts ล่าสุด
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  เรียงตามความรุนแรง
                </div>
              </div>
              <Link
                href="/chairops/alerts"
                className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
              >
                ทั้งหมด <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            </div>
            {recentAlerts.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-emerald-600">
                ไม่มี alert ค้าง · ทุกสาขาราบรื่น ✓
              </div>
            ) : (
              <div className="py-1">
                {recentAlerts.map((a) => {
                  const sev = ALERT_SEV_STYLE[a.level];
                  const SevIcon = sev.icon;
                  return (
                    <div
                      key={a.id}
                      className="flex items-start gap-2.5 border-b border-zinc-100 px-4 py-2.5 last:border-b-0"
                    >
                      <span
                        className={`grid size-[22px] shrink-0 place-items-center rounded-full ${sev.box}`}
                        aria-hidden="true"
                      >
                        <SevIcon className="size-3" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium leading-snug text-zinc-900">
                          {a.title}
                        </div>
                        <div className="truncate text-[11.5px] text-zinc-500">
                          {a.branch ? `${a.branch.name} · ` : ""}
                          {a.message}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                        {thaiRelative(a.createdAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* system status footer */}
      <footer className="mt-2 flex flex-col gap-2 border-t border-zinc-100 pt-3 text-[11.5px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <StatusDot tone="ok" /> Cron drift · 22:00
          </span>
          <span className="inline-flex items-center gap-1">
            <StatusDot tone="ok" /> Cron SOP · 22:30
          </span>
          <span className="inline-flex items-center gap-1">
            <StatusDot tone="ok" /> CEO digest · 01:00
          </span>
          <span className="inline-flex items-center gap-1">
            <StatusDot tone={systemStatus.lastPosImportAt ? "ok" : "neutral"} />
            POS import ·{" "}
            {systemStatus.lastPosImportAt
              ? thaiDate(systemStatus.lastPosImportAt, "HH:mm")
              : "ยังไม่มี"}
          </span>
        </div>
        <span>
          ChairOps · {systemStatus.posImportsToday} ไฟล์ POS วันนี้ ·{" "}
          {systemStatus.eventsToday} events วันนี้
        </span>
      </footer>
    </div>
  );
}
