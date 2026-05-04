"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  TrendingUp,
  Clock,
  Building2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  ScrollText,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      toast.success(`สร้างข้อมูลตัวอย่างสำเร็จ`, {
        description: `${json.created} รายงาน ใน 7 วันล่าสุด`,
      });
      setSeeded(true);
      router.refresh();
    });
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-zinc-500">{today}</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight font-display mt-0.5">
            สวัสดี {props.userName}
          </h1>
          <p className="text-zinc-600 mt-1 text-sm sm:text-base">
            ภาพรวมยอดสาขาทั้งหมดของ Pool Group
          </p>
        </div>
        <Link href="/cashhub">
          <Button variant="outline" size="md">
            ดูยอดทั้งหมด <ArrowRight className="size-4" />
          </Button>
        </Link>
      </div>

      {/* Onboarding (first-run, no data) */}
      {showOnboarding && !seeded && (
        <Card className="mb-6 border-[--color-brand-200] bg-gradient-to-br from-[--color-brand-50] to-white overflow-hidden relative">
          <div
            className="absolute top-0 right-0 w-64 h-64 -mt-20 -mr-20 rounded-full opacity-30 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, oklch(0.55 0.16 165) 0%, transparent 70%)",
            }}
          />
          <CardBody className="relative pt-6">
            <div className="flex items-start gap-3 mb-4">
              <Sparkles className="size-6 text-[--color-brand-600] shrink-0 mt-1" />
              <div>
                <h2 className="text-lg font-semibold font-display">
                  เริ่มต้นใช้งานระบบ
                </h2>
                <p className="text-sm text-zinc-600 mt-1">
                  ระบบพร้อมใช้แล้ว — มี 5 สาขาตัวอย่าง รอข้อมูลเข้ามา
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
              <Link href="/branches" className="block">
                <Button variant="outline" size="lg" fullWidth>
                  <Building2 className="size-4" />
                  ดูสาขา
                </Button>
              </Link>
            </div>
            <p className="text-xs text-zinc-500 mt-3">
              💡 "สร้างข้อมูลตัวอย่าง" จะเพิ่มรายงาน ~7 วันให้ทุกสาขา —
              ลบได้ผ่าน Supabase SQL Editor (DELETE FROM daily_reports)
            </p>
          </CardBody>
        </Card>
      )}

      {/* Hero stat — month total */}
      <Card className="mb-6 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 100% 0%, oklch(0.55 0.16 165) 0%, transparent 50%)",
          }}
        />
        <CardBody className="relative pt-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-500 mb-1">ยอดสะสมเดือนนี้</p>
              <div className="text-4xl sm:text-5xl font-semibold tabular-num font-display tracking-tight text-zinc-900">
                {formatBaht(props.monthTotal)}
              </div>
              {props.monthPending > 0 && (
                <p className="text-sm text-zinc-500 mt-2">
                  + รออนุมัติอีก{" "}
                  <span className="font-medium text-amber-600 tabular-num">
                    {formatBaht(props.monthPending)}
                  </span>
                </p>
              )}
            </div>
            <div className="flex gap-2 sm:gap-3">
              <Stat
                icon={<Building2 className="size-4" />}
                label="สาขา"
                value={props.branchCount.toString()}
              />
              <Stat
                icon={<CheckCircle2 className="size-4 text-green-600" />}
                label="ส่งวันนี้"
                value={props.submittedTodayCount.toString()}
              />
              <Stat
                icon={<Clock className="size-4 text-amber-600" />}
                label="รออนุมัติ"
                value={props.pendingCount.toString()}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* By business type */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>แยกตามประเภทธุรกิจ</CardTitle>
              <p className="text-xs text-zinc-500 mt-0.5">
                ยอดเดือนนี้ + สถานะวันนี้
              </p>
            </div>
            <Badge tone="brand">7 ประเภท</Badge>
          </CardHeader>
          <CardBody className="space-y-1">
            {Object.entries(BUSINESS_TYPES).map(([key, config]) => {
              const stats = props.byType[key];
              if (!stats || stats.branchCount === 0) return null;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between py-3 border-b border-zinc-100 last:border-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-2xl shrink-0">{config.emoji}</div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {config.label}
                      </div>
                      <div className="text-xs text-zinc-500 flex items-center gap-2 mt-0.5">
                        <span>{stats.branchCount} สาขา</span>
                        <span className="text-green-600 inline-flex items-center gap-0.5">
                          <CheckCircle2 className="size-3" />
                          {stats.submittedToday}
                        </span>
                        {stats.missingToday > 0 && (
                          <span className="text-red-600 inline-flex items-center gap-0.5">
                            <AlertCircle className="size-3" />
                            {stats.missingToday} ขาด
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="font-semibold tabular-num">
                      {formatBahtCompact(stats.total)}
                    </div>
                  </div>
                </div>
              );
            })}
            {Object.keys(props.byType).length === 0 && (
              <p className="text-sm text-zinc-500 text-center py-8">
                ยังไม่มีสาขา — เพิ่มสาขาก่อน
              </p>
            )}
          </CardBody>
        </Card>

        {/* Pending approvals */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>รออนุมัติ</CardTitle>
              <p className="text-xs text-zinc-500 mt-0.5">
                10 รายการล่าสุด
              </p>
            </div>
            <Badge tone={props.pendingCount > 0 ? "warning" : "success"}>
              {props.pendingCount}
            </Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            {props.pending.length === 0 && (
              <div className="text-center py-8">
                <CheckCircle2 className="size-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-zinc-500">
                  ไม่มีรายงานค้างอนุมัติ ✨
                </p>
              </div>
            )}
            {props.pending.map((p) => {
              const cfg = BUSINESS_TYPES[p.businessType];
              return (
                <Link
                  key={p.id}
                  href={`/reports/${p.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-lg">{cfg?.emoji || "📋"}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {p.branchCode} · {p.branchName}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {SHIFT_LABEL[p.shift] || p.shift}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium tabular-num shrink-0">
                    {formatBahtCompact(p.totalSales)}
                  </div>
                </Link>
              );
            })}
          </CardBody>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickAction
          href="/cashhub"
          label="ดูยอดทั้งหมด"
          icon={<TrendingUp className="size-5" />}
        />
        <QuickAction
          href="/branches"
          label="จัดการสาขา"
          icon={<Building2 className="size-5" />}
        />
        <QuickAction
          href="/reports"
          label="ประวัติรายงาน"
          icon={<Clock className="size-5" />}
        />
        <QuickAction
          href="/settings"
          label="ตั้งค่า"
          icon={<AlertCircle className="size-5" />}
        />
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-zinc-50 rounded-xl px-3 py-2 min-w-[68px]">
      <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold tabular-num">{value}</div>
    </div>
  );
}

function QuickAction({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 bg-white rounded-2xl border border-zinc-200 px-4 py-3.5 hover:border-[--color-brand-300] hover:bg-[--color-brand-50]/30 transition-colors shadow-soft"
    >
      <div className="text-zinc-600">{icon}</div>
      <div className="text-sm font-medium text-zinc-800">{label}</div>
    </Link>
  );
}

const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 กะเช้า",
  midday: "☀️ กลางวัน",
  evening: "🌙 กะเย็น",
  all: "ทั้งวัน",
};
