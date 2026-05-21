// /admin/companies — list of legal entities (Pooil Oil + JP Sync)
// Design: ฟ้า + ขาว + เทา · บิ๊ก hero gradient · premium card lift

import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { thaiDateLong } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";

export const dynamic = "force-dynamic";

interface CompanyRow {
  id: string;
  code: string;
  name: string;
  tax_id: string | null;
  phone: string | null;
  logo_url: string | null;
  brand_color: string | null;
  is_active: boolean;
}

interface BranchAgg {
  branchCount: number;
  byType: Record<string, number>;
}

export default async function CompaniesPage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: companiesData, error } = await (admin.from as any)("companies")
    .select("id, code, name, tax_id, phone, logo_url, brand_color, is_active")
    .eq("org_id", session.user.org_id)
    .order("code");

  const tableMissing =
    error && (error.code === "42P01" || error.code === "PGRST205");
  const rows = (companiesData ?? []) as CompanyRow[];

  // Aggregate branches per company
  const aggByCompany = new Map<string, BranchAgg>();
  if (rows.length > 0) {
    const { data: branches } = await admin
      .from("branches")
      .select("company_id, business_type, is_active")
      .eq("org_id", session.user.org_id)
      .eq("is_active", true);
    for (const b of branches ?? []) {
      const cid = (b as { company_id: string }).company_id;
      if (!cid) continue;
      const bt = (b as { business_type: string }).business_type;
      const cur = aggByCompany.get(cid) ?? { branchCount: 0, byType: {} };
      cur.branchCount += 1;
      cur.byType[bt] = (cur.byType[bt] ?? 0) + 1;
      aggByCompany.set(cid, cur);
    }
  }

  const totalBranches = Array.from(aggByCompany.values()).reduce(
    (s, a) => s + a.branchCount,
    0,
  );

  return (
    <div className="relative">
      {/* Background drift */}
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-6xl mx-auto pb-24">
        {/* Hero */}
        <header className="mb-12 sm:mb-14 animate-slide-up-soft">
          <p className="text-xs uppercase tracking-[0.18em] font-bold text-[var(--color-brand-700)]">
            จัดการระบบ
            <span className="text-zinc-400 mx-2">·</span>
            <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
          </p>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-5 text-zinc-900 max-w-4xl leading-[0.95]">
            <span className="text-gradient-blue">บริษัท</span> ในเครือ Pooilgroup
          </h1>
          <p className="text-base sm:text-lg text-zinc-600 mt-6 max-w-2xl leading-relaxed">
            <strong className="font-bold text-zinc-900 tabular-num">
              {rows.length}
            </strong>{" "}
            บริษัท
            <span className="text-zinc-400 mx-1.5">·</span>
            <strong className="font-bold text-zinc-900 tabular-num">
              {totalBranches}
            </strong>{" "}
            สาขารวม — Invoice ออกตามชื่อบริษัทแยกกัน
          </p>
        </header>

        {tableMissing && (
          <div className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-4 sm:p-5 animate-fade-up">
            <p className="font-bold text-amber-900 mb-1">
              ⚠️ ตารางบริษัทยังไม่ถูกสร้าง
            </p>
            <p className="text-sm text-amber-800">
              รัน migration{" "}
              <code className="bg-white px-1.5 py-0.5 rounded text-xs border border-amber-200">
                supabase/migrations/20260505000001_companies_and_business_types.sql
              </code>{" "}
              ก่อน
            </p>
          </div>
        )}

        <Section
          number="01"
          label="LIST"
          title="ทุกบริษัท"
          description="คลิกเพื่อดูรายละเอียดและรายการสาขา"
          className="animate-fade-up delay-100"
        >
          {rows.length === 0 && !tableMissing ? (
            <EmptyState
              icon={<Building2 className="size-6" />}
              title="ยังไม่มีบริษัท"
              description="เพิ่มบริษัทเข้าฐานข้อมูลก่อนใช้งาน"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {rows.map((c, idx) => {
                const agg = aggByCompany.get(c.id) ?? { branchCount: 0, byType: {} };
                const topTypes = Object.entries(agg.byType)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 4);
                return (
                  <Link
                    key={c.id}
                    href={`/companies/${c.id}`}
                    className="group relative rounded-3xl border-2 border-zinc-200 bg-white p-6 sm:p-7 hover:border-[var(--color-brand-400)] hover-lift-premium overflow-hidden animate-slide-up-soft shadow-soft"
                    style={{ animationDelay: `${(idx + 1) * 80}ms` }}
                  >
                    {/* Decorative blue blur */}
                    <div
                      aria-hidden
                      className="absolute -top-12 -right-12 size-44 rounded-full blur-3xl opacity-25 pointer-events-none"
                      style={{
                        background:
                          "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
                      }}
                    />

                    <div className="relative">
                      {/* Top: logo placeholder + status */}
                      <div className="flex items-start justify-between mb-5">
                        <div className="size-14 rounded-2xl border-2 bg-[var(--color-brand-50)] border-[var(--color-brand-200)] text-[var(--color-brand-700)] flex items-center justify-center text-xl font-extrabold font-display">
                          {c.code.slice(0, 2)}
                        </div>
                        {c.is_active ? (
                          <Badge tone="success">
                            <span className="size-1.5 rounded-full bg-[var(--color-leaf-600)] animate-pulse-soft inline-block" />
                            ใช้งาน
                          </Badge>
                        ) : (
                          <Badge tone="neutral">ปิด</Badge>
                        )}
                      </div>

                      {/* Name + code */}
                      <h3 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.025em] font-display text-zinc-900">
                        {c.name}
                      </h3>
                      <p className="text-sm font-semibold text-[var(--color-brand-700)] mt-1 tabular-num">
                        {c.code}
                        {c.tax_id && (
                          <span className="text-zinc-400 font-normal">
                            {" · "}เลขผู้เสียภาษี {c.tax_id}
                          </span>
                        )}
                      </p>

                      {/* Branch count BIG */}
                      <div className="mt-6 pb-5 border-b border-zinc-100">
                        <p className="text-xs font-bold text-zinc-500 mb-1">
                          สาขาทั้งหมด
                        </p>
                        <p className="font-num-mega text-5xl sm:text-6xl">
                          <span className="text-gradient-blue-vivid">
                            {agg.branchCount.toLocaleString("th-TH")}
                          </span>
                          <span className="text-base text-zinc-400 font-medium ml-2">
                            สาขา
                          </span>
                        </p>
                      </div>

                      {/* Top business types */}
                      {topTypes.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {topTypes.map(([type, count]) => {
                            const cfg = BUSINESS_TYPES[type];
                            return (
                              <span
                                key={type}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-50 border border-zinc-200 text-xs"
                              >
                                <span>{cfg?.emoji ?? "📋"}</span>
                                <span className="text-zinc-700 font-medium">
                                  {cfg?.label ?? type}
                                </span>
                                <span className="font-bold tabular-num text-zinc-900">
                                  {count}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* CTA */}
                      <div className="mt-6 flex items-center justify-between">
                        <span className="text-sm font-bold text-[var(--color-brand-700)] group-hover:text-[var(--color-brand-800)]">
                          ดูรายละเอียด
                        </span>
                        <ChevronRight className="size-5 text-zinc-400 group-hover:text-[var(--color-brand-600)] group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
