// Monthly PDF Report — print-optimized HTML (เลือก "Save as PDF" จาก browser)
// 4 หน้าตามสเปค: Executive · Branch Ranking · By Type · Compliance

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PrintButton } from "./print-button";
import { adminClient } from "@/lib/db/server";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  parse,
  getDaysInMonth,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { formatBaht, formatBahtCompact } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const MONTHS_TH = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;

  const monthStr =
    sp.month ||
    formatInTimeZone(subMonths(new Date(), 1), TZ, "yyyy-MM"); // default = last month

  const monthDate = parse(monthStr, "yyyy-MM", new Date());
  const startStr = formatInTimeZone(
    startOfMonth(monthDate),
    TZ,
    "yyyy-MM-dd",
  );
  const endStr = formatInTimeZone(
    endOfMonth(monthDate),
    TZ,
    "yyyy-MM-dd",
  );
  const prevDate = subMonths(monthDate, 1);
  const prevStartStr = formatInTimeZone(
    startOfMonth(prevDate),
    TZ,
    "yyyy-MM-dd",
  );
  const prevEndStr = formatInTimeZone(endOfMonth(prevDate), TZ, "yyyy-MM-dd");
  const daysInMonth = getDaysInMonth(monthDate);

  const admin = adminClient();
  const [branchesQ, monthQ, prevQ] = await Promise.all([
    admin
      .from("branches")
      .select("id, code, name, business_type, province, region")
      .eq("org_id", session.user.org_id)
      .eq("is_active", true)
      .order("code"),
    admin
      .from("daily_reports")
      .select("branch_id, report_date, total_sales, status")
      .eq("org_id", session.user.org_id)
      .gte("report_date", startStr)
      .lte("report_date", endStr),
    admin
      .from("daily_reports")
      .select("total_sales, status")
      .eq("org_id", session.user.org_id)
      .gte("report_date", prevStartStr)
      .lte("report_date", prevEndStr),
  ]);
  const branches = branchesQ.data ?? [];
  const monthRows = (monthQ.data ?? []) as Array<{
    branch_id: string;
    report_date: string;
    total_sales: number | string;
    status: string;
  }>;
  const prevRows = (prevQ.data ?? []) as Array<{
    total_sales: number | string;
    status: string;
  }>;

  const monthApproved = monthRows
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const prevApproved = prevRows
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const delta =
    prevApproved > 0
      ? ((monthApproved - prevApproved) / prevApproved) * 100
      : null;

  // Per branch
  const byBranch = new Map<
    string,
    { code: string; name: string; province: string | null; region: string | null; type: string; total: number; daysFilled: Set<string> }
  >();
  for (const b of branches) {
    byBranch.set(b.id as string, {
      code: b.code as string,
      name: b.name as string,
      province: (b.province as string) ?? null,
      region: (b.region as string) ?? null,
      type: b.business_type as string,
      total: 0,
      daysFilled: new Set(),
    });
  }
  for (const r of monthRows) {
    const obj = byBranch.get(r.branch_id);
    if (!obj) continue;
    if (r.status !== "rejected") obj.daysFilled.add(r.report_date);
    if (r.status === "approved") obj.total += Number(r.total_sales || 0);
  }
  const ranked = Array.from(byBranch.values()).sort((a, b) => b.total - a.total);

  // By type
  const byType = new Map<string, { label: string; emoji: string; total: number; count: number }>();
  for (const obj of byBranch.values()) {
    const cfg = BUSINESS_TYPES[obj.type];
    if (!cfg) continue;
    const cur = byType.get(obj.type) ?? {
      label: cfg.label,
      emoji: cfg.emoji,
      total: 0,
      count: 0,
    };
    cur.total += obj.total;
    cur.count += 1;
    byType.set(obj.type, cur);
  }

  // Compliance
  const complianceRows = ranked.map((b) => ({
    code: b.code,
    name: b.name,
    daysFilled: b.daysFilled.size,
    daysMissed: Math.max(0, daysInMonth - b.daysFilled.size),
  }));
  complianceRows.sort((a, b) => b.daysMissed - a.daysMissed);

  const orgTitle = "Pooilgroup";
  const monthLabel = `${MONTHS_TH[monthDate.getMonth()]} ${(monthDate.getFullYear() + 543) % 100}`;

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .pg { page-break-after: always; }
        }
        @page { size: A4; margin: 18mm; }
      `}</style>

      <div className="no-print bg-zinc-100 border-b-2 border-zinc-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            href="/cashhub/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-[--color-brand-700]"
          >
            <ArrowLeft className="size-4" />
            ภาพรวม
          </Link>
          <form method="get" className="flex items-center gap-2">
            <input
              type="month"
              name="month"
              defaultValue={monthStr}
              className="h-9 rounded-xl border border-zinc-200 px-2 text-sm bg-white"
            />
            <button
              type="submit"
              className="h-9 px-3 rounded-xl bg-zinc-200 text-sm font-semibold"
            >
              เลือกเดือน
            </button>
            <PrintButton />
          </form>
        </div>
      </div>

      <div className="bg-white text-zinc-900">
        <div className="max-w-4xl mx-auto px-6 sm:px-10 py-10 print:py-0 print:px-0 space-y-8">
          {/* PAGE 1 — EXECUTIVE */}
          <section className="pg">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[--color-brand-600] font-bold">
                  EXECUTIVE SUMMARY
                </p>
                <h1 className="text-4xl font-extrabold font-display mt-1 text-zinc-900">
                  {orgTitle} <span className="accent">รายงานเดือน {monthLabel}</span>
                </h1>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-4">
              <Stat label="ยอดอนุมัติแล้ว" value={formatBaht(monthApproved)} />
              <Stat
                label="vs เดือนก่อน"
                value={delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : "—"}
              />
              <Stat label="สาขา" value={`${branches.length}`} />
            </div>

            <div className="mt-8">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold mb-3">
                ยอดเดือนที่ผ่านมา
              </p>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-zinc-100">
                    <td className="py-2">เดือนนี้</td>
                    <td className="py-2 text-right tabular-num font-bold">
                      {formatBaht(monthApproved)}
                    </td>
                  </tr>
                  <tr className="border-b border-zinc-100">
                    <td className="py-2 text-zinc-500">เดือนก่อน</td>
                    <td className="py-2 text-right tabular-num text-zinc-500">
                      {formatBaht(prevApproved)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 font-bold">เปลี่ยนแปลง</td>
                    <td
                      className={`py-2 text-right tabular-num font-bold ${
                        (delta ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {delta !== null
                        ? `${delta >= 0 ? "+" : ""}${formatBaht(monthApproved - prevApproved)}`
                        : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* PAGE 2 — RANKING */}
          <section className="pg">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[--color-brand-600] font-bold">
              BRANCH RANKING
            </p>
            <h2 className="text-3xl font-extrabold font-display mt-1">
              อันดับสาขา <span className="accent">เดือน {monthLabel}</span>
            </h2>
            <table className="w-full text-sm mt-6">
              <thead>
                <tr className="border-b-2 border-zinc-200 text-[10px] uppercase tracking-widest text-zinc-400">
                  <th className="text-left p-2 w-10">#</th>
                  <th className="text-left p-2">รหัส / ชื่อ</th>
                  <th className="text-left p-2">จังหวัด</th>
                  <th className="text-right p-2">ยอด</th>
                  <th className="text-right p-2">วันที่กรอก</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((b, i) => (
                  <tr key={b.code} className="border-b border-zinc-100">
                    <td className="p-2 text-right tabular-num text-zinc-400">
                      {i + 1}
                    </td>
                    <td className="p-2">
                      <span className="font-bold tabular-num">{b.code}</span>
                      <span className="text-xs text-zinc-500 ml-2">
                        {b.name}
                      </span>
                    </td>
                    <td className="p-2 text-zinc-500">{b.province ?? "—"}</td>
                    <td className="p-2 text-right tabular-num font-bold">
                      {formatBahtCompact(b.total)}
                    </td>
                    <td className="p-2 text-right tabular-num text-zinc-500">
                      {b.daysFilled.size}/{daysInMonth}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* PAGE 3 — BY TYPE */}
          <section className="pg">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[--color-brand-600] font-bold">
              BY BUSINESS TYPE
            </p>
            <h2 className="text-3xl font-extrabold font-display mt-1">
              แยกตาม <span className="accent">ประเภทธุรกิจ</span>
            </h2>
            <table className="w-full text-sm mt-6">
              <thead>
                <tr className="border-b-2 border-zinc-200 text-[10px] uppercase tracking-widest text-zinc-400">
                  <th className="text-left p-2"></th>
                  <th className="text-left p-2">ประเภท</th>
                  <th className="text-right p-2">สาขา</th>
                  <th className="text-right p-2">ยอด</th>
                  <th className="text-right p-2">% ของรวม</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byType.values())
                  .sort((a, b) => b.total - a.total)
                  .map((t) => (
                    <tr key={t.label} className="border-b border-zinc-100">
                      <td className="p-2 text-2xl">{t.emoji}</td>
                      <td className="p-2 font-bold">{t.label}</td>
                      <td className="p-2 text-right tabular-num">
                        {t.count}
                      </td>
                      <td className="p-2 text-right tabular-num font-bold">
                        {formatBahtCompact(t.total)}
                      </td>
                      <td className="p-2 text-right tabular-num text-zinc-500">
                        {monthApproved > 0
                          ? ((t.total / monthApproved) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          {/* PAGE 4 — COMPLIANCE */}
          <section>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[--color-brand-600] font-bold">
              REPORT COMPLIANCE
            </p>
            <h2 className="text-3xl font-extrabold font-display mt-1">
              สาขาที่กรอก <span className="accent">ครบ / ไม่ครบ</span>
            </h2>
            <p className="text-sm text-zinc-500 mt-2">
              รวม {daysInMonth} วันในเดือน · เรียงตามวันที่ขาดจากมากไปน้อย
            </p>
            <table className="w-full text-sm mt-6">
              <thead>
                <tr className="border-b-2 border-zinc-200 text-[10px] uppercase tracking-widest text-zinc-400">
                  <th className="text-left p-2">สาขา</th>
                  <th className="text-right p-2">กรอก</th>
                  <th className="text-right p-2">ขาด</th>
                  <th className="text-right p-2">% Compliance</th>
                </tr>
              </thead>
              <tbody>
                {complianceRows.map((r) => {
                  const pct = (r.daysFilled / daysInMonth) * 100;
                  return (
                    <tr key={r.code} className="border-b border-zinc-100">
                      <td className="p-2">
                        <span className="font-bold tabular-num">{r.code}</span>
                        <span className="text-xs text-zinc-500 ml-2">
                          {r.name}
                        </span>
                      </td>
                      <td className="p-2 text-right tabular-num">
                        {r.daysFilled}
                      </td>
                      <td
                        className={`p-2 text-right tabular-num font-bold ${
                          r.daysMissed > 0 ? "text-rose-700" : "text-emerald-700"
                        }`}
                      >
                        {r.daysMissed}
                      </td>
                      <td className="p-2 text-right tabular-num text-zinc-500">
                        {pct.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-zinc-400 mt-8 text-right">
              สร้างเมื่อ {formatInTimeZone(new Date(), TZ, "d MMM yyyy HH:mm")} · {orgTitle}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-zinc-200 rounded-2xl p-4">
      <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
        {label}
      </p>
      <div className="text-3xl font-extrabold tabular-num font-display mt-1">
        {value}
      </div>
    </div>
  );
}
