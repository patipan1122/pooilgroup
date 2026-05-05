// /admin/branches — One-page branch management
// Pattern: fetch raw data with simple queries, merge in JS (avoids Supabase embed issues)
// Mirrors /companies which is the proven working pattern.

import Link from "next/link";
import { Plus, Inbox } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { thaiDateLong } from "@/lib/utils/format";
import { BranchFilterAndList, type BranchRow, type CompanyOption } from "./branch-filter";

export const dynamic = "force-dynamic";

interface RawBranch {
  id: string;
  code: string;
  name: string;
  business_type: string;
  province: string | null;
  region: string | null;
  is_active: boolean;
  manager_id: string | null;
  phone: string | null;
  line_group_id: string | null;
  telegram_chat_id: string | null;
  company_id: string | null;
  parent_branch_id: string | null;
}

interface ManagerLite {
  id: string;
  name: string;
  phone: string | null;
}

interface CompanyLite {
  id: string;
  code: string;
  name: string;
}

export default async function BranchesPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();
  const orgId = session.user.org_id;

  // Step 1: fetch raw branches (no joins — proven to work)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBranchesData } = await (admin.from as any)("branches")
    .select(
      "id, code, name, business_type, province, region, is_active, manager_id, phone, line_group_id, telegram_chat_id, company_id, parent_branch_id",
    )
    .eq("org_id", orgId)
    .order("code");
  const rawBranches = (rawBranchesData ?? []) as RawBranch[];

  // Step 2: fetch companies separately
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: companiesData } = await (admin.from as any)("companies")
    .select("id, code, name")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("code");
  const companies: CompanyOption[] = (companiesData ?? []) as CompanyOption[];
  const companyById = new Map<string, CompanyLite>();
  for (const c of companies) companyById.set(c.id, c);

  // Step 3: fetch managers (only the ones referenced)
  const managerIds = Array.from(
    new Set(rawBranches.map((b) => b.manager_id).filter(Boolean) as string[]),
  );
  let managers: ManagerLite[] = [];
  if (managerIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: m } = await (admin.from as any)("users")
      .select("id, name, phone")
      .in("id", managerIds);
    managers = (m ?? []) as ManagerLite[];
  }
  const managerById = new Map<string, ManagerLite>();
  for (const m of managers) managerById.set(m.id, m);

  // Step 4: count active managers per branch from user_branches
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userBranchesData } = await (admin.from as any)("user_branches")
    .select("branch_id, user_id")
    .eq("org_id", orgId)
    .eq("is_active", true);
  const ubRows = (userBranchesData ?? []) as Array<{ branch_id: string; user_id: string }>;

  // Get user roles for those user_ids (only if any)
  const ubUserIds = Array.from(new Set(ubRows.map((u) => u.user_id)));
  const userRoleById = new Map<string, string>();
  const userActiveById = new Map<string, boolean>();
  if (ubUserIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: u } = await (admin.from as any)("users")
      .select("id, role, is_active")
      .in("id", ubUserIds);
    for (const row of (u ?? []) as Array<{ id: string; role: string; is_active: boolean }>) {
      userRoleById.set(row.id, row.role);
      userActiveById.set(row.id, row.is_active);
    }
  }

  const managerCountByBranch: Record<string, number> = {};
  for (const ub of ubRows) {
    if (!userActiveById.get(ub.user_id)) continue;
    const role = userRoleById.get(ub.user_id);
    if (role !== "branch_manager" && role !== "area_manager") continue;
    managerCountByBranch[ub.branch_id] = (managerCountByBranch[ub.branch_id] ?? 0) + 1;
  }

  // Step 5: pending register requests count
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingCountRaw } = await (admin.from as any)("register_requests")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "pending");
  const pendingCount = pendingCountRaw ?? 0;

  // Step 6: merge into BranchRow shape for the client component
  const branches: BranchRow[] = rawBranches.map((b) => {
    const manager = b.manager_id ? managerById.get(b.manager_id) ?? null : null;
    const company = b.company_id ? companyById.get(b.company_id) ?? null : null;
    const directCount = manager ? 1 : 0;
    const userBranchCount = managerCountByBranch[b.id] ?? 0;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      business_type: b.business_type,
      province: b.province,
      region: b.region,
      is_active: b.is_active,
      manager_id: b.manager_id,
      manager,
      phone: b.phone,
      line_group_id: b.line_group_id,
      telegram_chat_id: b.telegram_chat_id,
      company_id: b.company_id,
      company,
      parent_branch_id: b.parent_branch_id,
      manager_count: Math.max(directCount, userBranchCount),
      manager_max: 2,
    };
  });

  const active = branches.filter((b) => b.is_active);
  const inactive = branches.filter((b) => !b.is_active);
  const missingManagerCount = active.filter(
    (b) => b.manager_count < b.manager_max,
  ).length;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-7xl mx-auto pb-24">
        <header className="mb-12 flex items-end justify-between flex-wrap gap-4 animate-fade-up">
          <div>
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[--color-brand-700] font-bold">
              จัดการระบบ
              <span className="text-zinc-400 mx-2">·</span>
              <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
            </p>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
              สาขา <span className="brand-gradient-text">ทั้งหมด</span>
            </h1>
            <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-2xl leading-relaxed">
              <span className="font-bold text-zinc-900 tabular-num">{active.length}</span> สาขาใช้งาน
              {inactive.length > 0 && (
                <>
                  {" · "}
                  <span className="text-zinc-500 tabular-num">{inactive.length} ปิด</span>
                </>
              )}
              {" · "}
              <span className="text-zinc-500 tabular-num">{branches.length} ทั้งหมด</span>
              {" · "}
              <span className="text-zinc-500 tabular-num">{companies.length} บริษัท</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <Link
                href="/users/requests"
                className="inline-flex items-center gap-2 px-4 h-12 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-900 font-bold hover:bg-amber-100 transition-colors"
              >
                <Inbox className="size-4" />
                รออนุมัติ <span className="tabular-num">{pendingCount}</span>
              </Link>
            )}
            <Link
              href="/branches/new"
              className="inline-flex items-center gap-2 px-5 h-12 rounded-xl bg-[--color-brand-600] text-white font-bold hover:bg-[--color-brand-700] shadow-blue transition-colors"
            >
              <Plus className="size-5" />
              เพิ่มสาขา
            </Link>
          </div>
        </header>

        {/* Quick stats */}
        <Section
          number="01"
          label="OVERVIEW"
          title="สรุปภาพรวม"
          className="mb-8 animate-fade-up delay-100"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBlock
              label="ใช้งาน"
              value={active.length}
              tone="leaf"
            />
            <StatBlock
              label="บริษัท"
              value={companies.length}
              tone="brand"
            />
            <StatBlock
              label="ตำแหน่งว่าง"
              value={missingManagerCount}
              tone={missingManagerCount > 0 ? "warning" : "neutral"}
            />
            <StatBlock
              label="รออนุมัติ"
              value={pendingCount}
              tone={pendingCount > 0 ? "warning" : "neutral"}
            />
          </div>
        </Section>

        {/* Filter + grouped list */}
        <Section
          number="02"
          label="BRANCHES & TEAM"
          title="ทุกสาขา · ทุกบริษัท"
          description="กรองเลือกบริษัท/ประเภทธุรกิจที่ต้องการ · คลิกการ์ดเพื่อแก้ไข"
          className="animate-fade-up delay-200"
        >
          <BranchFilterAndList companies={companies} branches={branches} />
        </Section>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "brand" | "leaf" | "warning" | "neutral";
}) {
  const toneClass = {
    brand: "border-[--color-brand-200] bg-[--color-brand-50]",
    leaf: "border-[--color-leaf-200] bg-[--color-leaf-50]",
    warning: "border-amber-300 bg-amber-50",
    neutral: "border-zinc-200 bg-white",
  }[tone];

  const numberToneClass = {
    brand: "text-[--color-brand-700]",
    leaf: "text-[--color-leaf-700]",
    warning: "text-amber-900",
    neutral: "text-zinc-700",
  }[tone];

  return (
    <div className={`rounded-2xl border-2 ${toneClass} p-4`}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-600 font-bold">
        {label}
      </p>
      <p className={`text-4xl sm:text-5xl font-extrabold tabular-num font-display tracking-tight mt-1 ${numberToneClass}`}>
        {value}
      </p>
    </div>
  );
}
