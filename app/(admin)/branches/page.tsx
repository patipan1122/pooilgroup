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
  manager: { id: string; name: string; phone: string | null } | { id: string; name: string; phone: string | null }[] | null;
  company: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null;
}

export default async function BranchesPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  // Fetch companies + branches in parallel
  const [companiesRes, branchesRes, requestsRes] = await Promise.all([
    admin
      .from("companies")
      .select("id, code, name")
      .eq("org_id", session.user.org_id)
      .eq("is_active", true)
      .order("code"),
    admin
      .from("branches")
      .select(
        "id, code, name, business_type, province, region, is_active, manager_id, phone, line_group_id, telegram_chat_id, company_id, parent_branch_id, manager:manager_id(id, name, phone), company:company_id(id, code, name)",
      )
      .eq("org_id", session.user.org_id)
      .order("code"),
    admin
      .from("register_requests")
      .select("id", { count: "exact", head: true })
      .eq("org_id", session.user.org_id)
      .eq("status", "pending"),
  ]);

  const companies: CompanyOption[] = (companiesRes.data ?? []) as CompanyOption[];
  const rawBranches = (branchesRes.data ?? []) as RawBranch[];
  const pendingCount = requestsRes.count ?? 0;

  // Count managers per branch (from user_branches)
  const { data: userBranchesData } = await admin
    .from("user_branches")
    .select("branch_id, user:user_id(role, is_active)")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true);

  const managerCountByBranch: Record<string, number> = {};
  for (const ub of (userBranchesData ?? []) as Array<{
    branch_id: string;
    user: { role: string; is_active: boolean } | { role: string; is_active: boolean }[] | null;
  }>) {
    const u = Array.isArray(ub.user) ? ub.user[0] : ub.user;
    if (!u || !u.is_active) continue;
    if (u.role !== "branch_manager" && u.role !== "area_manager") continue;
    managerCountByBranch[ub.branch_id] = (managerCountByBranch[ub.branch_id] ?? 0) + 1;
  }

  const branches: BranchRow[] = rawBranches.map((b) => {
    const manager = Array.isArray(b.manager) ? b.manager[0] ?? null : b.manager;
    const company = Array.isArray(b.company) ? b.company[0] ?? null : b.company;
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
      manager_count: managerCountByBranch[b.id] ?? (manager ? 1 : 0),
      manager_max: 2, // policy: 1-2 managers per branch
    };
  });

  const active = branches.filter((b) => b.is_active);
  const inactive = branches.filter((b) => !b.is_active);
  const missingManagerCount = active.filter(
    (b) => b.manager_count < b.manager_max,
  ).length;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-7xl mx-auto">
      <header className="mb-8 flex items-end justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
            จัดการระบบ · {thaiDateLong(new Date())}
          </p>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-display mt-2">
            สาขา <span className="brand-gradient-text">ทั้งหมด</span>
          </h1>
          <p className="text-zinc-600 mt-2">
            <span className="font-bold text-zinc-900 tabular-num">{active.length}</span> สาขาใช้งาน
            {inactive.length > 0 && (
              <>
                {" · "}
                <span className="text-zinc-500 tabular-num">{inactive.length} ปิด</span>
              </>
            )}
            {" · "}
            <span className="text-zinc-500 tabular-num">{branches.length} ทั้งหมด</span>
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
