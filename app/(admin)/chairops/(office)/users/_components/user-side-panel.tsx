// F3: Inline side panel — shows user quick-manage without page change.
// Rendered as the `meta` prop of MasterDetailShell.
// Server component: receives pre-fetched `user` + `branches`.

import Link from "next/link";
import { InviteMaidForm } from "../invite/invite-form";
import { UserDetailForm } from "../[id]/user-detail-form";
import { canManageUser, canAssignRole } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import type { ChairopsUser } from "@/lib/generated/prisma/client";
import { ExternalLink } from "lucide-react";

interface Branch {
  id: string;
  name: string;
}

type Actor = ChairopsUser;

// Panel when admin clicks "เชิญแม่บ้าน"
export function InvitePanel({ branches }: { branches: ReadonlyArray<Branch> }) {
  return (
    <div className="p-4">
      <header className="mb-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          เชิญแม่บ้าน
        </p>
        <h2 className="mt-0.5 text-base font-semibold text-zinc-900">
          สร้างลิงก์เชิญ LINE
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          ส่งให้แม่บ้านกด → ล็อกอิน LINE → เข้าใช้งานได้เลย
        </p>
      </header>
      <InviteMaidForm branches={branches} />
    </div>
  );
}

// Panel when admin clicks on a user row
export function UserPanel({
  user,
  actor,
  branches,
  branchName,
  canHardDelete = false,
}: {
  user: ChairopsUser;
  actor: Actor;
  branches: ReadonlyArray<Branch>;
  branchName?: string;
  canHardDelete?: boolean;
}) {
  const ROLE_LABEL: Record<ChairopsUserRole, string> = {
    ADMIN: "แอดมิน", CEO: "CEO", MANAGER: "ผู้จัดการ",
    OFFICE: "ออฟฟิศ", MAID: "แม่บ้าน", TECHNICIAN: "ช่าง",
  };

  const manageable = canManageUser(actor, user);
  const assignableRoles = (Object.values(ChairopsUserRole) as ChairopsUserRole[]).filter(
    (r) => canAssignRole(actor, r) && r !== user.role,
  );

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            {ROLE_LABEL[user.role]}
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-zinc-900">
            {user.displayName}
          </h2>
          <p className="text-xs text-zinc-500">{user.email ?? "—"}</p>
          {user.lineUserId && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-emerald-600">
              <span aria-hidden>🟢</span>
              LINE: {user.lineDisplayName ?? "ผูกแล้ว"}
            </p>
          )}
          {branchName && (
            <p className="mt-0.5 text-xs text-zinc-600">สาขา: {branchName}</p>
          )}
        </div>
        <Link
          href={`/chairops/users/${user.id}`}
          className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          ดูเต็ม
        </Link>
      </header>

      <UserDetailForm
        target={{
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          primaryBranchId: user.primaryBranchId,
          isActive: user.isActive,
          lineUserId: user.lineUserId,
        }}
        canManage={manageable}
        canHardDelete={canHardDelete}
        assignableRoles={assignableRoles}
        branches={branches as Branch[]}
      />

      {user.role === ChairopsUserRole.MAID && manageable && (
        <Link
          href={`/chairops/maids/${user.id}`}
          className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
        >
          <span>🏢 จัดการสาขาที่ดูแล (เพิ่มได้หลายสาขา)</span>
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

// Empty state panel
export function EmptyPanel() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4 text-center">
      <div className="text-4xl">👤</div>
      <p className="text-sm text-zinc-500">เลือกผู้ใช้จากตาราง หรือกด "เชิญแม่บ้าน"</p>
    </div>
  );
}
