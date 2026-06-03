// Budget-vs-actual summary for the dashboard — reuses _data.listBudgets() rows.
// Pure presentational (Server Component safe). Bar color matches the budgets
// page (emerald ok / amber near / rose over) so the two surfaces stay coherent.
import Link from "next/link";
import type { BudgetRow } from "@/components/ledger/_kit/types";
import { LedgerEmptyState } from "@/components/ledger/Brand";

function baht(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export function BudgetVsActual({
  budgets,
  period,
  scopeParams,
}: {
  budgets: BudgetRow[];
  period: string;
  /** querystring (company/branch) to preserve scope on the "ตั้งงบ" link. */
  scopeParams: string;
}) {
  const sorted = budgets
    .slice()
    .sort((a, b) => {
      const pa = a.amount > 0 ? a.used / a.amount : 0;
      const pb = b.amount > 0 ? b.used / b.amount : 0;
      return pb - pa;
    })
    .slice(0, 8);

  const overCount = budgets.filter((b) => b.used > b.amount).length;
  const href = `/ledger/budgets?${scopeParams}${scopeParams ? "&" : ""}period=${period}`;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-zinc-800">
          งบประมาณ vs ใช้จริง
          {overCount > 0 && (
            <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
              เกินงบ {overCount} หมวด
            </span>
          )}
        </h2>
        <Link
          href={href}
          className="shrink-0 text-xs font-medium text-[var(--color-brand-600)] hover:underline"
        >
          ตั้งงบ →
        </Link>
      </div>

      {budgets.length === 0 ? (
        <LedgerEmptyState
          mascotSize={56}
          className="py-6"
          title="ยังไม่ได้ตั้งงบสำหรับงวดนี้"
          hint="ตั้งงบรายหมวด แล้วน้องใบเสร็จจะเตือนเมื่อใกล้เพดาน"
          action={
            <Link
              href={href}
              className="text-sm font-medium text-[var(--color-brand-600)] hover:underline"
            >
              ตั้งงบรายหมวด →
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {sorted.map((b) => {
            const pct = b.amount > 0 ? (b.used / b.amount) * 100 : 0;
            const over = b.used > b.amount;
            const near = !over && pct >= b.alertPct;
            const barColor = over
              ? "bg-rose-500"
              : near
                ? "bg-amber-500"
                : "bg-emerald-500";
            return (
              <li key={b.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-zinc-700">
                    {b.categoryName ?? "ไม่ระบุหมวด"}
                    {b.branchName && (
                      <span className="ml-1.5 text-xs text-zinc-400">
                        · {b.branchName}
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      "shrink-0 tabular-nums " +
                      (over
                        ? "font-semibold text-rose-700"
                        : near
                          ? "font-semibold text-amber-700"
                          : "text-zinc-500")
                    }
                  >
                    {baht(b.used)} / {baht(b.amount)}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`h-full rounded-full ${barColor}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
