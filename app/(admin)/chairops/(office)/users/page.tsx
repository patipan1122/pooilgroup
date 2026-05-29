// ChairOps Users (W7 · claude-design Wave-1b) · 2-pane master-detail.
// Spec: /tmp/claude-design_chairops_plan.md §W7 + AUDIT_chairops_2026-05-25 §3.105
//
// Layout:
//   Sidebar (260) → filter chips (role · branch · status) + free-text search
//   Main          → user table · click row to deep-link to /chairops/users/[id]
//   No meta pane (full detail lives on its own route)
//
// Privilege model:
//   - Layout `(admin)/chairops/layout.tsx` gates module access (entitlement + role)
//   - This page requires ADMIN explicitly (defense in depth)
//   - Per-row "manageable" badge is purely informational; ALL mutations re-check
//     `canManageUser` / `canAssignRole` in server actions
//     (per [[role-rank-privilege-escalation-guard]]).
//
// IMPORTANT: This route lives under the `(office)` route group which is URL-
// transparent (Next.js docs). It resolves to `/chairops/users`. The old
// `app/(admin)/chairops/users/page.tsx` is deleted in this same workspace to
// avoid the "two pages resolve to the same route" build error.

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import {
  MasterDetailShell,
  stickyTheadClass,
} from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { canManageUser } from "@/lib/chairops/auth/role-guards";
import { thaiDate, thaiRelative } from "@/lib/chairops/utils/format";
import type { Prisma } from "@/lib/generated/prisma/client";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { UserPlus, Inbox } from "lucide-react";

// ---------- copy ----------

const ROLE_LABEL: Record<ChairopsUserRole, string> = {
  ADMIN: "แอดมิน",
  CEO: "CEO",
  MANAGER: "ผู้จัดการ",
  OFFICE: "ออฟฟิศ",
  MAID: "แม่บ้าน",
  TECHNICIAN: "ช่าง",
};

const ROLE_TONE: Record<
  ChairopsUserRole,
  "danger" | "warning" | "info" | "neutral" | "success" | "violet"
> = {
  ADMIN: "danger",
  CEO: "danger",
  MANAGER: "warning",
  OFFICE: "info",
  MAID: "neutral",
  TECHNICIAN: "violet",
};

const ALL_ROLES: ChairopsUserRole[] = [
  "ADMIN",
  "CEO",
  "MANAGER",
  "OFFICE",
  "MAID",
  "TECHNICIAN",
];

