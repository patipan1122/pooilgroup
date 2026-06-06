// "สมุดค่าใช้จ่าย" — the standalone book index (C1 · tier 7a).
//
// CEO's "เล่มสมุดค่าใช้จ่าย": one card per active category showing its latest-
// month total + a tiny sparkline of the trailing 6 months, each tapping through
// to /ledger/categories/[id] for the full month-by-month history + trend.
//
// Scope: org+company ALWAYS (companyId mandatory — one org = many legal entities).
// A scoped LINE member only totals their own branches; admin/accountant company-
// wide. Real spend only (confirmed+locked).
import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { resolveLedgerActor } from "@/lib/ledger/liff-auth";
import { categoryBookIndex } from "@/lib/ledger/category-ledger";
import { currentPeriodBangkok } from "@/lib/ledger/dashboard";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { Sparkline } from "../categories/_components/TrendChart";
import { LedgerEmptyState } from "@/components/ledger/Brand";

export const dynamic = "force-dynamic";

function baht(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
function monthLabel(period: string | null): string {
  if (!period) return "—";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return `${TH_MONTHS[m - 1] ?? period} ${(y + 543) % 100}`;
}

export default async function LedgerBookPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
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
        <LedgerHeader title="สมุดค่าใช้จ่าย" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const actor = await resolveLedgerActor();
  const actorScope = {
    allBranches: actor?.allBranches ?? true,
    scopeBranchIds: actor?.scopeBranchIds ?? [],
  };

  const entries = await categoryBookIndex({
    orgId: scope.orgId,
    companyId: scope.companyId,
    actorScope,
    months: 6,
    anchorPeriod: currentPeriodBangkok(),
  });

  // Preserve company/branch on each card's deep-link.
  const linkParams = new URLSearchParams();
  if (sp.company) linkParams.set("company", sp.company);
  if (sp.branch) linkParams.set("branch", sp.branch);
  const linkSuffix = linkParams.toString() ? `?${linkParams.toString()}` : "";

  // Sort by latest-month spend desc so the busiest categories sit on top, then by
  // name for the zero-history tail.
  const sorted = [...entries].sort((a, b) => {
    if (b.latestTotal !== a.latestTotal) return b.latestTotal - a.latestTotal;
    return a.categoryName.localeCompare(b.categoryName, "th");
  });

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="สมุดค่าใช้จ่าย"
        subtitle="ดูค่าใช้จ่ายแต่ละหมวดย้อนหลัง · ความเปลี่ยนแปลงรายเดือน"
        scope={scope}
      />

      {/* intro strip */}
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[var(--color-brand-600)] ring-1 ring-blue-100">
          <BookOpen className="size-5" aria-hidden />
        </div>
        <p className="text-sm text-zinc-600">
          แตะหมวดเพื่อเปิดเล่ม — ดูยอดรายเดือนย้อนหลังและกราฟแนวโน้มของหมวดนั้น
        </p>
      </div>

      {sorted.length === 0 ? (
        <LedgerEmptyState
          className="min-h-[40vh]"
          mascotSize={72}
          title="ยังไม่มีหมวดค่าใช้จ่าย"
          hint="เพิ่มหมวดในหน้าตั้งค่า แล้วยอดแต่ละหมวดจะมาเรียงเป็นเล่มที่นี่"
          action={
            <Link
              href="/ledger/settings"
              className="text-sm font-medium text-[var(--color-brand-600)] hover:underline"
            >
              ไปหน้าตั้งค่า →
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((e) => (
            <li key={e.categoryId}>
              <Link
                href={`/ledger/categories/${e.categoryId}${linkSuffix}`}
                className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition-all hover:border-[var(--color-brand-200)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-400)]"
              >
                {/* color chip */}
                <span
                  className="size-3 shrink-0 rounded-full ring-1 ring-zinc-200"
                  style={{ background: e.color ?? "var(--color-brand-400)" }}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-800">
                      {e.categoryName}
                    </span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-zinc-900">
                      {baht(e.latestTotal)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400">
                      {e.latestPeriod
                        ? `ล่าสุด ${monthLabel(e.latestPeriod)}`
                        : "ยังไม่มีค่าใช้จ่าย"}
                    </span>
                    <Sparkline values={e.spark} className="h-6 w-20" />
                  </div>
                </div>

                <ChevronRight className="size-4 shrink-0 text-zinc-300" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
