// Create user (W7 · claude-design Wave-1b)
// Spec: /tmp/claude-design_chairops_plan.md §W7 + AUDIT_chairops_2026-05-25 §3.107
//
// ADMIN-only · creates Supabase auth user + ChairopsUser profile in one server
// action (atomic — see app/(admin)/chairops/users/actions.ts:createUser).
// Role-rank guard is enforced server-side (we only show assignable roles in UI
// as a UX courtesy; server re-checks per [[role-rank-privilege-escalation-guard]]).

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDetailShell } from "@/components/chairops/_kit";
import { canAssignRole } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { ArrowLeft } from "lucide-react";
import { NewUserForm } from "./new-user-form";

const ALL_ROLES: ChairopsUserRole[] = [
  "TECHNICIAN",
  "MAID",
  "OFFICE",
  "MANAGER",
  "CEO",
  "ADMIN",
];

export default async function NewUserPage() {
  const session = await requireRole("ADMIN");

  // Only show roles the actor can actually assign (server re-checks anyway).
  const assignableRoles = ALL_ROLES.filter((r) =>
    canAssignRole(session.user, r),
  );

  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="chairops-scope">
      <MasterDetailShell sidebar={<NewSidebar />} noMeta>
        <header className="mb-5">
          <Link
            href="/chairops/users"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            กลับรายการผู้ใช้
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
            เพิ่มผู้ใช้ใหม่
          </h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600">
            ระบบจะสร้าง 1) Supabase auth account 2) ChairOps profile · ระบบจะ
            ตั้งรหัสผ่านชั่วคราว · ผู้ใช้ต้องกด &quot;ลืมรหัสผ่าน&quot; ในครั้งแรก
          </p>
        </header>

        <div className="mx-auto max-w-2xl">
          <NewUserForm assignableRoles={assignableRoles} branches={branches} />
        </div>
      </MasterDetailShell>
    </div>
  );
}

function NewSidebar() {
  return (
    <nav className="flex h-full flex-col" aria-label="นำทาง">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Users
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">รายการ</h2>
      </div>
      <ul className="flex-1 divide-y divide-zinc-200/60 px-2 py-2">
        <li>
          <Link
            href="/chairops/users"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-white"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            ทั้งหมด
          </Link>
        </li>
        <li>
          <Link
            href="/chairops/users/pending"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-white"
          >
            คำขอเข้าใช้
          </Link>
        </li>
      </ul>
    </nav>
  );
}
