// /branches — list of all branches as an Excel-style data grid.
// Inline edit, sort, filter, copy/paste from Excel, bulk actions.

import Link from "next/link";
import { Building2, Download, Plus, Upload } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { thaiDateLong } from "@/lib/utils/format";
import { BranchesTableView, type FlatBranch } from "./branches-table-view";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const admin = adminClient();

  const [branchesQ, companiesQ, usersQ, ubQ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("branches")
      .select(
        "id, code, name, business_type, company_id, province, region, phone, manager_id, is_active, created_at",
      )
      .eq("org_id", orgId)
      .order("code"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("companies")
      .select("id, code, name")
      .eq("org_id", orgId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("users")
      .select("id, name")
      .eq("org_id", orgId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("user_branches")
      .select("user_id, branch_id, is_active")
      .eq("org_id", orgId)
      .eq("is_active", true),
  ]);

  const branches = (branchesQ.data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    business_type: string;
    company_id: string | null;
    province: string | null;
    region: string | null;
    phone: string | null;
    manager_id: string | null;
    is_active: boolean;
    created_at: string;
  }>;
  const companies = (companiesQ.data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
  }>;
  const users = (usersQ.data ?? []) as Array<{ id: string; name: string }>;
  const ubRows = (ubQ.data ?? []) as Array<{
    branch_id: string;
    user_id: string;
  }>;

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const userCountByBranch = new Map<string, number>();
  for (const ub of ubRows) {
    userCountByBranch.set(
      ub.branch_id,
      (userCountByBranch.get(ub.branch_id) ?? 0) + 1,
    );
  }

  const flat: FlatBranch[] = branches.map((b) => {
    const co = b.company_id ? companyById.get(b.company_id) : null;
    const mgr = b.manager_id ? userById.get(b.manager_id) : null;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      business_type: b.business_type,
      company_code: co?.code ?? "",
      company_name: co?.name ?? "",
      province: b.province,
      region: b.region,
      phone: b.phone,
      manager_name: mgr?.name ?? null,
      user_count: userCountByBranch.get(b.id) ?? 0,
      is_active: b.is_active,
      created_at: b.created_at,
    };
  });

  const totalActive = flat.filter((b) => b.is_active).length;
  const totalInactive = flat.length - totalActive;

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
        <header className="mb-10 flex items-end justify-between flex-wrap gap-4 animate-fade-up">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-700)] font-bold">
              จัดการระบบ
              <span className="text-zinc-400 mx-2">·</span>
              <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
            </p>
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
              <span className="brand-gradient-text">สาขา</span> ทั้งหมด
            </h1>
            <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-2xl leading-relaxed">
              <strong className="font-bold text-zinc-900 tabular-num">
                {totalActive}
              </strong>{" "}
              สาขาเปิดใช้งาน
              {totalInactive > 0 && (
                <>
                  <span className="text-zinc-400 mx-1.5">·</span>
                  <span className="text-zinc-500">
                    ปิดอยู่{" "}
                    <strong className="font-bold tabular-num">
                      {totalInactive}
                    </strong>
                  </span>
                </>
              )}
              <span className="text-zinc-400 mx-1.5">·</span>
              <strong className="font-bold text-zinc-900 tabular-num">
                {companies.length}
              </strong>{" "}
              บริษัท
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Download link to API endpoint — Link component ใช้ download ตรง ๆ ไม่ได้ */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/admin/branches/export"
              className="inline-flex items-center gap-2 px-3 h-11 rounded-xl border-2 border-zinc-200 bg-white text-zinc-800 font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm"
            >
              <Download className="size-4" />
              Export CSV
            </a>
            <Link
              href="/branches/import"
              className="inline-flex items-center gap-2 px-3 h-11 rounded-xl border-2 border-zinc-200 bg-white text-zinc-800 font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm"
            >
              <Upload className="size-4" />
              นำเข้าไฟล์
            </Link>
            <Link
              href="/branches/new"
              className="inline-flex items-center gap-2 px-5 h-11 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] shadow-blue transition-colors text-sm"
            >
              <Plus className="size-4" />
              เพิ่มสาขา
            </Link>
          </div>
        </header>

        <Section
          number="01"
          label="ALL BRANCHES · TABLE VIEW"
          title="ทุกสาขา · กรองคัดลอกได้แบบ Excel"
          description="คลิกที่ชื่อสาขา / จังหวัด / ภาค / เบอร์ เพื่อแก้ตรงนั้นเลย · เลือกหลายแถวแล้ว ⌘C ก๊อปไป Excel · ⌘V วางจาก Excel เพื่อเพิ่ม/แก้สาขา"
          className="animate-fade-up delay-100"
        >
          <BranchesTableView branches={flat} />
        </Section>

        {flat.length === 0 && (
          <div className="mt-8 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 p-10 text-center">
            <Building2 className="size-10 text-zinc-300 mx-auto" />
            <p className="text-base font-bold text-zinc-700 mt-3">
              ยังไม่มีสาขาในระบบ
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              เพิ่มทีละสาขา หรือ นำเข้า CSV ทั้งล็อต
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
