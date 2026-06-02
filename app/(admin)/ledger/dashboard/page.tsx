// Ledger · Dashboard — ค่าใช้จ่ายตามหมวด / สาขา / เดือน (confirmed+locked only).
// Real data, org+company(+branch) scoped. Basic bar visuals (no chart lib needed).
// Role gate matches the nav policy in lib/modules.ts (staff/driver excluded —
// the dashboard shows org-wide P&L which front-line roles must not see).
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import {
  expenseSummary,
  spendByCategory,
  expenseByBranch,
  expenseByMonth,
} from "../_data";

export const dynamic = "force-dynamic";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}
function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
    sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : currentPeriod();
  const filter = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    branchId: scope.branchId,
    period,
  };

  const [summary, byCat, byBranch, byMonth] = await Promise.all([
    expenseSummary(filter),
    spendByCategory(filter),
    expenseByBranch({ orgId: scope.orgId, companyId: scope.companyId, period }),
    expenseByMonth(scope.orgId, scope.companyId, 6),
  ]);

  const maxCat = Math.max(1, ...byCat.map((c) => c.total));
  const maxBranch = Math.max(1, ...byBranch.map((b) => b.total));
  const maxMonth = Math.max(1, ...byMonth.map((m) => m.total));

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="Dashboard"
        subtitle={`สรุปค่าใช้จ่ายเดือน ${period}`}
        scope={scope}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="text-xs font-semibold text-zinc-500">
            ค่าใช้จ่ายเดือนนี้
          </div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-zinc-900">
            {baht(summary.postedTotal)}
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="text-xs font-semibold text-zinc-500">ยืนยันแล้ว</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-700">
            {summary.confirmedCount.toLocaleString("en-US")}
            <span className="ml-1 text-sm font-medium text-zinc-400">ใบ</span>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-amber-200">
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

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* By category */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-zinc-800">
            ตามหมวด (เดือนนี้)
          </h2>
          {byCat.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              ยังไม่มีข้อมูล
            </p>
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
            <p className="py-8 text-center text-sm text-zinc-400">
              ยังไม่มีข้อมูล
            </p>
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
    </div>
  );
}
