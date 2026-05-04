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
  ArrowRight,
  Sparkles,
  ScrollText,
  TrendingUp,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Section, SectionDivider } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBaht, formatBahtCompact, thaiDateLong } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";

interface Props {
  userName: string;
  isAdmin: boolean;
  totalReportsAllTime: number;
  monthTotal: number;
  monthPending: number;
  branchCount: number;
  submittedTodayCount: number;
  pendingCount: number;
  byType: Record<
    string,
    { total: number; branchCount: number; submittedToday: number; missingToday: number }
  >;
  pending: {
    id: string;
    branchName: string;
    branchCode: string;
    businessType: string;
    shift: string;
    totalSales: number;
  }[];
}

const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 กะเช้า",
  midday: "☀️ กลางวัน",
  evening: "🌙 กะเย็น",
  all: "ทั้งวัน",
};

export function DashboardView(props: Props) {
  const today = thaiDateLong(new Date());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [seeded, setSeeded] = useState(false);
  const showOnboarding = props.totalReportsAllTime === 0 && props.isAdmin;

  function generateTestData() {
    startTransition(async () => {
      const res = await fetch("/api/dev/seed-test-data", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "สร้างข้อมูลตัวอย่างไม่ได้");
        return;
      }
      toast.success("สร้างข้อมูลตัวอย่างสำเร็จ", {
        description: `${json.created} รายงานใน 7 วันล่าสุด`,
      });
      setSeeded(true);
      router.refresh();
    });
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-7xl mx-auto">
      {/* Module Header */}
      <header className="mb-8 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
          💰 CashHub · {today}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2 text-zinc-900">
          ภาพรวม <span className="accent">ยอดสาขา</span>
        </h1>
        <p className="text-zinc-600 mt-2 max-w-2xl">
          สวัสดี {props.userName} · ภาพรวมยอดขายและสถานะรายงานทุกสาขาของ Pooilgroup
        </p>
      </header>

      {showOnboarding && !seeded && (
        <Card className="mb-8 border-[--color-brand-300] bg-gradient-to-br from-[--color-brand-50] via-white to-white relative overflow-hidden animate-fade-up delay-100">
          <div
            className="absolute top-0 right-0 w-72 h-72 -mt-20 -mr-20 rounded-full opacity-30 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
            }}
          />
          <CardBody className="relative">
            <div className="flex items-start gap-3 mb-4">
              <div className="size-12 shrink-0 rounded-2xl bg-[--color-brand-600] text-white flex items-center justify-center shadow-blue">
                <Sparkles className="size-6" strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-extrabold font-display">
                  เริ่มต้นใช้งาน <span className="accent">CashHub</span>
                </h2>
                <p className="text-sm text-zinc-600 mt-1">
                  ระบบพร้อมใช้แล้ว — มี {props.branchCount} สาขาตัวอย่าง รอข้อมูลเข้ามา
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Button
                onClick={generateTestData}
                loading={pending}
                size="lg"
                fullWidth
              >
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

      {/* Section 01 — Hero Stat */}
      <Section
        number="01"
        label="THIS MONTH"
        title="ยอดสะสมเดือนนี้"
        className="mb-8 animate-fade-up delay-100"
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
          <CardBody className="relative text-white p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              <div>
                <p className="text-xs uppercase tracking-widest text-white/70 font-bold mb-2">
                  ยอดอนุมัติแล้ว
                </p>
                <div className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tabular-num font-display tracking-tight">
                  {formatBaht(props.monthTotal)}
                </div>
                {props.monthPending > 0 && (
                  <p className="text-sm text-white/80 mt-3">
                    + รออนุมัติอีก{" "}
                    <span className="font-bold text-amber-300 tabular-num">
                      {formatBaht(props.monthPending)}
                    </span>
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <HeroStat
                  icon={<Building2 className="size-4" />}
                  label="สาขา"
                  value={props.branchCount.toString()}
                />
                <HeroStat
                  icon={<CheckCircle2 className="size-4" />}
                  label="ส่งวันนี้"
                  value={props.submittedTodayCount.toString()}
                />
                <HeroStat
                  icon={<Clock className="size-4" />}
                  label="รออนุมัติ"
                  value={props.pendingCount.toString()}
                />
              </div>
            </div>
          </CardBody>
        </Card>
      </Section>

      <SectionDivider />

      {/* Section 02 — Breakdown */}
      <Section
        number="02"
        label="BREAKDOWN"
        title="ยอดและสถานะแต่ละสาขา"
        description="แยกตามประเภทธุรกิจ + รายการรออนุมัติ"
        action={
          <Link href="/cashhub/reports">
            <Button variant="outline" size="md">
              ดูรายงานทั้งหมด <ArrowRight className="size-4" />
            </Button>
          </Link>
        }
        className="mb-8 animate-fade-up delay-200"
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>แยกตามประเภทธุรกิจ</CardTitle>
                <p className="text-xs text-zinc-500 mt-0.5">
                  ยอดเดือนนี้ + สถานะวันนี้
                </p>
              </div>
              <Badge tone="brand">
                {Object.values(props.byType).filter((t) => t.branchCount > 0)
                  .length}{" "}
                ประเภท
              </Badge>
            </CardHeader>
            <CardBody className="!p-0">
              {Object.keys(props.byType).length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<Building2 className="size-6" />}
                    title="ยังไม่มีสาขา"
                    description="เพิ่มสาขาเพื่อเริ่มใช้งาน CashHub"
                  />
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {Object.entries(BUSINESS_TYPES).map(([key, config]) => {
                    const stats = props.byType[key];
                    if (!stats || stats.branchCount === 0) return null;
                    return (
                      <li
                        key={key}
                        className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-zinc-50/60 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="size-12 shrink-0 rounded-xl bg-[--color-brand-50] border-2 border-[--color-brand-100] flex items-center justify-center text-2xl">
                            {config.emoji}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-zinc-900 truncate">
                              {config.label}
                            </div>
                            <div className="text-xs text-zinc-500 flex items-center gap-2.5 mt-1 flex-wrap">
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="size-3" />
                                {stats.branchCount} สาขา
                              </span>
                              <span className="inline-flex items-center gap-1 text-green-700 font-semibold">
                                <CheckCircle2 className="size-3" />
                                {stats.submittedToday}
                              </span>
                              {stats.missingToday > 0 && (
                                <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                                  <AlertCircle className="size-3" />
                                  ขาด {stats.missingToday}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-extrabold tabular-num text-lg">
                            {formatBahtCompact(stats.total)}
                          </div>
                          <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">
                            เดือนนี้
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>รออนุมัติ</CardTitle>
                <p className="text-xs text-zinc-500 mt-0.5">10 ล่าสุด</p>
              </div>
              <Badge tone={props.pendingCount > 0 ? "warning" : "success"}>
                {props.pendingCount}
              </Badge>
            </CardHeader>
            <CardBody className="!p-0">
              {props.pending.length === 0 ? (
                <div className="p-5 text-center">
                  <div className="size-12 mx-auto rounded-2xl bg-green-50 border-2 border-green-200 flex items-center justify-center mb-2">
                    <CheckCircle2 className="size-6 text-green-600" />
                  </div>
                  <p className="text-sm text-zinc-600 font-medium">
                    ไม่มีรายงานค้าง
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    ทุกสาขาอนุมัติเรียบร้อย ✨
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {props.pending.map((p) => {
                    const cfg = BUSINESS_TYPES[p.businessType];
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/cashhub/reports/${p.id}`}
                          className="flex items-center justify-between gap-2 px-5 py-3.5 hover:bg-[--color-brand-50]/40 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xl shrink-0">
                              {cfg?.emoji || "📋"}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">
                                {p.branchCode}
                              </div>
                              <div className="text-[11px] text-zinc-500 mt-0.5">
                                {SHIFT_LABEL[p.shift] || p.shift}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold tabular-num">
                              {formatBahtCompact(p.totalSales)}
                            </div>
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
      </Section>

      <SectionDivider />

      {/* Section 03 — Quick Actions */}
      <Section
        number="03"
        label="ACTIONS"
        title="ทางลัด"
        description="ฟีเจอร์ที่ใช้บ่อย"
        className="animate-fade-up delay-300"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ActionTile
            href="/cashhub/reports"
            icon={<TrendingUp className="size-5" />}
            label="ดูยอดทั้งหมด"
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
    <div className="bg-white/10 backdrop-blur rounded-xl px-3 py-2.5 min-w-[80px] border border-white/15">
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
      className="flex items-center gap-3 bg-white rounded-2xl border-2 border-zinc-200 px-4 py-3.5 hover:border-[--color-brand-300] hover:bg-[--color-brand-50]/30 transition-all hover-lift"
    >
      <div className="size-9 rounded-xl bg-[--color-brand-50] border border-[--color-brand-100] flex items-center justify-center text-[--color-brand-700] shrink-0">
        {icon}
      </div>
      <div className="text-sm font-semibold text-zinc-800 truncate">{label}</div>
    </Link>
  );
}
