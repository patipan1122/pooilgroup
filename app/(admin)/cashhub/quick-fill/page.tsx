// /cashhub/quick-fill — เลือกสาขาใดก็ได้ในการกรอกรายงาน
// สำหรับ Area Manager / Admin / Super Admin (cross-branch access)
// หากเป็น staff/branch_manager → จะเห็นเฉพาะสาขาที่ assign

import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, ClipboardCheck, Search, Building2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import {
  loadManageableBranches,
  hasCrossBranchAccess,
  canFillReports,
} from "@/lib/auth/branch-access";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { thaiDateLong, bkkToday } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function QuickFillPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; type?: string; q?: string }>;
}) {
  const session = await requireSession();
  if (!canFillReports(session.user.role)) redirect("/home");

  const sp = await searchParams;
  const filterCompany = sp.company || "";
  const filterType = sp.type || "";
  const searchQ = (sp.q || "").trim().toLowerCase();

  const admin = adminClient();
  const today = bkkToday();
  const isCross = hasCrossBranchAccess(session.user.role);

  const allBranches = await loadManageableBranches(session.user);

  // Today's reports for these branches
  const branchIds = allBranches.map((b) => b.id);
  let todayByBranch: Record<string, string> = {};
  if (branchIds.length > 0) {
    const { data: r } = await admin
      .from("daily_reports")
      .select("branch_id, status")
      .eq("org_id", session.user.org_id)
      .eq("report_date", today)
      .in("branch_id", branchIds);
    todayByBranch = Object.fromEntries(
      (r ?? []).map((row) => [
        (row as { branch_id: string }).branch_id,
        (row as { status: string }).status,
      ]),
    );
  }

  // Companies + filter UI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: companiesData } = await (admin.from as any)("companies")
    .select("id, code, name")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .order("code");
  const companies = (companiesData ?? []) as Array<{
    id: string;
    code: string;
    name: string;
  }>;
  const companyById = Object.fromEntries(companies.map((c) => [c.id, c]));

  // Apply filters
  let filtered = allBranches;
  if (filterCompany) filtered = filtered.filter((b) => b.company_id === filterCompany);
  if (filterType) filtered = filtered.filter((b) => b.business_type === filterType);
  if (searchQ) {
    filtered = filtered.filter(
      (b) =>
        b.code.toLowerCase().includes(searchQ) ||
        b.name.toLowerCase().includes(searchQ) ||
        (b.province?.toLowerCase().includes(searchQ) ?? false),
    );
  }

  // Group by business type
  const grouped = new Map<string, typeof filtered>();
  for (const b of filtered) {
    const arr = grouped.get(b.business_type) ?? [];
    arr.push(b);
    grouped.set(b.business_type, arr);
  }
  const groupedSorted = Array.from(grouped.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  const totalDone = filtered.filter(
    (b) => todayByBranch[b.id] && todayByBranch[b.id] !== "draft",
  ).length;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-5xl mx-auto pb-24">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[var(--color-brand-700)]"
        >
          <ChevronLeft className="size-4" />
          กลับไปหน้าหลัก
        </Link>

        <header className="mt-4 mb-12 animate-slide-up-soft">
          <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[var(--color-brand-700)] font-bold">
            CASHHUB · QUICK FILL
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
          </p>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
            กรอก <span className="text-gradient-blue">ทุกสาขา</span>
          </h1>
          <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-2xl leading-relaxed">
            {isCross ? (
              <>
                คุณมีสิทธิ์กรอกได้ทุกสาขาใน Pooilgroup ·{" "}
                <strong className="text-zinc-900 tabular-num">
                  {allBranches.length}
                </strong>{" "}
                สาขา · กรอกแล้ว{" "}
                <strong className="text-[var(--color-leaf-700)] tabular-num">
                  {totalDone}
                </strong>
              </>
            ) : (
              <>
                สาขาที่คุณดูแล{" "}
                <strong className="text-zinc-900 tabular-num">
                  {allBranches.length}
                </strong>{" "}
                สาขา · กรอกแล้ว{" "}
                <strong className="text-[var(--color-leaf-700)] tabular-num">
                  {totalDone}
                </strong>
              </>
            )}
          </p>
        </header>

        {allBranches.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="ยังไม่มีสาขาให้กรอก"
            description="กรุณาติดต่อ Admin"
          />
        ) : (
          <>
            {/* Filter bar */}
            <Section
              number="01"
              label="FILTER"
              title="เลือกขอบเขต"
              description="กรองเลือกบริษัท/ประเภทธุรกิจ · ค้นหาด้วยรหัส/ชื่อ/จังหวัด"
              className="mb-8 animate-fade-up delay-100"
            >
              <form
                method="GET"
                className="rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Search className="size-4 text-zinc-400 shrink-0" />
                  <input
                    type="text"
                    name="q"
                    defaultValue={searchQ}
                    placeholder="ค้นหา รหัส / ชื่อ / จังหวัด..."
                    className="flex-1 rounded-lg border border-zinc-200 px-3 h-10 text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap gap-3 items-end">
                  {isCross && companies.length > 0 && (
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                        บริษัท
                      </label>
                      <select
                        name="company"
                        defaultValue={filterCompany}
                        className="h-10 px-3 rounded-lg border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
                      >
                        <option value="">ทุกบริษัท</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                      ประเภทธุรกิจ
                    </label>
                    <select
                      name="type"
                      defaultValue={filterType}
                      className="h-10 px-3 rounded-lg border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
                    >
                      <option value="">ทุกประเภท</option>
                      {Object.entries(BUSINESS_TYPES).map(([k, c]) => (
                        <option key={k} value={k}>
                          {c.emoji} {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="h-10 px-5 rounded-lg bg-[var(--color-brand-600)] text-white font-bold text-sm hover:bg-[var(--color-brand-700)]"
                  >
                    กรอง
                  </button>
                  {(filterCompany || filterType || searchQ) && (
                    <Link
                      href="/cashhub/quick-fill"
                      className="h-10 px-3 inline-flex items-center rounded-lg text-zinc-600 text-sm hover:bg-zinc-100"
                    >
                      ล้าง
                    </Link>
                  )}
                </div>
              </form>
            </Section>

            {/* Branches grouped */}
            <Section
              number="02"
              label="BRANCHES"
              title={`${filtered.length} สาขา · เรียงตามประเภท`}
              description="กดสาขาเพื่อกรอกรายงานวันนี้"
              className="animate-fade-up delay-200"
            >
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<Search className="size-6" />}
                  title="ไม่พบสาขาตามที่ค้นหา"
                  description="ลองเปลี่ยน filter หรือค้นหาคำอื่น"
                />
              ) : (
                <div className="space-y-6">
                  {groupedSorted.map(([type, list]) => {
                    const cfg = BUSINESS_TYPES[type];
                    return (
                      <div key={type}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xl">{cfg?.emoji ?? "📋"}</span>
                          <h3 className="text-base font-bold font-display text-zinc-900">
                            {cfg?.label ?? type}
                          </h3>
                          <span className="text-xs text-zinc-500 tabular-num">
                            {list.length} สาขา
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {list.map((b) => {
                            const status = todayByBranch[b.id];
                            const isDone = status && status !== "draft";
                            const company = b.company_id
                              ? companyById[b.company_id]
                              : null;
                            return (
                              <Link
                                key={b.id}
                                href={`/liff/report/${b.id}`}
                                className={
                                  isDone
                                    ? "group flex items-center justify-between gap-3 rounded-2xl border-2 border-[var(--color-leaf-200)] bg-[var(--color-leaf-50)]/40 px-4 py-3 hover:bg-[var(--color-leaf-50)] transition-all"
                                    : "group flex items-center justify-between gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-4 py-3 hover:border-[var(--color-brand-400)] hover-lift transition-all"
                                }
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold tabular-num text-sm">
                                      {b.code}
                                    </span>
                                    {isDone && (
                                      <Badge tone="success">
                                        {status === "approved" ? "✓ อนุมัติ" : "✓ ส่งแล้ว"}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-zinc-600 truncate mt-0.5">
                                    {b.name}
                                  </div>
                                  {(b.province || company) && (
                                    <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                                      {[company?.name, b.province]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </div>
                                  )}
                                </div>
                                {isDone ? (
                                  <ChevronRight className="size-4 text-[var(--color-leaf-700)] shrink-0" />
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-[var(--color-brand-600)] text-white text-xs font-bold shadow-blue group-hover:bg-[var(--color-brand-700)] shrink-0">
                                    <ClipboardCheck className="size-3.5" />
                                    กรอก
                                  </span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
