// Branch detail (CASHHUB §10.3) — owner zooms into a single branch.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  XCircle,
  Phone,
  MapPin,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section, SectionDivider } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sparkline,
  ProgressBar,
  HealthBadge,
  CalendarHeatmap,
} from "@/components/cashhub/charts";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  formatBaht,
  formatBahtCompact,
  bkkDate,
  thaiDateLong,
} from "@/lib/utils/format";
import { computeStreak, streakBadge } from "@/lib/cashhub/streak";
import { forecast, targetProgress } from "@/lib/cashhub/forecast";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  subDays,
  getDaysInMonth,
  getDate,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const STATUS_BADGE = {
  approved: { tone: "success" as const, Icon: CheckCircle2, label: "อนุมัติแล้ว" },
  submitted: { tone: "warning" as const, Icon: Clock, label: "รออนุมัติ" },
  rejected: { tone: "danger" as const, Icon: XCircle, label: "ปฏิเสธ" },
  draft: { tone: "neutral" as const, Icon: Clock, label: "ฉบับร่าง" },
};

export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const admin = adminClient();

  const { data: branch } = await admin
    .from("branches")
    .select(
      "id, org_id, code, name, business_type, province, region, address, phone, manager_id, settings, is_active, report_deadline",
    )
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!branch) notFound();

  const cfg = BUSINESS_TYPES[branch.business_type];

  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const prevMonthStart = formatInTimeZone(
    startOfMonth(subMonths(now, 1)),
    TZ,
    "yyyy-MM-dd",
  );
  const prevMonthEnd = formatInTimeZone(
    endOfMonth(subMonths(now, 1)),
    TZ,
    "yyyy-MM-dd",
  );
  const last30 = formatInTimeZone(subDays(now, 29), TZ, "yyyy-MM-dd");
  const monthYear = parseInt(formatInTimeZone(now, TZ, "yyyy"), 10);
  const monthNum = parseInt(formatInTimeZone(now, TZ, "M"), 10);
  const daysInMonth = getDaysInMonth(now);
  const daysElapsed = getDate(now);

  const [reportsThisMonthQ, reportsLast30Q, prevMonthQ, managerQ, targetQ, healthQ, streakQ, shortagesQ] =
    await Promise.all([
      admin
        .from("daily_reports")
        .select("*")
        .eq("branch_id", id)
        .gte("report_date", monthStart)
        .lte("report_date", today)
        .order("report_date", { ascending: true }),
      admin
        .from("daily_reports")
        .select("report_date, total_sales, status")
        .eq("branch_id", id)
        .gte("report_date", last30)
        .lte("report_date", today),
      admin
        .from("daily_reports")
        .select("total_sales, status")
        .eq("branch_id", id)
        .gte("report_date", prevMonthStart)
        .lte("report_date", prevMonthEnd),
      branch.manager_id
        ? admin
            .from("users")
            .select("name, phone, email")
            .eq("id", branch.manager_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      safeQuery(
        admin
          .from("branch_targets")
          .select("amount")
          .eq("branch_id", id)
          .eq("year", monthYear)
          .eq("month", monthNum)
          .maybeSingle(),
      ),
      safeQuery(
        admin
          .from("branch_health_scores")
          .select("score, grade, breakdown, computed_for")
          .eq("branch_id", id)
          .order("computed_for", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
      safeQuery(
        admin
          .from("branch_streaks")
          .select("current_streak, longest_streak, last_report_date")
          .eq("branch_id", id)
          .maybeSingle(),
      ),
      admin
        .from("cash_shortages")
        .select(
          "id, report_date, amount, person_name, is_identified, note, person_id",
        )
        .eq("branch_id", id)
        .gte("report_date", last30)
        .lte("report_date", today)
        .order("report_date", { ascending: false }),
    ]);

  const reportsMonth = (reportsThisMonthQ.data ?? []) as Array<{
    id: string;
    report_date: string;
    shift: string;
    total_sales: number | string;
    qty1: number | string | null;
    cash: number | string;
    transfer: number | string;
    card: number | string;
    credit: number | string;
    shortage: number | string;
    status: keyof typeof STATUS_BADGE;
    notes: string | null;
    submitted_at: string | null;
    approved_at: string | null;
  }>;
  const reportsLast30 = (reportsLast30Q.data ?? []) as Array<{
    report_date: string;
    total_sales: number | string;
    status: string;
  }>;
  const prevReports = (prevMonthQ.data ?? []) as Array<{
    total_sales: number | string;
    status: string;
  }>;
  const manager = managerQ.data as
    | { name?: string; phone?: string; email?: string }
    | null;
  const target = targetQ.data
    ? Number((targetQ.data as { amount: number | string }).amount)
    : 0;
  const health = healthQ.data as
    | { score: number; grade: string; breakdown: Record<string, unknown>; computed_for: string }
    | null;
  const streakRaw = streakQ.data as
    | { current_streak: number; longest_streak: number; last_report_date: string | null }
    | null;
  const shortages = shortagesQ.data ?? [];

  // Aggregate
  const monthApproved = reportsMonth
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const monthPending = reportsMonth
    .filter((r) => r.status === "submitted")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const prevMonthTotal = prevReports
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const fc = forecast({
    actualMtd: monthApproved + monthPending,
    daysElapsed,
    daysInMonth,
    prevMonthTotal,
  });
  const tp = targetProgress({
    target,
    actual: monthApproved,
    daysElapsed,
    daysInMonth,
  });
  const monthDelta =
    prevMonthTotal > 0
      ? ((monthApproved + monthPending - prevMonthTotal) / prevMonthTotal) * 100
      : null;

  // Streak: derived if branch_streaks empty
  const allDates = Array.from(new Set(reportsLast30.map((r) => r.report_date))).sort();
  const computed = computeStreak(allDates, today);
  const streak = streakRaw
    ? {
        current: streakRaw.current_streak,
        longest: streakRaw.longest_streak,
        lastDate: streakRaw.last_report_date,
      }
    : computed;
  const sb = streakBadge(streak.lastDate, today, streak.current);

  // 7-day spark
  const days7: Array<{ date: string; value: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = formatInTimeZone(subDays(now, i), TZ, "yyyy-MM-dd");
    const v = reportsLast30
      .filter((r) => r.report_date === d && r.status !== "rejected")
      .reduce((s, r) => s + Number(r.total_sales || 0), 0);
    days7.push({ date: d, value: v });
  }

  // Calendar cells for current month — fill rate 0% / 100% based on if any approved report exists
  const cells: Array<{
    date: string;
    fillRate: number;
    total: number;
    submitted: number;
    expected: number;
  }> = [];
  for (let i = 0; i < daysElapsed; i++) {
    const d = formatInTimeZone(
      subDays(now, daysElapsed - 1 - i),
      TZ,
      "yyyy-MM-dd",
    );
    const todayReports = reportsMonth.filter((r) => r.report_date === d);
    const submitted = todayReports.length > 0 ? 1 : 0;
    cells.push({
      date: d,
      fillRate: submitted * 100,
      total: todayReports.reduce((s, r) => s + Number(r.total_sales || 0), 0),
      submitted,
      expected: 1,
    });
  }

  // Recent rows
  const recent = [...reportsMonth].reverse().slice(0, 10);

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <BackButton
        label={`กลับ${cfg?.label ? ` ${cfg.label}` : ""}`}
        fallbackHref={`/cashhub/dashboard/business/${branch.business_type}`}
      />

      {/* Header */}
      <header className="mt-3 mb-5">
        <div className="flex items-start gap-3">
          <div className="text-2xl sm:text-3xl shrink-0">{cfg?.emoji}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
              BRANCH DETAIL · {today}
            </p>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display mt-0.5">
              <span className="tabular-num">{branch.code}</span>
            </h1>
            <p className="text-zinc-600 text-sm mt-0.5 truncate">
              {branch.name}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2.5 text-xs text-zinc-500">
              {branch.province && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {branch.province}
                </span>
              )}
              {branch.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3" />
                  {branch.phone}
                </span>
              )}
              {manager?.name && (
                <Badge tone="neutral">ผจก. {manager.name}</Badge>
              )}
              {branch.report_deadline && (
                <Badge tone="info">Deadline {branch.report_deadline}</Badge>
              )}
            </div>
          </div>
          {health && (
            <div className="text-center shrink-0">
              <HealthBadge grade={health.grade} score={health.score} size="lg" withScore />
              <p className="text-xs uppercase tracking-wide text-zinc-500 font-bold mt-1">
                Health
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <Section number="01" label="THIS MONTH" title="ยอดเดือนนี้" className="mb-6">
        <Card>
          <CardBody>
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-2xl sm:text-3xl font-extrabold tabular-num font-display">
                  {formatBaht(monthApproved + monthPending)}
                </div>
                <div className="flex items-baseline gap-3 mt-2 flex-wrap">
                  {monthDelta !== null && (
                    <span
                      className={cn(
                        "text-sm font-bold inline-flex items-center gap-1",
                        monthDelta >= 0 ? "text-emerald-700" : "text-rose-700",
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
                  <span className="text-xs text-zinc-500">
                    {reportsMonth.filter((r) => r.status === "approved").length}{" "}
                    วันที่อนุมัติแล้ว
                  </span>
                  {monthPending > 0 && (
                    <Badge tone="warning">
                      รออนุมัติ {formatBahtCompact(monthPending)}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="เป้าเดือนนี้" value={target > 0 ? formatBahtCompact(target) : "—"} />
                <Stat
                  label="คาดสิ้นเดือน"
                  value={formatBahtCompact(fc.forecastEom)}
                />
                <Stat
                  label="Streak ปัจจุบัน"
                  value={`${streak.current} วัน`}
                  emoji={sb.emoji}
                />
                <Stat
                  label="Streak สูงสุด"
                  value={`${streak.longest} วัน`}
                  emoji="🏆"
                />
              </div>

              {target > 0 && (
                <div>
                  <div className="flex items-center justify-between text-xs text-zinc-500 mb-1.5">
                    <span>
                      {tp.pctOfTotal.toFixed(0)}% ของเป้า{" "}
                      <span className="tabular-num">
                        {formatBahtCompact(target)}
                      </span>
                    </span>
                    <span>
                      Pace {tp.pctOfPace.toFixed(0)}%{" "}
                      {tp.isOnTrack ? "✅" : "⚠️"}
                    </span>
                  </div>
                  <ProgressBar
                    value={tp.pctOfTotal}
                    marker={(daysElapsed / daysInMonth) * 100}
                  />
                  {!tp.isOnTrack && tp.shortfallToPace > 0 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      เป้าวันนี้ {formatBahtCompact(tp.expectedSoFar)} · ขาด
                      อีก {formatBahtCompact(tp.shortfallToPace)} · ต้องทำให้ได้{" "}
                      {formatBahtCompact(tp.remainingPerDay)}/วัน
                    </p>
                  )}
                </div>
              )}

              <Sparkline data={days7} width={400} height={48} className="w-full" />
              <p className="text-xs font-bold text-zinc-500">
                ยอด 7 วันล่าสุด
              </p>
            </div>
          </CardBody>
        </Card>
      </Section>

      {/* Calendar + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>ปฏิทินเดือนนี้</CardTitle>
            <Badge tone="neutral">{daysElapsed} วัน</Badge>
          </CardHeader>
          <CardBody>
            <CalendarHeatmap
              cells={cells}
              monthYear={thaiDateLong(now).split(" ").slice(1).join(" ")}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ประวัติล่าสุด (10)</CardTitle>
          </CardHeader>
          <CardBody className="!p-0">
            {recent.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={<Clock className="size-6" />}
                  title="ยังไม่มีรายงาน"
                  description="เริ่มกรอกรายงานวันนี้ผ่าน LIFF"
                />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {recent.map((r) => {
                  const sBadge = STATUS_BADGE[r.status];
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/cashhub/reports/${r.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50/60 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-sm tabular-num">
                            {bkkDate(r.report_date)}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate">
                            {r.shift}{" "}
                            {r.notes && `· "${r.notes.slice(0, 40)}${r.notes.length > 40 ? "…" : ""}"`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold tabular-num text-sm">
                            {formatBahtCompact(Number(r.total_sales || 0))}
                          </span>
                          {sBadge && (
                            <Badge tone={sBadge.tone}>
                              <sBadge.Icon className="size-3" />
                              {sBadge.label}
                            </Badge>
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
      </div>

      {/* Health breakdown + Shortages */}
      <SectionDivider />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        {health && (
          <Card>
            <CardHeader>
              <CardTitle>Health Score รายละเอียด</CardTitle>
              <HealthBadge grade={health.grade} score={health.score} withScore />
            </CardHeader>
            <CardBody>
              <ul className="space-y-1.5 text-sm">
                {Array.isArray(
                  (health.breakdown as { items?: unknown }).items,
                )
                  ? ((health.breakdown as { items: Array<{ label: string; delta: number; reason: string }> }).items).map(
                      (b, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-semibold">{b.label}</span>{" "}
                            <span className="text-xs text-zinc-500">
                              {b.reason}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "tabular-num font-bold shrink-0",
                              b.delta >= 0 ? "text-emerald-700" : "text-rose-700",
                            )}
                          >
                            {b.delta >= 0 ? "+" : ""}
                            {b.delta}
                          </span>
                        </li>
                      ),
                    )
                  : (
                    <li className="text-sm text-zinc-500 italic">
                      ยังไม่มีรายละเอียด — รอให้ Cron 23:00 รัน
                    </li>
                  )}
              </ul>
              <p className="text-[10px] text-zinc-400 mt-3">
                คำนวณเมื่อ {bkkDate(health.computed_for)}
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>เงินขาด 30 วัน</CardTitle>
            {shortages.length > 0 && (
              <Badge tone="warning">{shortages.length} ครั้ง</Badge>
            )}
          </CardHeader>
          <CardBody className="!p-0">
            {shortages.length === 0 ? (
              <div className="p-5 text-center">
                <CheckCircle2 className="size-8 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-600 font-medium">
                  ไม่มีเงินขาด 30 วัน
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {shortages.slice(0, 8).map((s) => (
                  <li
                    key={(s as { id: string }).id}
                    className="flex items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold tabular-num">
                        {bkkDate((s as { report_date: string }).report_date)}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {(s as { person_name: string | null }).person_name ||
                          "รวมร้าน"}
                        {(s as { note: string | null }).note
                          ? ` · ${(s as { note: string }).note}`
                          : ""}
                      </div>
                    </div>
                    <div className="text-sm font-bold tabular-num text-red-700 shrink-0">
                      ฿{Number((s as { amount: number | string }).amount).toLocaleString("th-TH")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  emoji,
}: {
  label: string;
  value: string;
  emoji?: string;
}) {
  return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-2.5">
      <p className="text-xs font-bold text-zinc-500">
        {label}
      </p>
      <div className="text-base font-extrabold tabular-num font-display mt-0.5 flex items-center gap-1">
        {emoji && <span>{emoji}</span>}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

// Wrap supabase awaitable so missing tables return empty rather than crashing.
async function safeQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promise: any,
): Promise<{ data: unknown; error: { code?: string } | null }> {
  try {
    const res = (await promise) as {
      data: unknown;
      error: { code?: string } | null;
    };
    if (res.error && (res.error.code === "42P01" || res.error.code === "PGRST205")) {
      return { data: null, error: null };
    }
    return res;
  } catch {
    return { data: null, error: null };
  }
}
