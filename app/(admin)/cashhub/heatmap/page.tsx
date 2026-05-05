// Full calendar heatmap (per branch × per day) — quick visual fill audit

import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  startOfMonth,
  getDate,
  getDaysInMonth,
  subDays,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export default async function HeatmapPage() {
  const session = await requireSession();
  const admin = adminClient();
  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const daysInMonth = getDaysInMonth(now);
  const daysElapsed = getDate(now);

  const [branchesQ, reportsQ] = await Promise.all([
    admin
      .from("branches")
      .select("id, code, name, business_type")
      .eq("org_id", session.user.org_id)
      .eq("is_active", true)
      .order("code"),
    admin
      .from("daily_reports")
      .select("branch_id, report_date, status")
      .eq("org_id", session.user.org_id)
      .gte("report_date", monthStart)
      .lte("report_date", today),
  ]);

  const branches = branchesQ.data ?? [];
  const reports = reportsQ.data ?? [];

  // Build matrix: branch -> Map<dayNumber, status>
  const matrix = new Map<string, Map<number, string>>();
  for (const r of reports) {
    const day = parseInt(r.report_date.slice(8, 10), 10);
    const m = matrix.get(r.branch_id) ?? new Map<number, string>();
    // approved beats submitted beats rejected
    const cur = m.get(day);
    const next = r.status as string;
    if (
      !cur ||
      (cur !== "approved" && next === "approved") ||
      (cur === "rejected" && next === "submitted")
    ) {
      m.set(day, next);
    }
    matrix.set(r.branch_id, m);
  }

  // Today day number
  const todayDay = getDate(now);

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <Link
        href="/cashhub/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[--color-brand-700]"
      >
        <ArrowLeft className="size-4" />
        ภาพรวม
      </Link>
      <header className="mt-3 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[--color-brand-600] font-bold flex items-center gap-2">
          <CalendarDays className="size-4" /> HEATMAP
        </p>
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          ปฏิทิน <span className="text-gradient-blue">สาขา × วัน</span>
        </h1>
        <p className="text-zinc-600 mt-1 text-sm">
          ทุกสาขา × ทุกวันในเดือนนี้ — ดูได้ทันทีว่าวันไหนใครขาด
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mb-3">
        <Badge tone="success">✅ อนุมัติ</Badge>
        <Badge tone="warning">⏳ รออนุมัติ</Badge>
        <Badge tone="danger">🔴 ปฏิเสธ / ❌ ไม่กรอก</Badge>
        <span className="text-[11px]">เดือนนี้ {daysElapsed}/{daysInMonth} วัน</span>
      </div>

      <Section number="01" label="MATRIX" title={`${branches.length} สาขา × ${daysInMonth} วัน`}>
        <Card>
          <CardHeader>
            <CardTitle>ตารางกรอกครบ</CardTitle>
            <Badge tone="brand">{reports.length} รายงาน</Badge>
          </CardHeader>
          <CardBody className="!p-0 overflow-x-auto">
            <table className="text-xs min-w-full">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b border-zinc-100">
                  <th className="text-left p-2 sticky left-0 bg-white z-20">
                    สาขา
                  </th>
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                    <th
                      key={d}
                      className={cn(
                        "p-1 text-center font-semibold tabular-num text-[10px] w-7",
                        d === todayDay && "text-[--color-brand-700] font-extrabold",
                      )}
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => {
                  const cfg = BUSINESS_TYPES[b.business_type];
                  const m = matrix.get(b.id) ?? new Map();
                  return (
                    <tr key={b.id} className="border-b border-zinc-50">
                      <td className="p-2 sticky left-0 bg-white whitespace-nowrap font-medium">
                        <Link
                          href={`/cashhub/branches/${b.id}`}
                          className="inline-flex items-center gap-1.5 hover:text-[--color-brand-700]"
                        >
                          <span>{cfg?.emoji}</span>
                          <span className="tabular-num">{b.code}</span>
                        </Link>
                      </td>
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                        const isFuture = d > todayDay;
                        const status = m.get(d);
                        return (
                          <td key={d} className="p-0.5 text-center">
                            <div
                              className={cn(
                                "size-5 mx-auto rounded-md text-[9px] flex items-center justify-center font-bold",
                                cellColor(status, isFuture),
                              )}
                              title={`${b.code} วันที่ ${d}: ${status ?? "ไม่กรอก"}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function cellColor(status: string | undefined, isFuture: boolean): string {
  if (isFuture) return "bg-zinc-50";
  if (status === "approved") return "bg-emerald-300";
  if (status === "submitted") return "bg-amber-200";
  if (status === "rejected") return "bg-red-200";
  return "bg-zinc-100";
}

void subDays;
