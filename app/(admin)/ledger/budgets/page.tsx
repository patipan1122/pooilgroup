// Ledger · งบประมาณ — ตั้งงบรายหมวด (+สาขา) ต่อเดือน + แสดงใช้ไป vs เพดาน.
// Used vs cap คำนวณจากค่าใช้จ่ายที่ยืนยันแล้วในงวด (ดู _data.listBudgets).
// Role gate matches the nav policy in lib/modules.ts (staff/driver/viewer excluded);
// the budget write actions (_actions.upsertBudget/deleteBudget) carry the same gate.
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import { listBudgets, listCategories } from "../_data";
import { BudgetForm } from "./_components/BudgetForm";
import { BudgetRowActions } from "./_components/BudgetRowActions";

export const dynamic = "force-dynamic";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}
function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
// "2026-06" → "มิ.ย. 69" (Thai short month + 2-digit Buddhist year) — mirrors the
// shared convention in ledger-book/page.tsx (no importable YYYY-MM helper: the
// lib/utils thaiDateLong adds a day, which doesn't fit a month-only period).
const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return `${TH_MONTHS[m - 1] ?? period} ${(y + 543) % 100}`;
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; period?: string }>;
}) {
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
  );
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="งบประมาณ" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const period =
    sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : currentPeriod();

  const [budgets, categories] = await Promise.all([
    listBudgets(scope.orgId, scope.companyId, period),
    listCategories(scope.orgId, scope.companyId),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="งบประมาณ"
        subtitle={`งวด ${monthLabel(period)}`}
        scope={scope}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        {/* Budget list */}
        <div className="animate-fade-up rounded-2xl border border-zinc-200 bg-white">
          <div className="flex items-baseline justify-between gap-2 border-b border-zinc-100 px-4 py-3">
            <h2 className="text-sm font-bold text-zinc-800">งบรายหมวด</h2>
            <span className="text-xs font-medium tabular-nums text-zinc-500">
              {budgets.length} หมวด
            </span>
          </div>
          {budgets.length === 0 ? (
            <LedgerEmptyState
              title="ยังไม่ได้ตั้งงบสำหรับงวดนี้"
              hint="ตั้งงบที่ฟอร์มด้านขวา แล้วน้องใบเสร็จจะเตือนเมื่อใกล้เพดาน"
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {budgets.map((b) => {
                const pct = b.amount > 0 ? (b.used / b.amount) * 100 : 0;
                const over = b.used > b.amount;
                const near = !over && pct >= b.alertPct;
                const barColor = over
                  ? "bg-red-500"
                  : near
                    ? "bg-amber-500"
                    : "bg-emerald-500";
                return (
                  <li key={b.id} className="p-4 transition-colors hover:bg-zinc-50/70">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-zinc-800">
                          {b.categoryName ?? "ไม่ระบุหมวด"}
                        </span>
                        {b.branchName && (
                          <span className="text-xs text-zinc-500">
                            · {b.branchName}
                          </span>
                        )}
                        {b.recurring && (
                          <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                            ทุกเดือน
                          </span>
                        )}
                        {over && (
                          <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            เกินงบ
                          </span>
                        )}
                        {near && (
                          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            ใกล้เต็ม {Math.round(pct)}%
                          </span>
                        )}
                      </div>
                      <BudgetRowActions id={b.id} />
                    </div>
                    <div className="mb-1.5 h-2.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className={`h-full rounded-full ${barColor} transition-[width]`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={
                          over
                            ? "font-semibold tabular-nums text-red-700"
                            : near
                              ? "font-semibold tabular-nums text-amber-700"
                              : "tabular-nums text-zinc-500"
                        }
                      >
                        ใช้ไป {baht(b.used)} / {baht(b.amount)}
                      </span>
                      <span className="shrink-0 tabular-nums text-zinc-500">
                        เตือนที่ {b.alertPct}%
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Set budget */}
        <div className="animate-fade-up delay-100 h-fit rounded-2xl border border-zinc-200 bg-white p-4 lg:sticky lg:top-4">
          <h2 className="text-sm font-bold text-zinc-800">ตั้งงบ / แก้งบ</h2>
          <p className="mb-3 mt-0.5 text-xs text-zinc-500">
            กำหนดเพดานต่อหมวดในงวดนี้ ระบบจะเตือนเมื่อใกล้เต็ม
          </p>
          <BudgetForm
            companyId={scope.companyId}
            period={period}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            branches={scope.branches}
          />
        </div>
      </div>
    </div>
  );
}
