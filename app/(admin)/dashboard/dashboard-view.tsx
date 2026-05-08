// /dashboard view — Cross-Module Executive Command Center
// ─────────────────────────────────────────────────────────────────────
// Brand: Auditmekub-style numbered sections, deep royal blue, dot grid
// Memory rules baked in:
//   - typography ≤ sm:text-3xl in detail rows
//   - heatmap cells = clickable (dot/cell ทุกอันคลิกได้)
//   - filter pattern: ประเภทธุรกิจ → สาขา (toggle row + Link to drill)
//   - popup-first drilldown for daily cells (open dialog in-page)
//   - module isolation: FuelOS / DocuFlow = empty state ถ้าไม่มี data
//   - Plain Thai · ไม่ใช่ jargon
// ─────────────────────────────────────────────────────────────────────

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowRight,
  RefreshCw,
  Truck,
  FileText,
  Sparkles,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Section, SectionDivider } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog } from "@/components/ui/dialog";
import { Donut, ProgressBar } from "@/components/cashhub/charts";
import { AiChat } from "@/components/cashhub/ai-chat";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  formatBaht,
  formatBahtCompact,
  thaiDateLong,
  bkkRelative,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DashboardData } from "@/lib/cashhub/aggregator";
import type { DbUser } from "@/lib/auth/session";
import { BusinessTypeCard } from "./business-type-card";

interface Props {
  userName: string;
  userRole: DbUser["role"];
  isAdmin: boolean;
  monthLabel: string;
  data: DashboardData;
  refreshAt: string;
  initialRange: "today" | "week" | "month";
  initialType: string;
}

type Range = "today" | "week" | "month" | "custom";

const RANGE_LABEL: Record<Range, string> = {
  today: "วันนี้",
  week: "สัปดาห์",
  month: "เดือนนี้",
  custom: "กำหนดเอง",
};

const ROLE_LABEL_TH: Record<string, string> = {
  super_admin: "เจ้าของ",
  org_admin: "ผู้ดูแลองค์กร",
  admin: "ผู้ดูแล",
  area_manager: "ผู้จัดการเขต",
};

