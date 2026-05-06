"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Clock,
  Building2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  ScrollText,
  TrendingUp,
  TrendingDown,
  Target,
  CalendarDays,
  Trophy,
  Wallet,
  CreditCard,
  Banknote,
  Smartphone,
  Receipt,
  Activity,
  GitCompareArrows,
  ChevronRight,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Section, SectionDivider } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatBaht,
  formatBahtCompact,
  thaiDateLong,
} from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  Sparkline,
  ProgressBar,
  CalendarHeatmap,
  PatternHeatmap,
  HealthBadge,
  Donut,
} from "@/components/cashhub/charts";
import { ExecutiveTable } from "@/components/cashhub/executive-table";
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

export function DashboardView({
  userName,
  isAdmin,
  monthLabel,
  data,
  executiveMatrix,
}: Props) {
  const today = thaiDateLong(new Date());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [seeded, setSeeded] = useState(false);

  const totalReports = data.branchSummaries.reduce(
    (s, b) => s + (b.monthTotal > 0 ? 1 : 0),
    0,
  );
  const showOnboarding = totalReports === 0 && data.branches.length > 0 && isAdmin;

  function generateTestData() {
    startTransition(async () => {
      const res = await fetch("/api/dev/seed-test-data", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "สร้างข้อมูลตัวอย่างไม่ได้");
        return;
      }
      toast.success("สร้างข้อมูลตัวอย่างสำเร็จ", {
        description: `${json.created} รายงาน · ${json.branches ?? "—"} สาขา`,
      });
      setSeeded(true);
      router.refresh();
    });
  }

  const fc = data.forecast;
  const tp = data.targetProgress;
  const monthDelta =
    data.prevMonthTotal > 0
      ? ((data.monthTotal - data.prevMonthTotal) / data.prevMonthTotal) * 100
      : null;

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <header className="mb-6 sm:mb-8 animate-fade-up">
        <p className="text-[11px] sm:text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          💰 CashHub · {today}
        </p>
        <h1 className="text-3xl sm:text-5xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95] text-zinc-900">
          ภาพรวม <span className="text-gradient-blue">ยอดสาขา</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm sm:text-base">
          {userName} · เดือน {monthLabel} · {data.branches.length} สาขาที่ใช้งาน
        </p>
      </header>

      {/* ============================================================
          EXECUTIVE OVERVIEW TABLE — Boss view, scan in 5 sec
          ตารางสรุป business type × month — slidable + compact
          ============================================================ */}
      <Section
        number="00"
        label="EXECUTIVE OVERVIEW"
        title="สรุปยอดขาย ทุกประเภทธุรกิจ"
        description="กดที่แถวเพื่อขยายดูสาขา · ปุ่มมุมขวาบนสำหรับขยายทั้งหมด · สลับรายเดือน/รายวัน · เลื่อนซ้ายขวาดูช่วงเก่า"
        className="mb-8 animate-fade-up"
      >
        <ExecutiveTable data={executiveMatrix} />
      </Section>

      {showOnboarding && !seeded && (
        <Card className="mb-6 border-[var(--color-brand-300)] bg-gradient-to-br from-[var(--color-brand-50)] via-white to-white">
          <CardBody>
            <div className="flex items-start gap-3 mb-4">
              <div className="size-12 shrink-0 rounded-2xl bg-[var(--color-brand-600)] text-white flex items-center justify-center shadow-blue">
                <Sparkles className="size-6" strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold font-display">
                  เริ่มต้นใช้งาน <span className="text-gradient-blue">CashHub</span>
                </h2>
                <p className="text-sm text-zinc-600 mt-1">
                  ระบบพร้อม — มี {data.branches.length} สาขา รอข้อมูลเข้ามา
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <Button onClick={generateTestData} loading={pending} size="lg" fullWidth>
                <Sparkles className="size-4" />
                สร้างข้อมูลตัวอย่าง
              </Button>
              <Link href="/liff/report" className="block">
                <Button variant="outline" size="lg" fullWidth>
                  <ScrollText className="size-4" />
                  กรอกรายงานจริง
                </Button>
              </Link>
              <Link href="/cashhub/branches" className="block">
                <Button variant="outline" size="lg" fullWidth>
                  <Building2 className="size-4" />
                  ดูสาขา
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ===== Section 01 — Hero stat ===== */}
      <Section
        number="01"
        label="THIS MONTH"
        title="ยอดสะสมเดือนนี้"
        className="mb-6 animate-fade-up delay-100"
      >
        <Card
          className="overflow-hidden relative border-0 shadow-blue"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.45 0.24 264) 0%, oklch(0.50 0.28 263) 50%, oklch(0.42 0.21 264) 100%)",
          }}
        >
          <div className="absolute inset-0 bg-grid-dots-on-blue pointer-events-none opacity-60" />
          <div
            className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-30 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, oklch(0.70 0.22 250) 0%, transparent 70%)",
            }}
          />
          <CardBody className="relative text-white p-5 sm:p-8">
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[10px] sm:text-xs uppercase tracking-widest text-white/70 font-bold mb-1.5">
                  ยอดสะสม (อนุมัติ + รออนุมัติ)
                </p>
                <div className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tabular-num font-display tracking-tight">
                  {formatBaht(data.monthTotal)}
                </div>
                <div className="flex flex-wrap items-baseline gap-3 mt-2">
                  {monthDelta !== null && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-sm font-bold",
                        monthDelta >= 0 ? "text-emerald-300" : "text-rose-300",
                      )}
                    >
                      {monthDelta >= 0 ? (
                        <TrendingUp className="size-4" />
                      ) : (
                        <TrendingDown className="size-4" />
                      )}
                      {monthDelta >= 0 ? "+" : ""}
                      {monthDelta.toFixed(1)}% เทียบเดือนก่อน
                    </span>
                  )}
                  {data.monthPending > 0 && (
                    <span className="text-xs text-white/75">
                      รออนุมัติ{" "}
                      <span className="font-bold text-amber-300 tabular-num">
                        {formatBahtCompact(data.monthPending)}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <HeroStat
                  icon={<Building2 className="size-4" />}
                  label="สาขา"
                  value={data.branches.length.toString()}
                />
                <HeroStat
                  icon={<CheckCircle2 className="size-4" />}
                  label="ส่งวันนี้"
                  value={data.byType
                    .reduce((s, t) => s + t.submittedToday, 0)
                    .toString()}
                />
                <HeroStat
                  icon={<Clock className="size-4" />}
                  label="รออนุมัติ"
                  value={data.pendingCount.toString()}
                />
                <HeroStat
                  icon={<AlertCircle className="size-4" />}
                  label="ขาดวันนี้"
                  value={data.byType
                    .reduce((s, t) => s + t.missingToday, 0)
                    .toString()}
                />
              </div>

              {/* Forecast + Target */}
              {(fc.forecastEom > 0 || data.targetTotal > 0) && (
                <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/15 p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:gap-6">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-white/70 font-bold mb-1">
                      🎯 คาดการณ์สิ้นเดือน
                    </p>
                    <div className="text-2xl sm:text-3xl font-extrabold tabular-num font-display">
                      {formatBahtCompact(fc.forecastEom)}
                    </div>
                    <p className="text-xs text-white/70 mt-0.5">
                      เฉลี่ย {formatBahtCompact(fc.dailyAvg)}/วัน · เหลืออีก{" "}
                      {fc.daysLeft} วัน
                    </p>
                  </div>
                  {data.targetTotal > 0 && (
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-widest text-white/70 font-bold mb-1">
                        เป้า {formatBahtCompact(data.targetTotal)}
                      </p>
                      <div className="text-2xl sm:text-3xl font-extrabold tabular-num font-display">
                        {tp.pctOfTotal.toFixed(0)}%
                      </div>
                      <ProgressBar
                        value={tp.pctOfTotal}
                        marker={(data.daysElapsed / data.daysInMonth) * 100}
                        className="mt-2 h-2 bg-white/20"
                        fillColor={tp.isOnTrack ? "#86efac" : "#fbbf24"}
                      />
                      <p className="text-[11px] text-white/70 mt-1">
                        {tp.isOnTrack
                          ? `✅ ทันเป้าตามสัดส่วน (${tp.pctOfPace.toFixed(0)}% of pace)`
                          : `เป้าวันนี้ ${formatBahtCompact(tp.expectedSoFar)} · ขาดอีก ${formatBahtCompact(tp.shortfallToPace)}`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </Section>

      {/* ===== Section 02 — Critical alerts ===== */}
      {data.alerts.length > 0 && (
        <>
          <Section
            number="02"
            label="ATTENTION"
            title="ต้องดูแลวันนี้"
            description="สาขาขาดส่ง · ยอดผิดปกติ · เครดิตค้างสูง · เงินขาด"
            className="mb-6 animate-fade-up delay-150"
          >
            <Card className="border-amber-200">
              <CardBody className="!p-0">
                <ul className="divide-y divide-amber-100">
                  {data.alerts.slice(0, 8).map((a, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 px-4 sm:px-5 py-3"
                    >
                      <div
                        className={cn(
                          "size-9 rounded-xl flex items-center justify-center shrink-0",
                          a.severity === "danger"
                            ? "bg-red-50 text-red-700"
                            : a.severity === "warning"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-blue-50 text-blue-700",
                        )}
                      >
                        <AlertTriangle className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 text-sm">
                        {a.message}
                      </div>
                      {a.branch && (
                        <Link
                          href={`/cashhub/branches/${a.branch.id}`}
                          className="text-xs font-bold text-[var(--color-brand-700)] hover:underline shrink-0"
                        >
                          ดู →
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
                {data.alerts.length > 8 && (
                  <div className="px-4 py-2 text-xs text-zinc-500 border-t border-amber-100 bg-amber-50/40">
                    + อีก {data.alerts.length - 8} รายการ
                  </div>
                )}
              </CardBody>
            </Card>
          </Section>
          <SectionDivider />
        </>
      )}

      {/* ===== Section 03 — By business type ===== */}
      <Section
        number={data.alerts.length > 0 ? "03" : "02"}
        label="BY BUSINESS"
        title="แยกตามประเภทธุรกิจ"
        description="กดเข้าดูรายชื่อสาขาในกลุ่มนี้"
        className="mb-6 animate-fade-up delay-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.byType.map((t) => {
            const cfg = BUSINESS_TYPES[t.type];
            if (!cfg) return null;
            const targetPct =
              t.targetTotal > 0 ? (t.total / t.targetTotal) * 100 : 0;
            return (
              <Link
                key={t.type}
                href={`/cashhub/dashboard/business/${t.type}`}
                className="block group"
              >
                <Card className="group-hover:border-[var(--color-brand-300)] transition-colors h-full">
                  <CardBody className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="size-12 shrink-0 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-2xl">
                        {cfg.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-zinc-900">
                          {cfg.label}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {t.branchCount} สาขา · ยอดเดือนนี้
                        </div>
                      </div>
                      <ChevronRight className="size-5 text-zinc-300 group-hover:text-[var(--color-brand-500)] transition-colors" />
                    </div>
                    <div className="text-2xl sm:text-3xl font-extrabold tabular-num font-display">
                      {formatBahtCompact(t.total)}
                    </div>
                    {t.targetTotal > 0 && (
                      <ProgressBar
                        value={targetPct}
                        marker={(data.daysElapsed / data.daysInMonth) * 100}
                        className="mt-2"
                      />
                    )}
                    <div className="flex items-center gap-2 mt-2.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 text-green-700 font-semibold">
                        <CheckCircle2 className="size-3" />
                        ส่ง {t.submittedToday}
                      </span>
                      {t.pendingToday > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                          <Clock className="size-3" />
                          รอ {t.pendingToday}
                        </span>
                      )}
                      {t.missingToday > 0 && (
                        <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                          <AlertCircle className="size-3" />
                          ขาด {t.missingToday}
                        </span>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      </Section>

      <SectionDivider />

      {/* ===== Section 04 — Payment Mix + Pending Action Card =====
           ผู้บริหารดูสัดส่วน · operational queue → /cashhub/reports */}
      <Section
        number={data.alerts.length > 0 ? "04" : "03"}
        label="MONEY FLOW"
        title="ช่องทางรับเงิน"
        className="mb-6 animate-fade-up delay-250"
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Payment mix card */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>ช่องทางรับเงินรวม (อนุมัติแล้ว)</CardTitle>
                <p className="text-xs text-zinc-500 mt-0.5">
                  รวม {formatBahtCompact(data.paymentMixTotal)}
                </p>
              </div>
              <Badge tone="brand">{monthLabel}</Badge>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col sm:flex-row items-center gap-5">
                <div className="shrink-0">
                  <Donut
                    size={120}
                    thickness={20}
                    segments={[
                      {
                        label: "เงินสด",
                        value: data.paymentMix.cash,
                        color: "#16a34a",
                      },
                      {
                        label: "โอน",
                        value: data.paymentMix.transfer,
                        color: "#2563eb",
                      },
                      {
                        label: "บัตร",
                        value: data.paymentMix.card,
                        color: "#9333ea",
                      },
                      {
                        label: "เครดิต",
                        value: data.paymentMix.credit,
                        color: "#f97316",
                      },
                      {
                        label: "เงินขาด",
                        value: data.paymentMix.shortage,
                        color: "#dc2626",
                      },
                    ]}
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-1 gap-1.5 flex-1 w-full">
                  <MixRow
                    icon={<Banknote className="size-4 text-emerald-700" />}
                    color="#16a34a"
                    label="เงินสด"
                    value={data.paymentMix.cash}
                    total={data.paymentMixTotal}
                  />
                  <MixRow
                    icon={<Smartphone className="size-4 text-blue-700" />}
                    color="#2563eb"
                    label="โอน/QR"
                    value={data.paymentMix.transfer}
                    total={data.paymentMixTotal}
                  />
                  <MixRow
                    icon={<CreditCard className="size-4 text-[var(--color-brand-700)]" />}
                    color="#1d4ed8"
                    label="บัตร"
                    value={data.paymentMix.card}
                    total={data.paymentMixTotal}
                  />
                  <MixRow
                    icon={<Receipt className="size-4 text-[var(--color-brand-600)]" />}
                    color="#3b82f6"
                    label="เครดิต"
                    value={data.paymentMix.credit}
                    total={data.paymentMixTotal}
                  />
                  {data.paymentMix.shortage > 0 && (
                    <MixRow
                      icon={<AlertCircle className="size-4 text-red-700" />}
                      color="#dc2626"
                      label="เงินขาด"
                      value={data.paymentMix.shortage}
                      total={data.paymentMixTotal}
                    />
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Compact action card — operational queue lives in /cashhub/reports */}
          <Link href="/cashhub/reports?status=submitted" className="block group">
            <Card
              className={cn(
                "h-full transition-colors",
                data.pendingCount > 0
                  ? "border-amber-200 bg-amber-50/30 group-hover:border-amber-300"
                  : "border-emerald-200 bg-emerald-50/30",
              )}
            >
              <CardBody className="flex flex-col items-center justify-center text-center h-full py-7">
                <div
                  className={cn(
                    "size-14 rounded-2xl flex items-center justify-center mb-3",
                    data.pendingCount > 0
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700",
                  )}
                >
                  {data.pendingCount > 0 ? (
                    <Clock className="size-7" />
                  ) : (
                    <CheckCircle2 className="size-7" />
                  )}
                </div>
                <div className="text-5xl font-extrabold tabular-num font-display text-zinc-900">
                  {data.pendingCount}
                </div>
                <p className="text-sm font-bold text-zinc-700 mt-1">
                  รออนุมัติ
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  {data.pendingCount > 0
                    ? "กดเพื่อจัดการในหน้ารายงาน →"
                    : "ทุกรายงานเรียบร้อย"}
                </p>
              </CardBody>
            </Card>
          </Link>
        </div>
      </Section>

      <SectionDivider />

      {/* ===== Section 05 — Leaderboard + Calendar ===== */}
      <Section
        number={data.alerts.length > 0 ? "05" : "04"}
        label="RANKINGS"
        title="ตารางอันดับ · ปฏิทินกรอกครบ"
        action={
          <Link href="/cashhub/leaderboard">
            <Button variant="outline" size="md">
              ดูทั้งหมด <ArrowRight className="size-4" />
            </Button>
          </Link>
        }
        className="mb-6 animate-fade-up delay-300"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Leaderboard top 8 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trophy className="size-4 text-amber-600" />
                <CardTitle>Top สาขา (อันดับเดือนนี้)</CardTitle>
              </div>
            </CardHeader>
            <CardBody className="!p-0">
              {data.branchSummaries.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<Trophy className="size-6" />}
                    title="ยังไม่มีสาขา"
                    description="เพิ่มสาขาก่อนเพื่อดู Leaderboard"
                  />
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {[...data.branchSummaries]
                    .sort((a, b) => b.monthTotal - a.monthTotal)
                    .slice(0, 8)
                    .map((s, i) => {
                      const cfg = BUSINESS_TYPES[s.branch.business_type];
                      const rankColor =
                        i === 0
                          ? "text-[var(--color-brand-700)]"
                          : i === 1
                            ? "text-[var(--color-brand-500)]"
                            : i === 2
                              ? "text-zinc-600"
                              : "text-zinc-400";
                      return (
                        <li key={s.branch.id}>
                          <Link
                            href={`/cashhub/branches/${s.branch.id}`}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50/60 transition-colors"
                          >
                            <div
                              className={cn(
                                "size-7 shrink-0 text-center text-xs font-extrabold tabular-num font-display",
                                rankColor,
                              )}
                            >
                              #{i + 1}
                            </div>
                            <span className="text-lg shrink-0">{cfg?.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                                {s.branch.code}
                                {s.streak && s.streak.current >= 7 && (
                                  <span title={`Streak ${s.streak.current} วัน`}>
                                    🔥
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-zinc-500 truncate">
                                {s.branch.name}
                              </div>
                            </div>
                            <Sparkline
                              data={s.spark}
                              width={56}
                              height={20}
                              className="shrink-0"
                            />
                            <div className="text-right shrink-0 min-w-[68px]">
                              <div className="text-sm font-bold tabular-num">
                                {formatBahtCompact(s.monthTotal)}
                              </div>
                              {s.health && (
                                <HealthBadge
                                  grade={s.health.grade}
                                  size="sm"
                                  className="mt-0.5 -mr-0.5 justify-end"
                                />
                              )}
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Calendar heatmap */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-[var(--color-brand-600)]" />
                <CardTitle>ปฏิทินกรอกครบ</CardTitle>
              </div>
              <Badge tone="neutral">{monthLabel}</Badge>
            </CardHeader>
            <CardBody>
              <CalendarHeatmap
                cells={data.dailyTotals}
                monthYear={monthLabel}
              />
              <div className="mt-3 text-xs text-zinc-500">
                สีเข้ม = % สาขากรอกครบสูง · กดดูรายละเอียดที่{" "}
                <Link
                  href="/cashhub/heatmap"
                  className="text-[var(--color-brand-700)] font-bold hover:underline"
                >
                  Heatmap แบบเต็ม
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </Section>

      <SectionDivider />

      {/* ===== Section 06 — Pattern (day-of-week × type) ===== */}
      <Section
        number={data.alerts.length > 0 ? "06" : "05"}
        label="PATTERN"
        title="ยอดเฉลี่ยรายวัน × ประเภทธุรกิจ"
        description="ดู 30 วันล่าสุด · กดที่แถวเพื่อดูแยกตามสาขา · ใช้วางแผน Promotion ตามวันที่ยอดต่ำ"
        className="mb-6 animate-fade-up delay-350"
      >
        <Card>
          <CardBody>
            <PatternHeatmap
              data={data.patternHeat}
              byBranch={data.patternByBranch}
            />
          </CardBody>
        </Card>
      </Section>

      <SectionDivider />

      {/* ===== Section 07 — Tools ===== */}
      <Section
        number={data.alerts.length > 0 ? "07" : "06"}
        label="TOOLS"
        title="ทางลัด"
        className="animate-fade-up delay-400"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <ActionTile
            href="/cashhub/reports"
            icon={<TrendingUp className="size-5" />}
            label="ดูรายงาน"
          />
          <ActionTile
            href="/cashhub/compare"
            icon={<GitCompareArrows className="size-5" />}
            label="เปรียบเทียบ"
          />
          <ActionTile
            href="/cashhub/leaderboard"
            icon={<Trophy className="size-5" />}
            label="Leaderboard"
          />
          <ActionTile
            href="/cashhub/shortages"
            icon={<Activity className="size-5" />}
            label="เงินขาด"
          />
          <ActionTile
            href="/cashhub/heatmap"
            icon={<CalendarDays className="size-5" />}
            label="Heatmap"
          />
          <ActionTile
            href="/cashhub/branches"
            icon={<Building2 className="size-5" />}
            label="จัดการสาขา"
          />
          <ActionTile
            href="/liff/report"
            icon={<ScrollText className="size-5" />}
            label="กรอกรายงาน"
          />
          <ActionTile
            href="/api/cashhub/export"
            icon={<ArrowRight className="size-5" />}
            label="Export CSV"
          />
        </div>
      </Section>
    </div>
  );
}

// ----- helpers -----
function HeroStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white/10 backdrop-blur rounded-xl px-3 py-2.5 border border-white/15">
      <div className="flex items-center gap-1.5 text-white/75 text-[10px] uppercase tracking-widest font-bold mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xl sm:text-2xl font-extrabold tabular-num text-white">
        {value}
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
    <div className="flex items-center gap-2.5">
      <span
        className="size-2.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      <span className="shrink-0">{icon}</span>
      <span className="text-xs font-semibold text-zinc-700 shrink-0 min-w-[56px]">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <ProgressBar
          value={pct}
          fillColor={color}
          className="h-1.5"
        />
      </div>
      <span className="text-xs tabular-num font-bold text-zinc-900 shrink-0">
        {pct.toFixed(0)}%
      </span>
      <span className="text-[10px] tabular-num text-zinc-500 shrink-0 hidden sm:inline">
        {formatBahtCompact(value)}
      </span>
    </div>
  );
}

function ActionTile({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 bg-white rounded-2xl border-2 border-zinc-200 px-4 py-3.5 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/30 transition-all hover-lift"
    >
      <div className="size-9 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)] shrink-0">
        {icon}
      </div>
      <div className="text-sm font-semibold text-zinc-800 truncate">{label}</div>
    </Link>
  );
}

void Wallet;
void Target;
