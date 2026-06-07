// Ledger home — KPI summary (ภาพรวมเร็ว) + ทางลัดไปยังรายจ่ายที่รอยืนยัน.
// Real data, org+company(+branch) scoped, current month.
import Link from "next/link";
import { Receipt, FileClock, CheckCircle2, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "./_scope";
import { LedgerHeader, NoCompanyState } from "./_components/LedgerHeader";
import { expenseSummary, listExpensesSummary, spendByCategory } from "./_data";
import { currentPeriodBangkok } from "@/lib/ledger/dashboard";
import { StatusBadge } from "@/components/ledger/_kit/StatusBadge";
import { LedgerEmptyState, LedgerMascot } from "@/components/ledger/Brand";

export const dynamic = "force-dynamic";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export default async function LedgerHomePage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  // Page-level role gate (same financial-view tier as the dashboard nav policy).
  // The home KPI tiles surface company-wide financials (posted total, confirmed
  // count, spend-by-category) → front-line roles (staff/driver/branch_manager/
  // program_admin) must not see them. Layout assertModuleEnabled only checks the
  // module grant, not the role, so we gate here like dashboard/settings/budgets.
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
        <LedgerHeader title="ระบบบัญชี" subtitle="ภาพรวม" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const period = currentPeriodBangkok();
  const filter = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    branchId: scope.branchId,
    period,
  };

  const [summary, drafts, byCategory] = await Promise.all([
    expenseSummary(filter),
    listExpensesSummary({ ...filter, status: "draft", take: 6 }).then((r) => r.expenses),
    spendByCategory(filter),
  ]);

  const tiles = [
    {
      label: "รอยืนยัน (ร่าง)",
      value: summary.draftCount,
      unit: "ใบ",
      icon: FileClock,
      tone: "amber",
      href: "/ledger/expenses?status=draft",
    },
    {
      label: "ยืนยันแล้วเดือนนี้",
      value: summary.confirmedCount,
      unit: "ใบ",
      icon: CheckCircle2,
      tone: "emerald",
      href: "/ledger/expenses?status=confirmed",
    },
    {
      label: "ค่าใช้จ่ายเดือนนี้",
      value: baht(summary.postedTotal),
      unit: "",
      icon: Wallet,
      tone: "blue",
      href: "/ledger/dashboard",
    },
    {
      // Per-company total (scope is one companyId) — NOT org-wide. The module
      // has no cross-company aggregation yet, so label it per-company to avoid
      // a CEO running 2 companies reading this as an org-wide figure.
      label: "ทั้งหมดในบริษัทนี้",
      value: summary.totalCount,
      unit: "ใบ",
      icon: Receipt,
      tone: "zinc",
      href: "/ledger/expenses",
    },
  ] as const;

  const toneRing: Record<string, string> = {
    amber: "ring-amber-200 text-amber-700",
    emerald: "ring-emerald-200 text-emerald-700",
    blue: "ring-blue-200 text-blue-700",
    zinc: "ring-zinc-200 text-zinc-700",
  };

  const topCat = byCategory.slice(0, 5);
  const maxCat = Math.max(1, ...topCat.map((c) => c.total));

  const buildHref = (base: string) => {
    const qs = new URLSearchParams();
    if (sp.company) qs.set("company", sp.company);
    if (sp.branch) qs.set("branch", sp.branch);
    const s = qs.toString();
    return s ? `${base}${base.includes("?") ? "&" : "?"}${s}` : base;
  };

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="ระบบบัญชี"
        subtitle={`ภาพรวมเดือน ${period}`}
        scope={scope}
        right={
          <Link
            href={buildHref("/ledger/expenses")}
            className="inline-flex h-9 items-center rounded-lg bg-[var(--color-brand-600)] px-3 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
          >
            จัดการรายจ่าย
          </Link>
        }
      />

      {/* Welcome banner — น้องใบเสร็จ greets + nudges the draft queue (web + mobile) */}
      <div className="mb-4 flex items-center gap-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-4">
        <LedgerMascot
          pose={summary.draftCount > 0 ? "receipt" : "welcome"}
          size={72}
          priority
          className="shrink-0 drop-shadow-sm"
        />
        <div className="min-w-0">
          <p className="text-base font-bold text-zinc-900">
            {summary.draftCount > 0
              ? `มี ${summary.draftCount} ใบรอตรวจ — ช่วยยืนยันหน่อยนะ`
              : "สวัสดีครับ พร้อมช่วยจดค่าใช้จ่าย"}
          </p>
          <p className="mt-0.5 text-sm text-zinc-500">
            ถ่ายใบเสร็จส่งในกลุ่ม LINE หรือพิมพ์ &ldquo;จด กาแฟ 45&rdquo; — น้องใบเสร็จจัดให้
          </p>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.label}
              href={buildHref(t.href)}
              className={`flex min-h-[110px] flex-col justify-between gap-2 rounded-2xl bg-white p-4 ring-1 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-400)] ${toneRing[t.tone]}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500">
                  {t.label}
                </span>
                <Icon className="size-4" aria-hidden />
              </div>
              <div className="text-2xl font-extrabold tabular-nums text-zinc-900 sm:text-3xl">
                {typeof t.value === "number"
                  ? t.value.toLocaleString("en-US")
                  : t.value}
                {t.unit && (
                  <span className="ml-1 text-sm font-medium text-zinc-400">
                    {t.unit}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* รอยืนยัน */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-800">รอยืนยันล่าสุด</h2>
            <Link
              href={buildHref("/ledger/expenses?status=draft")}
              className="text-xs font-medium text-[var(--color-brand-600)] hover:underline"
            >
              ดูทั้งหมด
            </Link>
          </div>
          {drafts.length === 0 ? (
            <LedgerEmptyState
              mascotSize={48}
              className="py-6"
              title="ไม่มีใบรอยืนยัน"
              hint="ทุกใบเสร็จถูกยืนยันครบแล้ว"
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {drafts.map((d) => (
                <li key={d.id}>
                  <Link
                    href={buildHref(`/ledger/expenses?selected=${d.id}`)}
                    className="flex items-center justify-between gap-2 py-2.5 hover:bg-zinc-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-800">
                        {d.vendor || "ไม่ระบุผู้ขาย"}
                      </div>
                      <div className="truncate font-mono text-xs text-zinc-400">
                        {d.docCode}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        {baht(d.total)}
                      </span>
                      <StatusBadge status={d.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ค่าใช้จ่ายตามหมวด */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-800">
              ค่าใช้จ่ายตามหมวด (เดือนนี้)
            </h2>
            <Link
              href={buildHref("/ledger/dashboard")}
              className="text-xs font-medium text-[var(--color-brand-600)] hover:underline"
            >
              Dashboard
            </Link>
          </div>
          {topCat.length === 0 ? (
            <LedgerEmptyState
              mascotSize={48}
              className="py-6"
              title="ยังไม่มีค่าใช้จ่ายที่ยืนยัน"
              hint="พอยืนยันใบเสร็จแล้ว ยอดตามหมวดจะขึ้นที่นี่"
            />
          ) : (
            <ul className="space-y-2.5">
              {topCat.map((c) => (
                <li key={c.categoryId ?? "none"}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="truncate text-zinc-700">
                      {c.categoryName ?? "ไม่ระบุหมวด"}
                    </span>
                    <span className="font-semibold tabular-nums text-zinc-900">
                      {baht(c.total)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-[var(--color-brand-500)]"
                      style={{ width: `${(c.total / maxCat) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
