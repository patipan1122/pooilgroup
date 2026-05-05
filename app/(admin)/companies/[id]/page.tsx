// /admin/companies/[id] — company detail
// Shows: contact info, branches grouped by business type, key metrics

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Edit3,
  Phone,
  MapPin,
  IdCard,
  Building2,
  ChevronRight,
} from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BUSINESS_TYPES } from "@/constants/business-types";

export const dynamic = "force-dynamic";

interface Company {
  id: string;
  code: string;
  name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  brand_color: string | null;
  is_active: boolean;
  created_at: string;
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CompanyDetailPage({ params }: Props) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await params;
  const admin = adminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: company } = await (admin.from as any)("companies")
    .select(
      "id, code, name, tax_id, address, phone, logo_url, brand_color, is_active, created_at",
    )
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!company) notFound();
  const c = company as Company;

  const { data: branchesData } = await admin
    .from("branches")
    .select(
      "id, code, name, business_type, province, is_active, manager:manager_id(name)",
    )
    .eq("org_id", session.user.org_id)
    .eq("company_id", c.id)
    .order("code");

  type BranchEntry = {
    id: string;
    code: string;
    name: string;
    business_type: string;
    province: string | null;
    is_active: boolean;
    manager:
      | { name: string }
      | { name: string }[]
      | null;
  };
  const branches = (branchesData ?? []) as BranchEntry[];
  const active = branches.filter((b) => b.is_active);

  // Group by business type
  const grouped = new Map<string, BranchEntry[]>();
  for (const b of active) {
    const arr = grouped.get(b.business_type) ?? [];
    arr.push(b);
    grouped.set(b.business_type, arr);
  }

  const groupedSorted = Array.from(grouped.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

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
          href="/companies"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[--color-brand-700]"
        >
          <ChevronLeft className="size-4" />
          กลับไปรายชื่อบริษัท
        </Link>

        {/* Hero */}
        <header className="mt-4 mb-12 sm:mb-14 animate-slide-up-soft flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-5 min-w-0">
            <div className="size-20 sm:size-24 rounded-3xl border-2 bg-[--color-brand-50] border-[--color-brand-200] text-[--color-brand-700] flex items-center justify-center text-3xl sm:text-4xl font-extrabold font-display shrink-0">
              {c.code.slice(0, 2)}
            </div>
            <div>
              <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] font-bold text-[--color-brand-700]">
                COMPANY · {c.code}
              </p>
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-[-0.04em] font-display mt-3 text-zinc-900 leading-[0.95]">
                <span className="text-gradient-blue">{c.name}</span>
              </h1>
              <div className="flex items-center gap-2 mt-3">
                {c.is_active ? (
                  <Badge tone="success">
                    <span className="size-1.5 rounded-full bg-[--color-leaf-600] animate-pulse-soft inline-block" />
                    ใช้งาน
                  </Badge>
                ) : (
                  <Badge tone="neutral">ปิดใช้งาน</Badge>
                )}
                <span className="text-xs text-zinc-500 tabular-num">
                  {active.length} สาขาใช้งาน
                </span>
              </div>
            </div>
          </div>
          <Link
            href={`/companies/${c.id}/edit`}
            className="inline-flex items-center gap-2 px-5 h-12 rounded-xl bg-[--color-brand-600] text-white font-bold hover:bg-[--color-brand-700] hover-lift-premium shadow-blue transition-colors"
          >
            <Edit3 className="size-4" />
            แก้ไขข้อมูล
          </Link>
        </header>

        {/* Contact info */}
        <Section
          number="01"
          label="CONTACT"
          title="ข้อมูลติดต่อ"
          className="mb-12 animate-fade-up delay-100"
        >
          <div className="rounded-2xl border-2 border-zinc-200 bg-white p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-5">
            <InfoRow
              icon={<IdCard className="size-4" />}
              label="เลขผู้เสียภาษี"
              value={c.tax_id ?? "—"}
            />
            <InfoRow
              icon={<Phone className="size-4" />}
              label="โทรศัพท์"
              value={c.phone ?? "—"}
            />
            <InfoRow
              icon={<MapPin className="size-4" />}
              label="ที่อยู่"
              value={c.address ?? "—"}
              fullSpan
            />
          </div>
        </Section>

        {/* Branches grouped */}
        <Section
          number="02"
          label="BRANCHES"
          title={`${active.length} สาขาใต้ ${c.name}`}
          description="แยกตามประเภทธุรกิจ — คลิกการ์ดเพื่อดูรายละเอียด"
          className="animate-fade-up delay-200"
        >
          {active.length === 0 ? (
            <EmptyState
              icon={<Building2 className="size-6" />}
              title="ยังไม่มีสาขาใต้บริษัทนี้"
              description="ไปที่หน้าสาขาเพื่อเพิ่มและกำหนดสังกัดบริษัท"
              action={
                <Link
                  href="/branches/new"
                  className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[--color-brand-600] text-white font-bold hover:bg-[--color-brand-700]"
                >
                  เพิ่มสาขา
                </Link>
              }
            />
          ) : (
            <div className="space-y-6">
              {groupedSorted.map(([type, list], idx) => {
                const cfg = BUSINESS_TYPES[type];
                return (
                  <div
                    key={type}
                    className="animate-fade-up"
                    style={{ animationDelay: `${(idx + 1) * 50}ms` }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xl">{cfg?.emoji ?? "📋"}</span>
                      <h3 className="text-base font-bold font-display text-zinc-900">
                        {cfg?.label ?? type}
                      </h3>
                      <span className="text-xs text-zinc-500 tabular-num">
                        {list.length} สาขา
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {list.map((b) => {
                        const m = Array.isArray(b.manager) ? b.manager[0] : b.manager;
                        return (
                          <Link
                            key={b.id}
                            href={`/branches/${b.id}`}
                            className="group flex items-center justify-between gap-3 rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 hover:border-[--color-brand-400] hover:bg-[--color-brand-50]/40 transition-all"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-bold tabular-num">
                                {b.code}
                              </div>
                              <div className="text-xs text-zinc-500 truncate">
                                {b.name}
                              </div>
                              {(b.province || m?.name) && (
                                <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                                  {[b.province, m?.name].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </div>
                            <ChevronRight className="size-4 text-zinc-400 group-hover:text-[--color-brand-600] group-hover:translate-x-0.5 transition-all shrink-0" />
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
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  fullSpan,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  fullSpan?: boolean;
}) {
  return (
    <div className={fullSpan ? "sm:col-span-3" : ""}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 font-bold flex items-center gap-1.5 mb-1">
        <span className="text-zinc-400">{icon}</span>
        {label}
      </p>
      <p className="text-sm font-medium text-zinc-900">{value}</p>
    </div>
  );
}
