// /admin/users — ผู้ใช้งานทั้งหมด แสดงตามประเภทธุรกิจ → สาขา → คน
// User-friendly: กดย่อ-ขยายตามประเภท เห็นจำนวนคนแต่ละตำแหน่ง เชิญในที่เดียว

import Link from "next/link";
import { UserPlus, Inbox, Upload, Download, Building2 } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { thaiDateLong } from "@/lib/utils/format";
import {
  UsersByBusiness,
  type BranchWithUsers,
  type BranchUser,
  type Company,
  type AdminNotification,
} from "./users-by-business";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();
  const orgId = session.user.org_id;

  // Step 1: companies + branches + users + user_branches + notifications in parallel
  const [
    companiesQ,
    branchesQ,
    usersQ,
    userBranchesQ,
    requestsQ,
    notifQ,
    perUserNotifQ,
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("companies")
      .select("id, code, name")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("code"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("branches")
      .select("id, code, name, business_type, company_id, province, is_active, phone, line_group_id, settings")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("code"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("users")
      .select(
        "id, name, email, phone, role, is_active, line_user_id, telegram_user_id, invite_used_at, last_login_at, created_at",
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("user_branches")
      .select("user_id, branch_id, is_active")
      .eq("org_id", orgId)
      .eq("is_active", true),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("register_requests")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("notifications")
      .select("id, type, title, body, link, created_at, is_read")
      .eq("org_id", orgId)
      .eq("user_id", session.user.id)
      .or("module.eq.core,module.is.null")
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(10),
    // Per-user unread count — used to render a red dot next to that user's
    // name in the list. v1 proxy: any unread notification addressed to user X.
    // When schema for explicit "user-to-admin requests" exists, swap source.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from as any)("notifications")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("is_read", false),
  ]);

  const notifications: AdminNotification[] = (notifQ.data ?? []) as AdminNotification[];

  // Compact { userId → unread count } map for per-user red dots.
  const perUserNotif = (perUserNotifQ.data ?? []) as Array<{ user_id: string }>;
  const unreadByUserId: Record<string, number> = {};
  for (const r of perUserNotif) {
    unreadByUserId[r.user_id] = (unreadByUserId[r.user_id] ?? 0) + 1;
  }

  const companies: Company[] = (companiesQ.data ?? []) as Company[];
  const branches = (branchesQ.data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    business_type: string;
    company_id: string | null;
    province: string | null;
    is_active: boolean;
  }>;

  const allUsers = (usersQ.data ?? []) as Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    is_active: boolean;
    line_user_id: string | null;
    telegram_user_id: string | null;
    invite_used_at: string | null;
    last_login_at: string | null;
    created_at: string;
  }>;
  const userById = new Map<string, BranchUser>();
  for (const u of allUsers) {
    userById.set(u.id, {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      is_active: u.is_active,
      has_line: !!u.line_user_id,
      has_telegram: !!u.telegram_user_id,
      invite_used: !!u.invite_used_at || u.is_active,
      last_login_at: u.last_login_at,
      created_at: u.created_at,
    });
  }

  const ubRows = (userBranchesQ.data ?? []) as Array<{
    user_id: string;
    branch_id: string;
  }>;

  // Count branches missing a branch_manager — every branch should have one
  // per CEO rule. Computed before stats so stat card can show the count.
  const branchHasMgr = new Set<string>();
  for (const ub of ubRows) {
    const u = userById.get(ub.user_id);
    if (u?.role === "branch_manager") branchHasMgr.add(ub.branch_id);
  }
  const branchesWithoutMgr = branches.filter((b) => !branchHasMgr.has(b.id));

  // Compute stats — must match the matchesFilter logic in users-by-business.tsx
  // exactly, otherwise clicking a stat card produces a different count than the card shows.
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const stats = {
    total: allUsers.length,
    activeWeek: allUsers.filter(
      (u) => u.is_active && u.last_login_at && now - new Date(u.last_login_at).getTime() < week,
    ).length,
    newThisWeek: allUsers.filter((u) => now - new Date(u.created_at).getTime() < week).length,
    pendingActivation: allUsers.filter((u) => !u.is_active && !u.invite_used_at).length,
    noLine: allUsers.filter((u) => u.is_active && !u.line_user_id).length,
    noTelegram: allUsers.filter((u) => u.is_active && !u.telegram_user_id).length,
    offline7d: allUsers.filter(
      (u) =>
        u.is_active &&
        (!u.last_login_at || now - new Date(u.last_login_at).getTime() >= week),
    ).length,
    branchesMissingMgr: branchesWithoutMgr.length,
  };

  // Build branchId → users[]
  const usersByBranchId = new Map<string, BranchUser[]>();
  const assignedUserIds = new Set<string>();
  for (const ub of ubRows) {
    const u = userById.get(ub.user_id);
    if (!u) continue;
    assignedUserIds.add(ub.user_id);
    if (!usersByBranchId.has(ub.branch_id)) usersByBranchId.set(ub.branch_id, []);
    usersByBranchId.get(ub.branch_id)!.push(u);
  }

  const branchesWithUsers: BranchWithUsers[] = branches.map((b) => ({
    ...b,
    users: usersByBranchId.get(b.id) ?? [],
  }));

  // Unassigned: super_admin, admin, org_admin, viewer that have no user_branches link
  const unassigned: BranchUser[] = [];
  for (const u of allUsers) {
    if (assignedUserIds.has(u.id)) continue;
    // Only show roles that intentionally don't have branch assignment
    if (
      u.role === "super_admin" ||
      u.role === "admin" ||
      u.role === "org_admin" ||
      u.role === "viewer"
    ) {
      const cu = userById.get(u.id);
      if (cu) unassigned.push(cu);
    }
  }

  const pendingCount = requestsQ.count ?? 0;
  const totalUsers = allUsers.filter((u) => u.is_active).length;
  const totalBranches = branches.length;

  // Build flat list for the Excel-style table view (DataGrid).
  const branchCodeById = new Map(branches.map((b) => [b.id, b.code]));
  const codesByUserId = new Map<string, string[]>();
  for (const ub of ubRows) {
    const code = branchCodeById.get(ub.branch_id);
    if (!code) continue;
    if (!codesByUserId.has(ub.user_id)) codesByUserId.set(ub.user_id, []);
    codesByUserId.get(ub.user_id)!.push(code);
  }
  const flatUsers = allUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    branchCodes: (codesByUserId.get(u.id) ?? []).join(", "),
    status: (u.is_active
      ? "active"
      : u.invite_used_at
        ? "inactive"
        : "pending") as "active" | "pending" | "inactive",
    has_line: !!u.line_user_id,
    has_telegram: !!u.telegram_user_id,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
  }));

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

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-6xl mx-auto pb-24">
        <header className="mb-12 flex items-end justify-between flex-wrap gap-4 animate-fade-up">
          <div>
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[var(--color-brand-700)] font-bold">
              จัดการระบบ
              <span className="text-zinc-400 mx-2">·</span>
              <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.03em] font-display mt-5 leading-[1.05]">
              <span className="brand-gradient-text">ผู้ใช้</span> ทั้งหมด
            </h1>
            <p className="text-sm sm:text-base text-zinc-600 mt-5 max-w-2xl leading-relaxed">
              <strong className="font-bold text-zinc-900 tabular-num">{totalUsers}</strong>{" "}
              คนในระบบ
              <span className="text-zinc-400 mx-1.5">·</span>
              <strong className="font-bold text-zinc-900 tabular-num">
                {totalBranches}
              </strong>{" "}
              สาขา
              <span className="text-zinc-400 mx-1.5">·</span>
              <strong className="font-bold text-zinc-900 tabular-num">
                {companies.length}
              </strong>{" "}
              บริษัท
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/users/requests"
              className="inline-flex items-center gap-2 px-4 h-11 rounded-xl border-2 border-zinc-200 bg-white font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm relative"
            >
              <Inbox className="size-4" />
              คำขอใหม่
              {pendingCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center size-5 rounded-full bg-[var(--color-danger)] text-white text-[10px] font-bold">
                  {pendingCount}
                </span>
              )}
            </Link>
            <a
              href="/api/admin/users/export"
              className="inline-flex items-center gap-2 px-3 h-11 rounded-xl border-2 border-zinc-200 bg-white text-zinc-800 font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm"
              title="ดาวน์โหลด CSV รายชื่อทั้งหมด"
            >
              <Download className="size-4" />
              Export CSV
            </a>
            <Link
              href="/users/import"
              className="inline-flex items-center gap-2 px-3 h-11 rounded-xl border-2 border-zinc-200 bg-white text-zinc-800 font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm"
            >
              <Upload className="size-4" />
              นำเข้าผู้ใช้
            </Link>
            <Link
              href="/branches/import"
              className="inline-flex items-center gap-2 px-3 h-11 rounded-xl border-2 border-zinc-200 bg-white text-zinc-800 font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm"
            >
              <Building2 className="size-4" />
              นำเข้าสาขา
            </Link>
            <Link
              href="/users/new"
              className="inline-flex items-center gap-2 px-5 h-11 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] shadow-blue transition-colors text-sm"
            >
              <UserPlus className="size-4" />
              เชิญผู้ใช้
            </Link>
          </div>
        </header>

        {/* Empty state — no users + no branches yet (fresh org).
            Without this, fresh orgs see a blank list with no idea what to do. */}
        {allUsers.length <= 1 && branches.length === 0 ? (
          <Section
            number="01"
            label="GETTING STARTED"
            title="ยังไม่มีสาขา · ยังไม่มีผู้ใช้"
            description="ก่อนเชิญผู้ใช้ ต้องสร้างสาขาก่อน — สร้างสาขาแรกและเชิญผู้จัดการสาขาในขั้นเดียว"
            className="animate-fade-up delay-100"
          >
            <div className="rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-10 text-center">
              <Building2 className="size-10 mx-auto text-zinc-400 mb-4" />
              <p className="text-base text-zinc-700 font-bold mb-2">
                เริ่มต้นใช้งาน Pooilgroup
              </p>
              <p className="text-sm text-zinc-500 mb-6 max-w-md mx-auto">
                สร้างสาขาแรก แล้วค่อยเชิญผู้ใช้เข้ามาบริหาร · หรือถ้ามีรายชื่อสาขาเป็นไฟล์อยู่แล้ว
                ก็นำเข้าทีเดียวได้
              </p>
              <div className="flex justify-center gap-2 flex-wrap">
                <Link
                  href="/branches/new"
                  className="inline-flex items-center gap-2 px-5 h-11 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] transition-colors text-sm"
                >
                  <Building2 className="size-4" />
                  สร้างสาขาแรก
                </Link>
                <Link
                  href="/branches/import"
                  className="inline-flex items-center gap-2 px-4 h-11 rounded-xl border-2 border-zinc-200 bg-white text-zinc-800 font-bold hover:border-[var(--color-brand-300)] transition-colors text-sm"
                >
                  <Upload className="size-4" />
                  นำเข้าจากไฟล์
                </Link>
              </div>
            </div>
          </Section>
        ) : (
        <Section
          number="01"
          label="BY BUSINESS · BY BRANCH"
          title="ทุกธุรกิจ · ทุกสาขา · ทุกคน"
          description="กดที่หัวข้อธุรกิจเพื่อย่อ/ขยาย — เห็นทุกสาขาและคนในสาขา · กดเชิญในที่เดียว"
          className="animate-fade-up delay-100"
        >
          <UsersByBusiness
            companies={companies}
            branches={branchesWithUsers}
            unassigned={unassigned}
            notifications={notifications}
            pendingRequestCount={pendingCount}
            stats={stats}
            nowMs={now}
            flatUsers={flatUsers}
            currentUserId={session.user.id}
            currentUserRole={session.actingAs?.realUser.role ?? session.user.role}
            unreadByUserId={unreadByUserId}
          />
        </Section>
        )}
      </div>
    </div>
  );
}
