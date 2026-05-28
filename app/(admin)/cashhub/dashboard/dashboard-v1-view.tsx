"use client";

// Dashboard V1 — matches Claude Design handoff MLMc2DZd7q-5cmIzvrh5hw
// (variant V1: refined matrix + 4-card hero strip).
//
// Per UI audit 2026-05-22 (รอบ 49):
// - SectionPill numbering follows design: "💰" for hero · "00" for Executive overview
// - Removed 5 Pool-legacy sections (Forecast, Alerts, Payment-mix, Leaderboard, Calendar)
//   — they live on their own routes (/leaderboard, /missing, /heatmap, etc.).
// - Pool-specific extensions kept compact below a clear divider so the page
//   reads as "design canvas + Pool extras" rather than "Pool admin masquerading".

import Link from "next/link";
import {
  Download,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Banknote,
  Smartphone,
  CreditCard,
  Receipt,
  Target,
  Filter,
} from "lucide-react";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { SparklineV2 } from "@/components/cashhub/redesign/sparkline-v2";
import { HeroKpiCard } from "@/components/cashhub/redesign/hero-kpi-card";
import { DeltaPill } from "@/components/cashhub/redesign/delta-pill";
import { ExecutiveTable } from "@/components/cashhub/executive-table";
import { ProgressBar, Donut } from "@/components/cashhub/charts";
import {
  formatBahtCompact,
  thaiDateLong,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DashboardData } from "@/lib/cashhub/aggregator";
import type { ExecutiveMatrix } from "@/lib/cashhub/executive-matrix";

interface Props {
  userName: string;
  isAdmin: boolean;
  monthLabel: string;
  data: DashboardData;
  executiveMatrix: ExecutiveMatrix;
}

