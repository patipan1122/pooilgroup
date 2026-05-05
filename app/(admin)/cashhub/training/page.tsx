// Training center monthly summary — รายได้ + จำนวนครั้งจัด

import Link from "next/link";
import {GraduationCap } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBaht, bkkDate } from "@/lib/utils/format";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { BackButton } from "@/components/ui/back-button";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export default async function TrainingPage() {
  const session = await requireSession();
  const admin = adminClient();
  const now = new Date();
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const monthEnd = formatInTimeZone(endOfMonth(now), TZ, "yyyy-MM-dd");
  const sixMonthsAgo = formatInTimeZone(
    startOfMonth(subMonths(now, 5)),
    TZ,
    "yyyy-MM-dd",
  );

  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name")
    .eq("org_id", session.user.org_id)
    .eq("business_type", "training_center")
    .eq("is_active", true)
    .order("code");

  const ids = (branches ?? []).map((b) => b.id);
  const reportsByBranch = new Map<
    string,
    Array<{ id: string; report_date: string; total_sales: number | string; qty1: number | string | null; qty2: number | string | null; status: string }>
  >();
  if (ids.length > 0) {
    const { data: reports } = await admin
      .from("daily_reports")
      .select(
        "id, branch_id, report_date, total_sales, qty1, qty2, status",
      )
      .eq("org_id", session.user.org_id)
      .in("branch_id", ids)
      .gte("report_date", sixMonthsAgo)
      .order("report_date", { ascending: false });
    for (const r of reports ?? []) {
      const arr = reportsByBranch.get(r.branch_id as string) ?? [];
      arr.push({
        id: r.id as string,
        report_date: r.report_date as string,
        total_sales: r.total_sales as number | string,
        qty1: r.qty1 as number | string | null,
        qty2: r.qty2 as number | string | null,
        status: r.status as string,
      });
      reportsByBranch.set(r.branch_id as string, arr);
    }
  }

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold flex items-center gap-2">
          <GraduationCap className="size-4" /> TRAINING
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-1">
          ศูนย์ <span className="accent">ฝึกอบรม</span>
        </h1>
        <p className="text-zinc-600 mt-1 text-sm">
          กรอกรายเดือน — รวมจำนวนครั้งที่จัดอบรม + รายได้
        </p>
      </header>

      {(!branches || branches.length === 0) ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<GraduationCap className="size-6" />}
              title="ยังไม่มีศูนย์ฝึกอบรม"
              description="เพิ่มสาขาประเภท ศูนย์ฝึกอบรม ก่อน"
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {branches.map((b) => {
            const list = reportsByBranch.get(b.id) ?? [];
            const thisMonth = list.filter(
              (r) =>
                r.report_date >= monthStart &&
                r.report_date <= monthEnd &&
                r.status !== "rejected",
            );
            const monthTotal = thisMonth.reduce(
              (s, r) => s + Number(r.total_sales || 0),
              0,
            );
            const monthSessions = thisMonth.reduce(
              (s, r) => s + (Number(r.qty1 ?? 0) || 0),
              0,
            );
            const monthAttendees = thisMonth.reduce(
              (s, r) => s + (Number(r.qty2 ?? 0) || 0),
              0,
            );

            // Last 6 months trend
            const byMonth = new Map<string, number>();
            for (const r of list) {
              if (r.status !== "approved") continue;
              const key = r.report_date.slice(0, 7);
              byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.total_sales || 0));
            }
            const trend = Array.from(byMonth.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .slice(-6);

            return (
              <Card key={b.id}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>{b.code}</CardTitle>
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                      {b.name}
                    </p>
                  </div>
                  <Link
                    href={`/liff/report/${b.id}`}
                    className="inline-flex items-center justify-center h-9 rounded-xl bg-[var(--color-brand-600)] text-white px-4 text-sm font-bold shadow-blue hover:bg-[var(--color-brand-700)]"
                  >
                    บันทึกอบรมเดือนนี้
                  </Link>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <Stat
                      label="ครั้งที่จัด"
                      value={monthSessions.toLocaleString("th-TH")}
                    />
                    <Stat
                      label="ผู้เข้าอบรม"
                      value={monthAttendees.toLocaleString("th-TH")}
                    />
                    <Stat
                      label="รายได้เดือนนี้"
                      value={formatBaht(monthTotal)}
                    />
                  </div>

                  {trend.length > 1 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">
                        แนวโน้ม 6 เดือน
                      </p>
                      <div className="flex items-end gap-1.5 h-16">
                        {(() => {
                          const max = Math.max(...trend.map((t) => t[1]), 1);
                          return trend.map(([month, total]) => (
                            <div
                              key={month}
                              className="flex-1 flex flex-col items-center gap-1"
                              title={`${month}: ฿${total.toLocaleString("th-TH")}`}
                            >
                              <div
                                className="w-full bg-[var(--color-brand-200)] rounded-t"
                                style={{
                                  height: `${(total / max) * 100}%`,
                                  minHeight: total > 0 ? "4px" : "0",
                                }}
                              />
                              <span className="text-[9px] text-zinc-400 tabular-num">
                                {month.slice(5)}
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Section
        number="01"
        label="HISTORY"
        title="ประวัติเดือนที่ผ่านมา"
        className="mt-8"
      >
        <Card>
          <CardBody className="!p-0">
            <ul className="divide-y divide-zinc-100">
              {Array.from(reportsByBranch.values())
                .flat()
                .filter((r) => r.status !== "rejected")
                .sort((a, b) => b.report_date.localeCompare(a.report_date))
                .slice(0, 12)
                .map((r) => {
                  const branch = branches?.find((b) =>
                    (reportsByBranch.get(b.id) ?? []).some(
                      (x) => x.id === r.id,
                    ),
                  );
                  return (
                    <li
                      key={r.id}
                      className="px-4 py-3 flex items-center justify-between"
                    >
                      <div>
                        <Link
                          href={`/cashhub/reports/${r.id}`}
                          className="text-sm font-bold hover:text-[var(--color-brand-700)]"
                        >
                          {branch?.code} · {bkkDate(r.report_date)}
                        </Link>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {Number(r.qty1 ?? 0)} ครั้ง ·{" "}
                          {Number(r.qty2 ?? 0)} คน
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold tabular-num">
                          {formatBaht(Number(r.total_sales || 0))}
                        </div>
                        {r.status === "submitted" && (
                          <Badge tone="warning" className="mt-0.5">
                            รออนุมัติ
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
        {label}
      </p>
      <div className="text-lg font-extrabold tabular-num font-display mt-0.5">
        {value}
      </div>
    </div>
  );
}
