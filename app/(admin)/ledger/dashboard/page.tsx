// Ledger · Dashboard — ค่าใช้จ่ายตามหมวด / สาขา / เดือน (confirmed+locked only).
// Real data, org+company(+branch) scoped. Basic bar visuals (no chart lib needed).
// Role gate matches the nav policy in lib/modules.ts (staff/driver excluded —
// the dashboard shows org-wide P&L which front-line roles must not see).
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import {
  expenseSummary,
  spendByCategory,
  expenseByBranch,
  expenseByMonth,
  listBudgets,
} from "../_data";
import { currentPeriodBangkok } from "@/lib/ledger/dashboard";
import { InsightsPanel } from "./_components/InsightsPanel";
import { QaBox } from "./_components/QaBox";
import { BudgetVsActual } from "./_components/BudgetVsActual";

export const dynamic = "force-dynamic";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
/** Shift a YYYY-MM period by N months (deterministic UTC math). */
function shiftPeriod(p: string, delta: number): string {
  const [y, m] = p.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function thMonthLabel(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return `${TH_MONTHS[m - 1] ?? p} ${(y + 543) % 100}`;
}

function BarRow({
  label,
  value,
  max,
  color = "var(--color-brand-500)",
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
}) {
  return (
    <li>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="truncate text-zinc-700">{label}</span>
        <span className="font-semibold tabular-nums text-zinc-900">
          {baht(value)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${(value / max) * 100}%`, background: color }}
        />
      </div>
    </li>
  );
}

export default async function LedgerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; period?: string }>;
}) {
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "viewer",
  );
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="Dashboard" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const period =
    sp.period && /^\d{4}-\d{2}$/.test(sp.period)
      ? sp.period
      : currentPeriodBangkok();
  const filter = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    branchId: scope.branchId,
    period,
  };

  const [summary, byCat, byBranch, byMonth, budgets] = await Promise.all([
    expenseSummary(filter),
    spendByCategory(filter),
    expenseByBranch({ orgId: scope.orgId, companyId: scope.companyId, period }),
    expenseByMonth(scope.orgId, scope.companyId, 6),
    listBudgets(scope.orgId, scope.companyId, period),
  ]);

  const maxCat = Math.max(1, ...byCat.map((c) => c.total));
  const maxBranch = Math.max(1, ...byBranch.map((b) => b.total));
  const maxMonth = Math.max(1, ...byMonth.map((m) => m.total));

  // Querystring to preserve company/branch scope on links from this page.
  const scopeParams = new URLSearchParams();
  if (sp.company) scopeParams.set("company", sp.company);
  if (sp.branch) scopeParams.set("branch", sp.branch);

  // Month stepper (②#6 — the dashboard was period-scoped via URL only, with no UI
  // to change month). Next is capped at the current month (future = empty).
  const periodHref = (p: string) => {
    const u = new URLSearchParams(scopeParams);
    u.set("period", p);
    return `?${u.toString()}`;
  };
  const canNext = period < currentPeriodBangkok();

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="Dashboard"
        subtitle="สรุปค่าใช้จ่ายรายเดือน"
        scope={scope}
      />

      {/* Month stepper — change the dashboard's time window without editing the URL */}
      <div className="mb-4 flex items-center gap-1">
        <Link
          href={periodHref(shiftPeriod(period, -1))}
          aria-label="เดือนก่อนหน้า"
          className="grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <span className="min-w-[5.5rem] text-center text-sm font-semibold text-zinc-800">
          {thMonthLabel(period)}
        </span>
        {canNext ? (
          <Link
            href={periodHref(shiftPeriod(period, 1))}
            aria-label="เดือนถัดไป"
            className="grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50"
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-lg border border-zinc-100 bg-zinc-50 text-zinc-300"
          >
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>

      {/* KPI groups — แยกเป็น 2 กลุ่มให้สายตาอ่านง่าย: เงิน vs สถานะเอกสาร */}
      <div className="space-y-5">
        {/* กลุ่ม "เงิน" — ยอดเงินรายเดือน */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-600">เงิน</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
              <div className="text-xs font-semibold text-zinc-500">
                ค่าใช้จ่ายเดือนนี้
              </div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-zinc-900">
                {baht(summary.postedTotal)}
              </div>
            </div>
            {/* งานภาษีรายเดือน — ภาษีซื้อขอคืนได้ + หัก ณ ที่จ่าย */}
            <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
              <div className="text-xs font-semibold text-zinc-500">VAT ขอคืนได้</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-700">
                {baht(summary.vatClaimable)}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                เฉพาะบิลที่ติ๊ก &ldquo;ขอคืนได้&rdquo; แล้ว
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
              <div className="text-xs font-semibold text-zinc-500">หัก ณ ที่จ่าย (WHT)</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-sky-700">
                {baht(summary.whtTotal)}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">ต้องนำส่งสรรพากร</div>
            </div>
          </div>
        </section>

        {/* กลุ่ม "สถานะเอกสาร" — จำนวนใบ + หมวด */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-600">สถานะเอกสาร</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
              <div className="text-xs font-semibold text-zinc-500">ยืนยันแล้ว</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-700">
                {summary.confirmedCount.toLocaleString("en-US")}
                <span className="ml-1 text-sm font-medium text-zinc-400">ใบ</span>
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-amber-300">
              <div className="text-xs font-semibold text-zinc-500">รอยืนยัน</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-amber-700">
                {summary.draftCount.toLocaleString("en-US")}
                <span className="ml-1 text-sm font-medium text-zinc-400">ใบ</span>
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
              <div className="text-xs font-semibold text-zinc-500">จำนวนหมวด</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-zinc-900">
                {byCat.length.toLocaleString("en-US")}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* AI วิเคราะห์ธุรกิจ */}
      <div className="mt-6">
        <InsightsPanel
          companyId={scope.companyId}
          branchId={scope.branchId}
          period={period}
        />
      </div>

      {/* Budget vs actual */}
      <div className="mt-4">
        <BudgetVsActual
          budgets={budgets}
          period={period}
          scopeParams={scopeParams.toString()}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* By category */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-zinc-800">
            ตามหมวด (เดือนนี้)
          </h2>
          {byCat.length === 0 ? (
            <LedgerEmptyState
              mascotSize={56}
              className="py-6"
              title="ยังไม่มีข้อมูลหมวดนี้"
              hint="พอมีใบเสร็จที่ยืนยันแล้ว กราฟจะขึ้นที่นี่"
            />
          ) : (
            <ul className="space-y-2.5">
              {byCat.map((c) => (
                <BarRow
                  key={c.categoryId ?? "none"}
                  label={c.categoryName ?? "ไม่ระบุหมวด"}
                  value={c.total}
                  max={maxCat}
                />
              ))}
            </ul>
          )}
        </div>

        {/* By branch */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-zinc-800">
            ตามสาขา (เดือนนี้)
          </h2>
          {byBranch.length === 0 ? (
            <LedgerEmptyState
              mascotSize={56}
              className="py-6"
              title="ยังไม่มีข้อมูลสาขา"
              hint="พอมีใบเสร็จที่ยืนยันแล้ว ยอดแต่ละสาขาจะขึ้นที่นี่"
            />
          ) : (
            <ul className="space-y-2.5">
              {byBranch.map((b) => (
                <BarRow
                  key={b.branchId ?? "central"}
                  label={b.name}
                  value={b.total}
                  max={maxBranch}
                  color="oklch(0.62 0.17 162)"
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* By month */}
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-4 text-sm font-bold text-zinc-800">
          แนวโน้มรายเดือน (6 เดือน)
        </h2>
        <div className="flex items-end justify-between gap-2" style={{ height: 160 }}>
          {byMonth.map((m) => {
            const h = Math.max(4, (m.total / maxMonth) * 130);
            const isCurrent = m.period === period;
            return (
              <div key={m.period} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-[10px] font-medium tabular-nums text-zinc-500">
                  {m.total > 0 ? Math.round(m.total / 1000) + "k" : "—"}
                </span>
                <div
                  className={
                    "w-full max-w-[40px] rounded-t-md " +
                    (isCurrent ? "bg-[var(--color-brand-600)]" : "bg-[var(--color-brand-200)]")
                  }
                  style={{ height: h }}
                  title={baht(m.total)}
                />
                <span className="text-[10px] text-zinc-400">
                  {m.period.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ถาม AI (web) */}
      <div className="mt-4">
        <QaBox
          companyId={scope.companyId}
          branchId={scope.branchId}
          period={period}
        />
      </div>
    </div>
  );
}
