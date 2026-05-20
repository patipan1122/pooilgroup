// CASHHUB §13 — Shortage report (เงินขาด)
// D-020 (2026-05-20): CEO ต้องการ
//   1) เลือกเดือนตรงๆ (พ.ค. / มิ.ย. / ...) หรือช่วง from-to
//   2) จัดกลุ่มตามสาขา default · เห็น "สาขานี้มีใครขาดวันไหนบ้าง"
//   3) filter ตามสาขา/พนักงาน
// feedback_role_scoped_views.md — branch_manager เห็นเฉพาะสาขาตน
// feedback_popup_first_drilldown.md — กดรายการ = popup

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  subDays,
  parse,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { formatBaht } from "@/lib/utils/format";
import { BackButton } from "@/components/ui/back-button";
import { loadManageableBranches } from "@/lib/auth/branch-access";
import { can } from "@/lib/auth/permissions";
import {
  ShortagesGrouped,
  type ShortageRow,
  type ShortageGroupBy,
} from "./shortages-grouped";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const MONTHS_TH_FULL = [
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
  searchParams: Promise<{
    range?: string;
    month?: string;
    from?: string;
    to?: string;
    person?: string;
    branchId?: string;
    groupBy?: string;
  }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const range = sp.range || "30d";
  const monthParam = sp.month || "";
  const fromParam = sp.from || "";
  const toParam = sp.to || "";
  const person = sp.person || "";
  const branchId = sp.branchId || "";
  const groupBy: ShortageGroupBy =
    sp.groupBy === "business_type" || sp.groupBy === "person"
      ? sp.groupBy
      : "branch";

  // Resolve time window — priority: from+to > month > range
  const now = new Date();
  let startStr: string;
  let endStr: string;
  let rangeLabel: string;

  if (fromParam && toParam) {
    startStr = fromParam;
    endStr = toParam;
    rangeLabel = `${fromParam} → ${toParam}`;
  } else if (monthParam) {
    const monthDate = parse(monthParam, "yyyy-MM", new Date());
    startStr = formatInTimeZone(startOfMonth(monthDate), TZ, "yyyy-MM-dd");
    endStr = formatInTimeZone(endOfMonth(monthDate), TZ, "yyyy-MM-dd");
    rangeLabel = `${MONTHS_TH_FULL[monthDate.getMonth()]} ${monthDate.getFullYear() + 543}`;
  } else if (range === "month") {
    startStr = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
    endStr = formatInTimeZone(now, TZ, "yyyy-MM-dd");
    rangeLabel = "เดือนนี้";
  } else if (range === "90d") {
    startStr = formatInTimeZone(subDays(now, 89), TZ, "yyyy-MM-dd");
    endStr = formatInTimeZone(now, TZ, "yyyy-MM-dd");
    rangeLabel = "90 วันล่าสุด";
  } else if (range === "prev_month") {
    startStr = formatInTimeZone(
      startOfMonth(subMonths(now, 1)),
      TZ,
      "yyyy-MM-dd",
    );
    endStr = formatInTimeZone(now, TZ, "yyyy-MM-dd");
    rangeLabel = "เดือนก่อน → ปัจจุบัน";
  } else {
    startStr = formatInTimeZone(subDays(now, 29), TZ, "yyyy-MM-dd");
    endStr = formatInTimeZone(now, TZ, "yyyy-MM-dd");
    rangeLabel = "30 วันล่าสุด";
  }

  const admin = adminClient();

  // Scope by role — branch_manager/staff see only their branches
  const isBranchScoped =
    session.user.role === "branch_manager" || session.user.role === "staff";
  const scopedBranchIds = isBranchScoped
    ? (await loadManageableBranches(session.user)).map((b) => b.id)
    : null;

  // Branch list for dropdown (admins see all · scoped users see their own)
  const branchListQ = await admin
    .from("branches")
    .select("id, code, name, business_type, is_active")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .order("code");
  let allBranches = (branchListQ.data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    business_type: string;
  }>;
  if (scopedBranchIds) {
    allBranches = allBranches.filter((b) => scopedBranchIds.includes(b.id));
  }

  // Build month options (last 12 months + 1 ahead)
  const monthOptions: Array<{ value: string; label: string }> = [];
  for (let i = -1; i < 12; i++) {
    const d = subMonths(now, i);
    const value = formatInTimeZone(d, TZ, "yyyy-MM");
    const label = `${MONTHS_TH_FULL[d.getMonth()]} ${d.getFullYear() + 543}`;
    monthOptions.push({ value, label });
  }

  let q = admin
    .from("cash_shortages")
    .select(
      "id, branch_id, report_date, amount, person_name, is_identified, note, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .gte("report_date", startStr)
    .lte("report_date", endStr)
    .order("report_date", { ascending: false });
  if (scopedBranchIds) {
    if (scopedBranchIds.length === 0) {
      q = q.eq("branch_id", "00000000-0000-0000-0000-000000000000");
    } else {
      q = q.in("branch_id", scopedBranchIds);
    }
  }
  if (branchId) {
    q = q.eq("branch_id", branchId);
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
    const key = r.person_name || "(ไม่ระบุชื่อ)";
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

  // Build CSV export URL with current filters
  const exportParams = new URLSearchParams();
  exportParams.set("from", startStr);
  exportParams.set("to", endStr);
  if (branchId) exportParams.set("branchId", branchId);
  const exportUrl = `/api/cashhub/shortages/export?${exportParams.toString()}`;

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
            {rangeLabel} · {filtered.length} ครั้ง · {byPerson.size} คน/ทีม
          </p>
        </div>
        <a
          href={exportUrl}
          className="inline-flex items-center gap-2 px-4 h-10 rounded-xl border-2 border-zinc-200 bg-white text-zinc-800 font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm"
          title="ดาวน์โหลด CSV เปิดด้วย Excel/Sheets · ส่งให้ HR หักเงินเดือน"
        >
          📥 Export CSV (ส่ง HR)
        </a>
      </header>

      {/* Filters */}
      <Card className="mb-5">
        <CardBody>
          <form method="get" className="space-y-3">
            {/* Row 1: Quick range + Month picker */}
            <div className="flex flex-wrap gap-3 items-end">
              <label className="flex flex-col gap-1.5 min-w-[160px]">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                  ช่วงด่วน
                </span>
                <select
                  name="range"
                  defaultValue={
                    fromParam || monthParam ? "" : range
                  }
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
                >
                  <option value="">— ไม่ใช้ —</option>
                  <option value="30d">30 วันล่าสุด</option>
                  <option value="90d">90 วันล่าสุด</option>
                  <option value="month">เดือนนี้</option>
                  <option value="prev_month">เดือนก่อน → ปัจจุบัน</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 min-w-[160px]">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                  เลือกเดือน
                </span>
                <select
                  name="month"
                  defaultValue={monthParam}
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
                >
                  <option value="">— เลือกเดือน —</option>
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                  จากวันที่
                </span>
                <input
                  type="date"
                  name="from"
                  defaultValue={fromParam}
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                  ถึงวันที่
                </span>
                <input
                  type="date"
                  name="to"
                  defaultValue={toParam}
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
                />
              </label>
            </div>

            {/* Row 2: Branch + Person search + Group toggle */}
            <div className="flex flex-wrap gap-3 items-end">
              <label className="flex flex-col gap-1.5 min-w-[180px]">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                  สาขา
                </span>
                <select
                  name="branchId"
                  defaultValue={branchId}
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
                >
                  <option value="">ทั้งหมด</option>
                  {allBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                  ค้นชื่อพนักงาน
                </span>
                <input
                  name="person"
                  defaultValue={person}
                  placeholder="เช่น สมชาย"
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                  มุมมอง
                </span>
                <select
                  name="groupBy"
                  defaultValue={groupBy}
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
                >
                  <option value="branch">ตามสาขา</option>
                  <option value="person">ตามพนักงาน</option>
                  <option value="business_type">ตามประเภทธุรกิจ</option>
                </select>
              </label>

              <button
                type="submit"
                className="h-10 rounded-xl bg-[var(--color-brand-600)] text-white font-semibold px-5"
              >
                กรอง
              </button>

              <a
                href="/cashhub/shortages"
                className="h-10 rounded-xl border-2 border-zinc-200 text-zinc-700 font-semibold px-4 inline-flex items-center text-sm hover:bg-zinc-50"
              >
                ล้างกรอง
              </a>
            </div>

            <p className="text-[11px] text-zinc-400">
              💡 ลำดับการใช้: ถ้ากรอก &ldquo;จาก-ถึงวันที่&rdquo; ระบบจะใช้ช่วงนั้น · ถ้าเลือกเดือน
              ใช้เดือนนั้น · ถ้าไม่ทั้งสองอย่าง ใช้ &ldquo;ช่วงด่วน&rdquo;
            </p>
          </form>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <CheckCircle2 className="size-10 text-green-600 mx-auto mb-3" />
            <p className="font-bold text-lg">ไม่มีเงินขาด</p>
            <p className="text-sm text-zinc-500 mt-1">
              ในช่วง {rangeLabel} ทุกสาขายอดตรงพอดี
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Left summary — by person */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>สรุปรายคน</CardTitle>
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

          {/* Right: grouped by selected mode */}
          <div className="lg:col-span-2">
            <ShortagesGrouped
              rows={shortageRows}
              canApprove={canApprove}
              groupBy={groupBy}
            />
          </div>
        </div>
      )}
    </div>
  );
}