// ---------- page ----------

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    branch?: string;
    status?: "active" | "inactive";
    q?: string;
  }>;
}) {
  const session = await requireRole("ADMIN");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const roleFilter = (sp.role as ChairopsUserRole | undefined) ?? undefined;
  const branchFilter = sp.branch ?? "";
  const statusFilter = sp.status;

  const where: Prisma.ChairopsUserWhereInput = {};
  if (roleFilter && ALL_ROLES.includes(roleFilter)) {
    where.role = roleFilter;
  }
  if (branchFilter === "__none__") {
    where.primaryBranchId = null;
  } else if (branchFilter) {
    where.primaryBranchId = branchFilter;
  }
  if (statusFilter === "active") where.isActive = true;
  else if (statusFilter === "inactive") where.isActive = false;
  if (q) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
    ];
  }

  const [users, branches, roleCounts, pendingDenials] = await Promise.all([
    prisma.chairopsUser.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { displayName: "asc" }],
      take: 500,
    }),
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.chairopsUser.groupBy({
      by: ["role"],
      where: { isActive: true },
      _count: { _all: true },
    }),
    // Pending access-request denials (distinct authUserId in last 30 days).
    // Used only for the "Pending (N)" badge in the sidebar — full triage lives
    // in `/chairops/users/pending`.
    prisma.chairopsAuditLog.findMany({
      where: {
        action: "access.denied_no_chairops_user",
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: { entityId: true },
      distinct: ["entityId"],
    }),
  ]);

  const branchById = new Map(branches.map((b) => [b.id, b.name]));
  const roleCountMap = new Map<ChairopsUserRole, number>(
    roleCounts.map((r) => [r.role, r._count._all]),
  );

  return (
    <div className="chairops-scope">
      <MasterDetailShell
        sidebar={
          <UsersSidebar
            branches={branches}
            roleCountMap={roleCountMap}
            pendingCount={pendingDenials.length}
            activeRole={roleFilter}
            activeBranch={branchFilter}
            activeStatus={statusFilter}
            activeQuery={q}
          />
        }
        noMeta
      >
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-zinc-500">การจัดการสิทธิ์</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">
              ผู้ใช้งาน · Users
            </h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-600">
              สร้าง · เปลี่ยนสิทธิ์ · มอบสาขา · ปิดบัญชี · ทุกการเปลี่ยนแปลงถูก
              บันทึกใน audit log (BR15 maker/checker)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/chairops/users?role=MAID&branch=__none__&status=active">
              <Button variant="outline" size="sm">
                <Inbox className="size-4" aria-hidden="true" />
                แม่บ้านรอกำหนดสาขา
              </Button>
            </Link>
            <Link href="/chairops/users/pending">
              <Button variant="outline" size="sm">
                <Inbox className="size-4" aria-hidden="true" />
                คำขอเข้าใช้ ({pendingDenials.length})
              </Button>
            </Link>
            <Link href="/chairops/users/new">
              <Button variant="primary" size="sm">
                <UserPlus className="size-4" aria-hidden="true" />
                เพิ่มผู้ใช้
              </Button>
            </Link>
          </div>
        </header>

        {/* search */}
        <form className="mb-4" action="/chairops/users" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="ค้นหาอีเมล · ชื่อ"
            className="h-9 w-full max-w-md rounded-md border border-zinc-300 bg-white px-3 text-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
            aria-label="ค้นหาผู้ใช้"
          />
          {roleFilter && <input type="hidden" name="role" value={roleFilter} />}
          {branchFilter && <input type="hidden" name="branch" value={branchFilter} />}
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        </form>

        <div className="overflow-x-auto rounded-2xl border-2 border-zinc-200 bg-white shadow-soft">
          <table className="w-full min-w-[820px] text-sm">
            <thead
              className={stickyTheadClass(
                "bg-zinc-50 text-xs font-semibold text-zinc-600",
              )}
            >
              <tr className="bg-zinc-50 text-left [&>th]:bg-zinc-50">
                <th className="px-3 py-3 font-semibold">ชื่อ · อีเมล</th>
                <th className="px-3 py-3 font-semibold">สิทธิ์</th>
                <th className="px-3 py-3 font-semibold">สาขาประจำ</th>
                <th className="px-3 py-3 font-semibold">สถานะ</th>
                <th className="px-3 py-3 font-semibold">สร้างเมื่อ</th>
                <th className="px-3 py-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-16 text-center text-sm text-zinc-500"
                  >
                    ไม่พบผู้ใช้ที่ตรงเงื่อนไข ·{" "}
                    <Link
                      href="/chairops/users"
                      className="font-medium text-zinc-900 underline"
                    >
                      ล้างตัวกรอง
                    </Link>{" "}
                    หรือ{" "}
                    <Link
                      href="/chairops/users/new"
                      className="font-medium text-zinc-900 underline"
                    >
                      เพิ่มผู้ใช้ใหม่
                    </Link>
                  </td>
                </tr>
              )}
              {users.map((u) => {
                // Pure informational — server action re-checks.
                const manageable = canManageUser(session.user, u);
                return (
                  <tr
                    key={u.id}
                    className={
                      "hover:bg-zinc-50/70 " +
                      (u.isActive ? "" : "opacity-60")
                    }
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/chairops/users/${u.id}`}
                        className="block"
                      >
                        <div className="font-semibold text-zinc-900">
                          {u.displayName}
                          {u.id === session.user.id && (
                            <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                              คุณ
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {u.email ?? "—"}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill tone={ROLE_TONE[u.role]} size="xs">
                        {ROLE_LABEL[u.role]}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-zinc-700">
                      {u.primaryBranchId
                        ? (branchById.get(u.primaryBranchId) ?? "—")
                        : (
                          <span className="text-zinc-400">ไม่ระบุ</span>
                        )}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.isActive ? (
                        <StatusPill tone="success" size="xs" dot>
                          ใช้งาน
                        </StatusPill>
                      ) : (
                        <StatusPill tone="neutral" size="xs" dot>
                          ปิด
                        </StatusPill>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-zinc-600">
                      <div>{thaiDate(u.createdAt)}</div>
                      <div className="text-[11px] text-zinc-400">
                        {thaiRelative(u.createdAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/chairops/users/${u.id}`}
                        className={
                          "rounded-md border px-2.5 py-1 text-xs font-medium " +
                          (manageable
                            ? "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                            : "border-zinc-200 text-zinc-500 hover:bg-zinc-50")
                        }
                      >
                        {manageable ? "แก้ไข" : "ดู"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </MasterDetailShell>
    </div>
  );
}

// ---------- sidebar ----------

function UsersSidebar({
  branches,
  roleCountMap,
  pendingCount,
  activeRole,
  activeBranch,
  activeStatus,
  activeQuery,
}: {
  branches: { id: string; name: string }[];
  roleCountMap: Map<ChairopsUserRole, number>;
  pendingCount: number;
  activeRole?: ChairopsUserRole;
  activeBranch?: string;
  activeStatus?: "active" | "inactive";
  activeQuery: string;
}) {
  function buildHref(
    overrides: Partial<{
      role: ChairopsUserRole | "__all__";
      branch: string | "__all__";
      status: "active" | "inactive" | "__all__";
    }>,
  ) {
    const params = new URLSearchParams();
    if (activeQuery) params.set("q", activeQuery);
    const role = overrides.role ?? activeRole;
    const branch = overrides.branch ?? activeBranch;
    const status = overrides.status ?? activeStatus;
    if (role && role !== "__all__") params.set("role", role);
    if (branch && branch !== "__all__") params.set("branch", branch);
    if (status && status !== "__all__") params.set("status", status);
    const qs = params.toString();
    return "/chairops/users" + (qs ? `?${qs}` : "");
  }

  return (
    <nav className="flex h-full flex-col" aria-label="ตัวกรองผู้ใช้">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Users
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">
          ตัวกรอง
        </h2>
        {pendingCount > 0 && (
          <Link
            href="/chairops/users/pending"
            className="mt-2 flex items-center justify-between rounded-md bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
          >
            <span>คำขอรอ approve</span>
            <span className="rounded bg-amber-200 px-1.5 text-[11px]">
              {pendingCount}
            </span>
          </Link>
        )}
      </div>

      {/* status */}
      <FilterSection title="สถานะ">
        <FilterRow
          href={buildHref({ status: "__all__" })}
          label="ทั้งหมด"
          active={!activeStatus}
        />
        <FilterRow
          href={buildHref({ status: "active" })}
          label="ใช้งาน"
          dotClass="bg-emerald-500"
          active={activeStatus === "active"}
        />
        <FilterRow
          href={buildHref({ status: "inactive" })}
          label="ปิด"
          dotClass="bg-zinc-400"
          active={activeStatus === "inactive"}
        />
      </FilterSection>

      {/* role */}
      <FilterSection title="สิทธิ์">
        <FilterRow
          href={buildHref({ role: "__all__" })}
          label="ทั้งหมด"
          active={!activeRole}
        />
        {ALL_ROLES.map((r) => (
          <FilterRow
            key={r}
            href={buildHref({ role: r })}
            label={ROLE_LABEL[r]}
            count={roleCountMap.get(r) ?? 0}
            active={activeRole === r}
          />
        ))}
      </FilterSection>

      {/* branch */}
      <FilterSection title="สาขาประจำ">
        <FilterRow
          href={buildHref({ branch: "__all__" })}
          label="ทั้งหมด"
          active={!activeBranch}
        />
        <FilterRow
          href={buildHref({ branch: "__none__" })}
          label="ไม่ระบุสาขา"
          active={activeBranch === "__none__"}
        />
        {branches.map((b) => (
          <FilterRow
            key={b.id}
            href={buildHref({ branch: b.id })}
            label={b.name}
            active={activeBranch === b.id}
          />
        ))}
      </FilterSection>
    </nav>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-zinc-200/60 px-3 py-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
        {title}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function FilterRow({
  href,
  label,
  count,
  dotClass,
  active,
}: {
  href: string;
  label: string;
  count?: number;
  dotClass?: string;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={
          "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm " +
          (active
            ? "bg-zinc-900 font-semibold text-white"
            : "text-zinc-700 hover:bg-white")
        }
      >
        <span className="flex items-center gap-1.5 truncate">
          {dotClass && (
            <span className={"size-2 rounded-full " + dotClass} aria-hidden />
          )}
          {label}
        </span>
        {typeof count === "number" && (
          <span
            className={
              "shrink-0 text-[11px] tabular-nums " +
              (active ? "text-white/70" : "text-zinc-400")
            }
          >
            {count}
          </span>
        )}
      </Link>
    </li>
  );
}