export function DashboardV1View({
  userName,
  isAdmin,
  monthLabel,
  data,
  executiveMatrix,
}: Props) {
  void isAdmin;
  const today = thaiDateLong(new Date());
  const fc = data.forecast;
  const tp = data.targetProgress;

  const monthDelta =
    data.prevMonthTotal > 0
      ? ((data.monthTotal - data.prevMonthTotal) / data.prevMonthTotal) * 100
      : null;

  // 11-month total sparkline from executive-matrix (sums all biz rows per period)
  const totalSpark: number[] = (() => {
    const keys = executiveMatrix.periodKeys.slice().reverse();
    return keys.map((_, i) => {
      const colIndex = executiveMatrix.periodKeys.length - 1 - i;
      return executiveMatrix.periodTotals[colIndex] ?? 0;
    });
  })();

  // Top 3 "น่าเป็นห่วง" — branches with biggest MoM drop ≥ 20% (or stale ≥3 days)
  const watchlist = data.branchSummaries
    .filter((s) => s.monthTotal > 0 || s.daysSinceLastReport != null)
    .map((s) => {
      const pct =
        s.target > 0 ? (s.monthTotal / s.target) * 100 - 100 : null;
      return {
        code: s.branch.code,
        name: s.branch.name,
        biz: s.branch.business_type,
        pct,
        days: s.daysSinceLastReport,
      };
    })
    .filter((w) => (w.pct ?? 0) <= -20 || (w.days ?? 0) >= 3)
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
    .slice(0, 3);

  const filledCount = data.branchSummaries.filter(
    (s) => s.todayStatus === "approved" || s.todayStatus === "submitted",
  ).length;
  const branchCount = data.branches.length;
  const filledPct =
    branchCount > 0 ? Math.round((filledCount / branchCount) * 100) : 0;

  // Pending breakdown — design shows "1,023 รายงาน + 16 คำขอ"
  // We don't have register-requests count here so display "X รายงาน · รออนุมัติ"
  // (parent ApprovalBanner already shows the dual count globally).
  return (
    <div className="min-h-full bg-white">
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Hero — design dashboard.jsx:88-101 */}
        <div className="flex flex-col gap-3 mb-2">
          <SectionPill num="💰" label={`CashHub · ${today}`} />
          <div className="flex flex-wrap items-end gap-4">
            <TwoToneTitle first="ภาพรวม" accent="ยอดสาขา" size={42} />
            <div className="flex-1" />
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--ch-border-strong)] bg-white text-sm font-semibold text-[var(--ch-text)] hover:bg-zinc-50"
                onClick={() => window.print()}
              >
                <Download className="size-4" /> Export PDF
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[var(--ch-brand)] text-white text-sm font-semibold hover:bg-[var(--ch-brand-700)]"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="size-4" /> รีเฟรช
              </button>
            </div>
          </div>
          <div className="text-sm text-[var(--ch-text-2)]">
            {userName} · เดือน {monthLabel} · {branchCount} สาขาที่ใช้งาน
          </div>
        </div>

        {/* Hero KPI strip — design dashboard.jsx:104-155 (4 cards) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 mt-4">
          {/* Total */}
          <HeroKpiCard eyebrow={`ยอดขายรวม · ${monthLabel}`}>
            <div className="flex items-baseline gap-2 mt-1">
              <div
                className="ch-tnum font-display font-bold text-[var(--ch-navy)] leading-none"
                style={{ fontSize: 38, letterSpacing: "-0.02em" }}
              >
                {formatBahtCompact(data.monthTotal)}
              </div>
              <div className="ml-auto">
                <DeltaPill pct={monthDelta} />
              </div>
            </div>
            <div className="h-7 mt-2">
              <SparklineV2
                data={totalSpark.length ? totalSpark : [0]}
                width={260}
                height={28}
                color="var(--ch-brand)"
                fill
                smooth
              />
            </div>
            <div className="text-[11px] text-[var(--ch-text-3)] mt-1">
              vs เดือนก่อน {formatBahtCompact(data.prevMonthTotal)}
              {data.targetTotal > 0
                ? ` · เป้า ${formatBahtCompact(data.targetTotal)}`
                : ""}
            </div>
          </HeroKpiCard>

          {/* Reporting */}
          <HeroKpiCard eyebrow="สาขาที่กรอกครบ (วันนี้)">
            <div className="flex items-baseline gap-1 mt-1">
              <span
                className="ch-tnum font-display font-bold text-[var(--ch-navy)] leading-none"
                style={{ fontSize: 38 }}
              >
                {filledCount}
              </span>
              <span className="text-sm text-[var(--ch-text-3)]">
                / {branchCount} สาขา
              </span>
            </div>
            <div className="h-1.5 bg-[var(--ch-bg-3)] rounded-full mt-3 overflow-hidden">
              <div
                className="h-full"
                style={{
                  width: `${filledPct}%`,
                  background:
                    "linear-gradient(90deg,var(--ch-brand),var(--ch-info))",
                }}
              />
            </div>
            <div className="text-[11px] text-[var(--ch-text-3)] mt-1.5">
              {filledPct}% · เหลือ {Math.max(0, branchCount - filledCount)} สาขายังไม่กรอก
            </div>
          </HeroKpiCard>

          {/* Anomalies */}
          <HeroKpiCard eyebrow="น่าเป็นห่วง">
            <div className="flex items-baseline gap-1 mt-1">
              <span
                className="ch-tnum font-display font-bold text-[var(--ch-danger)] leading-none"
                style={{ fontSize: 38 }}
              >
                {watchlist.length}
              </span>
              <span className="text-sm text-[var(--ch-text-3)]">
                สาขา ↘ ≥ 20%
              </span>
            </div>
            <div className="flex flex-col gap-0.5 mt-2.5 text-[11px]">
              {watchlist.length === 0 ? (
                <div className="text-[var(--ch-text-3)]">— ไม่มี —</div>
              ) : (
                watchlist.map((w) => (
                  <div
                    key={w.code}
                    className="flex justify-between items-center"
                  >
                    <span className="truncate mr-2">
                      <span className="font-semibold">{w.code}</span>
                      <span className="text-[var(--ch-text-3)] ml-1 truncate inline-block max-w-[110px] align-bottom">
                        {w.name}
                      </span>
                    </span>
                    {w.pct != null ? (
                      <span className="text-[var(--ch-danger)] font-semibold ch-tnum">
                        {w.pct.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-[var(--ch-danger)] font-semibold ch-tnum">
                        ขาด {w.days}d
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </HeroKpiCard>

          {/* Pending */}
          <HeroKpiCard eyebrow="รออนุมัติ">
            <div className="flex items-baseline gap-1 mt-1">
              <span
                className="ch-tnum font-display font-bold text-[var(--ch-navy)] leading-none"
                style={{ fontSize: 38 }}
              >
                {data.pendingCount.toLocaleString("en-US")}
              </span>
            </div>
            <div className="text-[11px] text-[var(--ch-text-3)] mt-1.5">
              {data.pendingCount.toLocaleString("en-US")} รายงาน รออนุมัติ
            </div>
            <Link
              href="/cashhub/reports?status=submitted"
              className="mt-2.5 inline-flex items-center justify-center w-full h-7 rounded-md bg-[var(--ch-brand)] text-white text-xs font-semibold hover:bg-[var(--ch-brand-700)]"
            >
              เริ่มอนุมัติ →
            </Link>
          </HeroKpiCard>
        </div>

        {/* Section 00 — Executive matrix — design dashboard.jsx:159-280 */}
        <div className="mt-8 mb-3">
          <SectionPill num="00" label="Executive overview" />
          <div className="flex flex-wrap items-baseline gap-3 mt-2">
            <h2 className="text-xl font-bold text-[var(--ch-navy)] m-0">
              สรุปยอดขาย{" "}
              <span className="text-[var(--ch-brand)]">ทุกประเภทธุรกิจ</span>
            </h2>
            <span className="text-xs text-[var(--ch-text-3)]">
              กดที่แถวเพื่อขยายดูสาขา · ปุ่ม ฿/⚖ บนตาราง สลับหน่วย · เลื่อนซ้ายขวาดูช่วงเก่า
            </span>
          </div>
        </div>
        <div className="mb-8">
          <ExecutiveTable data={executiveMatrix} />
        </div>

        {/* ─── Pool extensions divider ─── */}
        <div className="my-10 flex items-center gap-3 text-[11px] font-semibold text-[var(--ch-text-3)]">
          <span className="h-px flex-1 bg-[var(--ch-border)]" />
          <Filter className="size-3" aria-hidden="true" />
          <span>Pool extras · ไม่อยู่ใน Design canvas</span>
          <span className="h-px flex-1 bg-[var(--ch-border)]" />
        </div>

        {/* Pool extras: compact Forecast + Alerts + Payment-mix (Pool-specific) */}

        {/* Forecast + Target */}
        {(fc.forecastEom > 0 || data.targetTotal > 0) && (
          <div className="mb-6 ch-card-v2 bg-[var(--ch-bg-2)] p-4 sm:p-5 flex flex-col sm:flex-row gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-[var(--ch-text-3)] flex items-center gap-1.5">
                <Target className="size-3" aria-hidden="true" />
                คาดการณ์สิ้นเดือน
              </div>
              <div className="ch-tnum font-display font-extrabold text-[var(--ch-navy)] mt-1 text-2xl sm:text-3xl">
                {formatBahtCompact(fc.forecastEom)}
              </div>
              <div className="text-[11px] text-[var(--ch-text-2)] mt-0.5">
                เฉลี่ย {formatBahtCompact(fc.dailyAvg)}/วัน · เหลืออีก {fc.daysLeft} วัน
              </div>
            </div>
            {data.targetTotal > 0 && (
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[var(--ch-text-3)]">
                  เป้า {formatBahtCompact(data.targetTotal)}
                </div>
                <div className="ch-tnum font-display font-extrabold text-[var(--ch-navy)] mt-1 text-2xl sm:text-3xl">
                  {tp.pctOfTotal.toFixed(0)}%
                </div>
                <ProgressBar
                  value={tp.pctOfTotal}
                  marker={(data.daysElapsed / data.daysInMonth) * 100}
                  className="mt-2"
                  fillColor={tp.isOnTrack ? "#16a34a" : "#f5b800"}
                />
                <p className="text-[11px] text-[var(--ch-text-2)] mt-1">
                  {tp.isOnTrack
                    ? `ทันเป้าตามสัดส่วน (${tp.pctOfPace.toFixed(0)}% of pace)`
                    : `เป้าวันนี้ ${formatBahtCompact(tp.expectedSoFar)} · ขาดอีก ${formatBahtCompact(tp.shortfallToPace)}`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Alerts (compact) */}
        {data.alerts.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="size-4 text-[var(--ch-danger)]" />
              <h3 className="text-sm font-bold text-[var(--ch-navy)] m-0">
                ต้องดูแลวันนี้
              </h3>
              <span className="text-xs text-[var(--ch-text-3)]">
                · {data.alerts.length} รายการ
              </span>
            </div>
            <div className="ch-card-v2 overflow-hidden">
              <ul className="divide-y divide-[var(--ch-border)]">
                {data.alerts.slice(0, 5).map((a, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 px-3 sm:px-4 py-2.5"
                  >
                    <div
                      className={cn(
                        "size-7 rounded-lg flex items-center justify-center shrink-0",
                        a.severity === "danger"
                          ? "bg-[var(--ch-danger-soft)] text-[var(--ch-danger)]"
                          : a.severity === "warning"
                            ? "bg-[var(--ch-pending-soft)] text-[#a16207]"
                            : "bg-[var(--ch-info-soft)] text-[var(--ch-info)]",
                      )}
                    >
                      <AlertTriangle className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1 text-sm">{a.message}</div>
                    {a.branch && (
                      <Link
                        href={`/cashhub/branches/${a.branch.id}`}
                        className="text-xs font-bold text-[var(--ch-brand)] hover:underline shrink-0"
                      >
                        ดู →
                      </Link>
                    )}
                  </li>
                ))}
                {data.alerts.length > 5 && (
                  <li className="px-4 py-2 text-xs text-[var(--ch-text-3)] bg-[var(--ch-bg-2)]">
                    <Link
                      href="/cashhub/missing"
                      className="text-[var(--ch-brand)] font-semibold hover:underline"
                    >
                      ดูทั้งหมด {data.alerts.length} รายการ →
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Payment mix (compact donut + bars) */}
        {data.paymentMixTotal > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Banknote className="size-4 text-[var(--ch-brand)]" />
              <h3 className="text-sm font-bold text-[var(--ch-navy)] m-0">
                ช่องทางรับเงิน
              </h3>
              <span className="text-xs text-[var(--ch-text-3)]">
                · รวม {formatBahtCompact(data.paymentMixTotal)} (อนุมัติแล้ว)
              </span>
            </div>
            <div className="ch-card-v2 p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-5">
              <div className="shrink-0">
                <Donut
                  size={100}
                  thickness={16}
                  segments={[
                    { label: "เงินสด", value: data.paymentMix.cash, color: "#16a34a" },
                    { label: "โอน", value: data.paymentMix.transfer, color: "#2563eb" },
                    { label: "บัตร", value: data.paymentMix.card, color: "#9333ea" },
                    { label: "เครดิต", value: data.paymentMix.credit, color: "#f97316" },
                    { label: "เงินขาด", value: data.paymentMix.shortage, color: "#dc2626" },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 flex-1 w-full text-xs">
                <MixRow
                  icon={<Banknote className="size-3.5 text-emerald-700" />}
                  color="#16a34a"
                  label="เงินสด"
                  value={data.paymentMix.cash}
                  total={data.paymentMixTotal}
                />
                <MixRow
                  icon={<Smartphone className="size-3.5 text-blue-700" />}
                  color="#2563eb"
                  label="โอน/QR"
                  value={data.paymentMix.transfer}
                  total={data.paymentMixTotal}
                />
                <MixRow
                  icon={<CreditCard className="size-3.5 text-violet-700" />}
                  color="#9333ea"
                  label="บัตร"
                  value={data.paymentMix.card}
                  total={data.paymentMixTotal}
                />
                <MixRow
                  icon={<Receipt className="size-3.5 text-orange-700" />}
                  color="#f97316"
                  label="เครดิต"
                  value={data.paymentMix.credit}
                  total={data.paymentMixTotal}
                />
                {data.paymentMix.shortage > 0 && (
                  <MixRow
                    icon={<AlertCircle className="size-3.5 text-red-700" />}
                    color="#dc2626"
                    label="เงินขาด"
                    value={data.paymentMix.shortage}
                    total={data.paymentMixTotal}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer quick-links — Pool-only navigation aid */}
        <div className="ch-card-v2 bg-[var(--ch-bg-2)] p-3 sm:p-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--ch-text-2)]">
          <span className="font-semibold text-[var(--ch-text-3)]">ทางลัด:</span>
          <Link href="/cashhub/reports" className="font-semibold text-[var(--ch-brand)] hover:underline">รายงาน</Link>
          <span className="text-[var(--ch-border-strong)]">·</span>
          <Link href="/cashhub/leaderboard" className="font-semibold text-[var(--ch-brand)] hover:underline">Leaderboard</Link>
          <span className="text-[var(--ch-border-strong)]">·</span>
          <Link href="/cashhub/heatmap" className="font-semibold text-[var(--ch-brand)] hover:underline">Heatmap</Link>
          <span className="text-[var(--ch-border-strong)]">·</span>
          <Link href="/cashhub/missing" className="font-semibold text-[var(--ch-brand)] hover:underline">เงินขาด</Link>
          <span className="text-[var(--ch-border-strong)]">·</span>
          <Link href="/cashhub/notes" className="font-semibold text-[var(--ch-brand)] hover:underline">โน้ตจาก Staff</Link>
          <span className="text-[var(--ch-border-strong)]">·</span>
          <Link href="/cashhub/compare" className="font-semibold text-[var(--ch-brand)] hover:underline">เทียบเดือน</Link>
          <span className="text-[var(--ch-border-strong)]">·</span>
          <Link href="/cashhub/monthly-report" className="font-semibold text-[var(--ch-brand)] hover:underline">รายงาน PDF</Link>
          <span className="text-[var(--ch-border-strong)]">·</span>
          <Link href="/cashhub/settings/forms" className="font-semibold text-[var(--ch-brand)] hover:underline">ฟอร์มกรอกยอด</Link>
        </div>
      </div>
    </div>
  );
}

function MixRow({
  icon,
  color,
  label,
  value,
  total,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-2 rounded-full shrink-0"
        style={{ background: color }}
      />
      <span className="shrink-0">{icon}</span>
      <span className="text-xs font-semibold text-[var(--ch-text-2)] shrink-0 min-w-[56px]">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <ProgressBar value={pct} fillColor={color} className="h-1.5" />
      </div>
      <span className="ch-tnum text-xs font-bold text-[var(--ch-text)] shrink-0">
        {pct.toFixed(0)}%
      </span>
      <span className="ch-tnum text-[10px] text-[var(--ch-text-3)] shrink-0 hidden sm:inline">
        {formatBahtCompact(value)}
      </span>
    </div>
  );
}
