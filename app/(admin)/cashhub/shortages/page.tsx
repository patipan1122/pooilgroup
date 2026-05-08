// CASHHUB §13 — Shortage report (เงินขาด)
// feedback_role_scoped_views.md — branch_manager เห็นเฉพาะสาขาตน
// feedback_filter_pattern_biztype_first.md — group by ประเภทธุรกิจ
// feedback_popup_first_drilldown.md — กดรายการ = popup

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { startOfMonth, subMonths, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { formatBaht } from "@/lib/utils/format";
import { BackButton } from "@/components/ui/back-button";
import { loadManageableBranches } from "@/lib/auth/branch-access";
import { can } from "@/lib/auth/permissions";
import { ShortagesGrouped, type ShortageRow } from "./shortages-grouped";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

interface RawRow {
  id: string;
  branch_id: string;
  report_date: string;
  amount: number | string;
  person_name: string | null;
  is_identified: boolean;
  note: string | null;
  branches: { code?: string; name?: string; business_type?: string } | null;
}

export default async function ShortagesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; person?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const range = sp.range || "30d";
  const person = sp.person || "";

  const admin = adminClient();
  const now = new Date();
  let startStr: string;
  if (range === "month") {
    startStr = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  } else if (range === "90d") {
    startStr = formatInTimeZone(subDays(now, 89), TZ, "yyyy-MM-dd");
  } else if (range === "prev_month") {
    startStr = formatInTimeZone(startOfMonth(subMonths(now, 1)), TZ, "yyyy-MM-dd");
  } else {
    startStr = formatInTimeZone(subDays(now, 29), TZ, "yyyy-MM-dd");
  }
  const todayStr = formatInTimeZone(now, TZ, "yyyy-MM-dd");

  // Scope by role — branch_manager/staff see only their branches
  const isBranchScoped =
    session.user.role === "branch_manager" || session.user.role === "staff";
  const scopedBranchIds = isBranchScoped
    ? (await loadManageableBranches(session.user)).map((b) => b.id)
    : null;

  let q = admin
    .from("cash_shortages")
    .select(
      "id, branch_id, report_date, amount, person_name, is_identified, note, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .gte("report_date", startStr)
    .lte("report_date", todayStr)
    .order("report_date", { ascending: false });
  if (scopedBranchIds) {
    if (scopedBranchIds.length === 0) {
      // No branches → no rows
      q = q.eq("branch_id", "00000000-0000-0000-0000-000000000000");
    } else {
      q = q.in("branch_id", scopedBranchIds);
    }
  }
  const { data: rows } = await q;

  const all = (rows ?? []).map((r) => ({
    ...r,
    branches: Array.isArray(r.branches) ? r.branches[0] : r.branches,
  })) as RawRow[];

  const filtered = person
    ? all.filter((r) =>
        (r.person_name || "").toLowerCase().includes(person.toLowerCase()),
      )
    : all;

  const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);

  // Group by person (left summary)
  const byPerson = new Map<string, { count: number; total: number }>();
  for (const r of filtered) {
    const key = r.person_name || "(รวมร้าน)";
    const cur = byPerson.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(r.amount || 0);
    byPerson.set(key, cur);
  }
  const personRows = Array.from(byPerson.entries()).sort(
    (a, b) => b[1].total - a[1].total,
  );

  // Map to ShortageRow[] for the grouped view
  const shortageRows: ShortageRow[] = filtered.map((r) => ({
    id: r.id,
    branch_id: r.branch_id,
    branch_code: r.branches?.code ?? "—",
    branch_name: r.branches?.name ?? "",
    business_type: r.branches?.business_type ?? "_unknown",
    report_date: r.report_date,
    amount: Number(r.amount || 0),
    person_name: r.person_name,
    note: r.note,
  }));

  const canApprove = can(session.user, "cashhub.approve");

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold flex items-center gap-2">
            <AlertCircle className="size-4" /> SHORTAGE
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.03em] font-display mt-4 leading-tight">
            เงินขาด <span className="text-gradient-blue">{formatBaht(total)}</span>
          </h1>
          <p className="text-zinc-600 mt-1 text-sm">
            {filtered.length} ครั้ง · {byPerson.size} คน/ทีม
          </p>
        </div>
        <a
          href="/api/cashhub/shortages/export"
          className="inline-flex items-center gap-2 px-4 h-10 rounded-xl border-2 border-zinc-200 bg-white text-zinc-800 font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm"
          title="ดาวน์โหลด CSV เปิดด้วย Excel/Sheets"
        >
          📥 Export CSV
        </a>
      </header>

      {/* Filters */}
      <Card className="mb-5">
        <CardBody>
          <form method="get" className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1.5 min-w-[160px]">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                ช่วงเวลา
              </span>
              <select
                name="range"
                defaultValue={range}
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
              >
                <option value="30d">30 วันล่าสุด</option>
                <option value="90d">90 วันล่าสุด</option>
                <option value="month">เดือนนี้</option>
                <option value="prev_month">เดือนก่อน → ปัจจุบัน</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                ค้นชื่อ
              </span>
              <input
                name="person"
                defaultValue={person}
                placeholder="เช่น สมชาย"
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
              />
            </label>
            <button
              type="submit"
              className="h-10 rounded-xl bg-[var(--color-brand-600)] text-white font-semibold px-5"
            >
              กรอง
            </button>
          </form>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <CheckCircle2 className="size-10 text-green-600 mx-auto mb-3" />
            <p className="font-bold text-lg">ไม่มีเงินขาด</p>
            <p className="text-sm text-zinc-500 mt-1">
              ดีมาก! ทุกสาขายอดตรงพอดี
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Group by person — left summary */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>สรุปรายคน/รายทีม</CardTitle>
            </CardHeader>
            <CardBody className="!p-0">
              <ul className="divide-y divide-zinc-100">
                {personRows.map(([name, agg]) => (
                  <li
                    key={name}
                    className="flex items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {name}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {agg.count} ครั้ง
                      </div>
                    </div>
                    <div className="text-sm font-bold tabular-num text-red-700 shrink-0">
                      {formatBaht(agg.total)}
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {/* Right: grouped by ประเภทธุรกิจ + popup-on-click */}
          <div className="lg:col-span-2">
            <ShortagesGrouped rows={shortageRows} canApprove={canApprove} />
          </div>
        </div>
      )}
    </div>
  );
}