export function DashboardView({
  userName,
  userRole,
  isAdmin,
  monthLabel,
  data,
  refreshAt,
  initialRange,
  initialType,
}: Props) {
  const today = thaiDateLong(new Date());
  const [range, setRange] = useState<Range>(initialRange);
  const [typeFilter, setTypeFilter] = useState<string>(initialType);
  const [openCell, setOpenCell] = useState<
    | null
    | {
        date: string;
        total: number;
        submitted: number;
        expected: number;
        fillRate: number;
      }
  >(null);

  const refreshLabel = bkkRelative(refreshAt);
  const fc = data.forecast;
  const tp = data.targetProgress;
  const monthDelta =
    data.prevMonthTotal > 0
      ? ((data.monthTotal - data.prevMonthTotal) / data.prevMonthTotal) * 100
      : null;
  const monthPaceMarker = (data.daysElapsed / data.daysInMonth) * 100;

  // Filter business buckets if user picked a specific type
  const filteredByType = useMemo(() => {
    if (typeFilter === "all") return data.byType;
    return data.byType.filter((t) => t.type === typeFilter);
  }, [data.byType, typeFilter]);

  // Critical-list — top 8 (alerts already sorted by severity in aggregator)
  const criticalAlerts = data.alerts.slice(0, 8);

  // Pending count for the action button on alerts
  const pendingCount = data.pendingCount;

  // Empty-state flag — completely fresh org
  const isEmpty =
    data.branches.length === 0 ||
    (data.monthTotal === 0 && data.dailyTotals.every((c) => c.submitted === 0));

  return (
    <div className="relative">
      {/* Soft dot grid wash — Brand DNA */}
      <div
        aria-hidden
        className="absolute inset-0 bg-grid-dots opacity-[0.30] pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-28">
        {/* ============================================================
            HEADER — 🏢 Pool Group · date · last refresh
            ============================================================ */}
        <header className="mb-6 sm:mb-8 animate-fade-up">
          <p className="flex items-center gap-2 text-[11px] sm:text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
            <span>🏢 Pooilgroup</span>
            <span className="text-zinc-300">·</span>
            <span className="text-zinc-500 normal-case tracking-normal">
              {today}
            </span>
            <span className="text-zinc-300">·</span>
            <span className="inline-flex items-center gap-1 text-zinc-500 normal-case tracking-normal">
              <RefreshCw className="size-3" />
              {refreshLabel}
            </span>
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.03em] font-display mt-3 leading-tight text-zinc-900">
            ภาพรวม{" "}
            <span className="text-gradient-blue">Command Center</span>
          </h1>
          <p className="text-zinc-600 mt-1.5 text-sm sm:text-base">
            {userName} · {ROLE_LABEL_TH[userRole] ?? userRole}
            <span className="text-zinc-400 mx-1.5">·</span>
            เดือน {monthLabel}
            <span className="text-zinc-400 mx-1.5">·</span>
            <strong className="font-bold text-zinc-900 tabular-num">
              {data.branches.length}
            </strong>{" "}
            สาขา
          </p>
        </header>

        {/* ============================================================
            01 HERO — ยอดสะสมเดือนนี้ + delta + forecast + target
            ============================================================ */}
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
                  <div className="text-3xl sm:text-3xl lg:text-3xl font-extrabold tabular-num font-display tracking-tight">
                    {formatBaht(data.monthTotal)}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-3 mt-2">
                    {monthDelta !== null && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-sm font-bold",
                          monthDelta >= 0
                            ? "text-emerald-300"
                            : "text-rose-300",
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
                    value={pendingCount.toString()}
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
                          marker={monthPaceMarker}
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

        {/* ============================================================
            FILTER ROW — range + business type
            ============================================================ */}
        <div className="mb-5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between animate-fade-up delay-100">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-soft">
            {(["today", "week", "month", "custom"] as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                  range === r
                    ? "bg-[var(--color-brand-600)] text-white"
                    : "text-zinc-600 hover:bg-zinc-50",
                )}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-soft overflow-x-auto">
            <TypePill
              label="ทั้งหมด"
              active={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
            />
            {data.byType.map((t) => {
              const cfg = BUSINESS_TYPES[t.type];
              if (!cfg) return null;
              return (
                <TypePill
                  key={t.type}
                  label={`${cfg.emoji} ${cfg.label}`}
                  active={typeFilter === t.type}
                  onClick={() => setTypeFilter(t.type)}
                />
              );
            })}
          </div>
        </div>

        {/* Empty state — fresh org */}
        {isEmpty && (
          <Card className="mb-6 border-[var(--color-brand-300)] bg-gradient-to-br from-[var(--color-brand-50)] via-white to-white animate-fade-up">
            <CardBody>
              <div className="flex items-start gap-3">
                <div className="size-12 shrink-0 rounded-2xl bg-[var(--color-brand-600)] text-white flex items-center justify-center shadow-blue">
                  <Sparkles className="size-6" strokeWidth={2.5} />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg sm:text-xl font-extrabold font-display">
                    ยังไม่มีข้อมูลในเดือนนี้
                  </h2>
                  <p className="text-sm text-zinc-600 mt-1">
                    เมื่อสาขาเริ่มกรอกรายงาน · ตัวเลขทุกการ์ดจะอัปเดตทันที
                  </p>
                  {isAdmin && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href="/branches">
                        <Button variant="outline" size="md">
                          <Building2 className="size-4" />
                          ดูสาขา
                        </Button>
                      </Link>
                      <Link href="/cashhub/dashboard">
                        <Button variant="outline" size="md">
                          ดู CashHub
                          <ArrowRight className="size-4" />
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* ============================================================
            02 BUSINESS TYPES — 7 cards (sticky row, mobile-first)
            กดเข้าได้ → drilldown ไป /cashhub/dashboard/business/{type}
            ============================================================ */}
        <Section
          number="02"
          label="BY BUSINESS"
          title="แยกตามประเภทธุรกิจ"
          description="กดการ์ด → เข้าดูรายชื่อสาขาในกลุ่มนั้น"
          className="mb-6 animate-fade-up delay-150"
        >
          {filteredByType.length === 0 ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<Building2 className="size-6" />}
                  title="ยังไม่มีประเภทธุรกิจที่มีข้อมูล"
                  description="เลือก 'ทั้งหมด' หรือเพิ่มสาขาก่อน"
                />
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredByType.map((t) => (
                <BusinessTypeCard
                  key={t.type}
                  bucket={t}
                  monthPaceMarker={monthPaceMarker}
                />
              ))}
            </div>
          )}
        </Section>

        <SectionDivider />

        {/* ============================================================
            03 MONEY FLOW — payment mix donut
            ============================================================ */}
        <Section
          number="03"
          label="MONEY FLOW"
          title="ช่องทางรับเงินรวม"
          description="รวมเฉพาะรายงานที่อนุมัติแล้ว"
          className="mb-6 animate-fade-up delay-200"
        >
          <Card>
            <CardHeader>
              <div>
                <CardTitle>สัดส่วนรับเงินเดือนนี้</CardTitle>
                <p className="text-xs text-zinc-500 mt-0.5">
                  รวม {formatBahtCompact(data.paymentMixTotal)}
                </p>
              </div>
              <Badge tone="brand">{monthLabel}</Badge>
            </CardHeader>
            <CardBody>
              {data.paymentMixTotal === 0 ? (
                <EmptyState
                  icon={<Wallet className="size-6" />}
                  title="ยังไม่มีรายงานที่อนุมัติเดือนนี้"
                  description="เมื่ออนุมัติแล้ว สัดส่วนช่องทางรับเงินจะแสดงตรงนี้"
                />
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="shrink-0">
                    <Donut
                      size={140}
                      thickness={22}
                      segments={[
                        {
                          label: "เงินสด",
                          value: data.paymentMix.cash,
                          color: "#16a34a",
                        },
                        {
                          label: "โอน/QR",
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
                  <div className="grid grid-cols-1 gap-1.5 flex-1 w-full">
                    <MixRow
                      color="#16a34a"
                      label="เงินสด"
                      value={data.paymentMix.cash}
                      total={data.paymentMixTotal}
                    />
                    <MixRow
                      color="#2563eb"
                      label="โอน/QR"
                      value={data.paymentMix.transfer}
                      total={data.paymentMixTotal}
                    />
                    <MixRow
                      color="#9333ea"
                      label="บัตร"
                      value={data.paymentMix.card}
                      total={data.paymentMixTotal}
                    />
                    <MixRow
                      color="#f97316"
                      label="เครดิต"
                      value={data.paymentMix.credit}
                      total={data.paymentMixTotal}
                    />
                    {data.paymentMix.shortage > 0 && (
                      <MixRow
                        color="#dc2626"
                        label="เงินขาด"
                        value={data.paymentMix.shortage}
                        total={data.paymentMixTotal}
                      />
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </Section>

        <SectionDivider />

        {/* ============================================================
            04 CALENDAR HEATMAP — 30 วัน · clickable cells (popup)
            Memory rule: ทุก dot/cell ต้องคลิกได้
            ============================================================ */}
        <Section
          number="04"
          label="CALENDAR"
          title="ปฏิทินกรอกครบ 30 วัน"
          description="กดวันที่ → ดูรายละเอียดวันนั้น (ส่งกี่สาขา · ยอดรวม)"
          className="mb-6 animate-fade-up delay-250"
        >
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-[var(--color-brand-600)]" />
                <CardTitle>{monthLabel}</CardTitle>
              </div>
              <Link
                href="/cashhub/heatmap"
                className="text-xs font-bold text-[var(--color-brand-700)] hover:underline"
              >
                Heatmap แบบเต็ม →
              </Link>
            </CardHeader>
            <CardBody>
              {data.dailyTotals.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays className="size-6" />}
                  title="ยังไม่มีข้อมูลรายวัน"
                  description="ปฏิทินจะปรากฏเมื่อสาขาเริ่มส่งรายงาน"
                />
              ) : (
                <ClickableHeatmap
                  cells={data.dailyTotals}
                  onPick={setOpenCell}
                />
              )}
            </CardBody>
          </Card>
        </Section>

        <SectionDivider />

        {/* ============================================================
            05 ATTENTION — ต้องดูแลวันนี้ + Quick approve
            ============================================================ */}
        <Section
          number="05"
          label="ATTENTION"
          title="🚨 ต้องดูแลวันนี้"
          description="สาขาขาดส่ง · ยอดผิดปกติ · เครดิตค้างสูง · เงินขาด"
          action={
            pendingCount > 0 && (
              <Link href="/cashhub/reports?status=submitted">
                <Button size="md">
                  <CheckCircle2 className="size-4" />
                  อนุมัติทั้งหมด ({pendingCount})
                </Button>
              </Link>
            )
          }
          className="mb-6 animate-fade-up delay-300"
        >
          {criticalAlerts.length === 0 ? (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardBody className="flex items-center gap-3 py-5">
                <div className="size-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <p className="font-bold text-zinc-900">
                    ทุกอย่างเรียบร้อยวันนี้
                  </p>
                  <p className="text-sm text-zinc-600">
                    ไม่มีสาขาที่ต้องดูแลด่วน
                  </p>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card className="border-amber-200">
              <CardBody className="!p-0">
                <ul className="divide-y divide-amber-100">
                  {criticalAlerts.map((a, i) => (
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
                      <div className="min-w-0 flex-1 text-sm">{a.message}</div>
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
          )}
        </Section>

        <SectionDivider />

        {/* ============================================================
            06 OTHER MODULES — FuelOS / DocuFlow placeholder
            module isolation: ห้าม mock data — empty state สวย ๆ
            ============================================================ */}
        <Section
          number="06"
          label="OTHER MODULES"
          title="โปรแกรมอื่น"
          description="FuelOS / DocuFlow — เปิดใช้แล้วจะแสดงสรุปตรงนี้"
          className="mb-6 animate-fade-up delay-350"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="border-dashed">
              <CardBody>
                <div className="flex items-start gap-3">
                  <div className="size-11 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-2xl">
                    ⛽
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-zinc-900">FuelOS</p>
                      <Badge tone="neutral">เร็ว ๆ นี้</Badge>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">
                      น้ำมัน B2B · Driver App · Flash Sale
                    </p>
                    <p className="text-xs text-zinc-400 mt-2 inline-flex items-center gap-1">
                      <Truck className="size-3" />
                      ยังไม่มีข้อมูล
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
            <Card className="border-dashed">
              <CardBody>
                <div className="flex items-start gap-3">
                  <div className="size-11 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-2xl">
                    📄
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-zinc-900">DocuFlow</p>
                      <Badge tone="neutral">เร็ว ๆ นี้</Badge>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">
                      เอกสาร · ลายเซ็นดิจิทัล · Workflow
                    </p>
                    <p className="text-xs text-zinc-400 mt-2 inline-flex items-center gap-1">
                      <FileText className="size-3" />
                      ยังไม่มีข้อมูล
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Section>
      </div>

      {/* Floating Ask AI button — uses existing AI chat */}
      <AiChat />

      {/* Daily cell popup — popup-first drilldown */}
      <Dialog
        open={openCell !== null}
        onClose={() => setOpenCell(null)}
        title={openCell ? `รายละเอียดวันที่ ${openCell.date}` : ""}
      >
        {openCell && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-200 p-4">
              <p className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold">
                ยอดรวมวันนี้ (อนุมัติแล้ว)
              </p>
              <p className="text-2xl sm:text-3xl font-extrabold tabular-num font-display text-zinc-900 mt-1">
                {formatBaht(openCell.total)}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-zinc-500 text-xs">ส่ง</p>
                  <p className="font-bold tabular-num">
                    {openCell.submitted}/{openCell.expected} สาขา
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs">% ครบ</p>
                  <p className="font-bold tabular-num">
                    {openCell.fillRate.toFixed(0)}%
                  </p>
                </div>
              </div>
            </div>
            <Link
              href={`/cashhub/reports?date=${openCell.date}`}
              className="block"
            >
              <Button fullWidth>
                ดูรายงานวันนี้ทั้งหมด
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/* ============================================================
   ClickableHeatmap — 30-day calendar with clickable cells
   (memory rule: heatmap cells must be clickable)
   ============================================================ */
function ClickableHeatmap({
  cells,
  onPick,
}: {
  cells: Array<{
    date: string;
    fillRate: number;
    total: number;
    submitted: number;
    expected: number;
  }>;
  onPick: (
    cell: {
      date: string;
      total: number;
      submitted: number;
      expected: number;
      fillRate: number;
    },
  ) => void;
}) {
  if (cells.length === 0) return null;
  const first = cells[0]!.date;
  const firstDow = new Date(first + "T00:00:00").getDay(); // 0=Sun
  const padBefore = firstDow === 0 ? 6 : firstDow - 1; // start week on Mon
  const padded: (typeof cells[number] | null)[] = [
    ...Array.from({ length: padBefore }, () => null),
    ...cells,
  ];
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-[10px] text-zinc-400 mb-1.5">
        {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((d) => (
          <div key={d} className="text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {padded.map((c, i) => {
          if (!c) return <div key={`b-${i}`} className="aspect-square" />;
          const day = parseInt(c.date.slice(8, 10), 10);
          const color = heatColor(c.fillRate);
          const isToday = todayIso === c.date;
          return (
            <button
              type="button"
              key={c.date}
              onClick={() => onPick(c)}
              title={`${c.date} · ${c.submitted}/${c.expected} สาขา (${c.fillRate.toFixed(0)}%)`}
              className={cn(
                "aspect-square rounded-md flex items-center justify-center text-[10px] font-semibold tabular-num text-zinc-700 cursor-pointer transition-transform hover:scale-110 hover:ring-2 hover:ring-[var(--color-brand-400)]",
                isToday && "ring-2 ring-[var(--color-brand-500)]",
              )}
              style={{ background: color }}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-zinc-500">
        <span className="size-2.5 rounded-sm bg-red-200" />
        <span>0%</span>
        <span className="size-2.5 rounded-sm bg-amber-200 ml-2" />
        <span>50%</span>
        <span className="size-2.5 rounded-sm bg-green-300 ml-2" />
        <span>100%</span>
      </div>
    </div>
  );
}

function heatColor(pct: number): string {
  if (pct === 0) return "#fee2e2";
  if (pct < 33) return "#fecaca";
  if (pct < 66) return "#fde68a";
  if (pct < 90) return "#bef264";
  return "#86efac";
}

/* ============================================================
   helpers
   ============================================================ */
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
  color,
  label,
  value,
  total,
}: {
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
      <span className="text-xs font-semibold text-zinc-700 shrink-0 min-w-[60px]">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <ProgressBar value={pct} fillColor={color} className="h-1.5" />
      </div>
      <span className="text-xs tabular-num font-bold text-zinc-900 shrink-0 w-10 text-right">
        {pct.toFixed(0)}%
      </span>
      <span className="text-[10px] tabular-num text-zinc-500 shrink-0 hidden sm:inline w-14 text-right">
        {formatBahtCompact(value)}
      </span>
    </div>
  );
}

function TypePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors",
        active
          ? "bg-[var(--color-brand-600)] text-white"
          : "text-zinc-600 hover:bg-zinc-50",
      )}
    >
      {label}
    </button>
  );
}
