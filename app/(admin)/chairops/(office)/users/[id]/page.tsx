// User detail · W7 · claude-design Wave-1b
// Spec: /tmp/claude-design_chairops_plan.md §W7 + AUDIT_chairops_2026-05-25 §3.106
//
// Layout: 3-pane MasterDetailShell
//   Sidebar   → "back to list" + quick-jump role filters (same UX as list page,
//               but here we hard-code "no filters applied" — we just want the
//               operator to click another user without losing context)
//   Main      → profile card + role / branch / status editors (client form)
//   Meta (right rail) → system metadata + audit log mini-table
//
// Privilege model:
//   - requireRole("ADMIN") at top
//   - canManageUser(actor, target) decides if forms are editable
//   - canAssignRole(actor, role) decides which roles appear in the dropdown
//   - Server actions re-check both (per [[role-rank-privilege-escalation-guard]])
//
// Audit log mini-table reads from ChairopsAuditLog WHERE entity='User'
// AND entityId=target.id ORDER BY createdAt DESC LIMIT 30.

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import {
  MasterDetailShell,
  MakerCheckerBadge,
  ChairCodeChip,
} from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import { thaiDateTime } from "@/lib/chairops/utils/format";
import { canAssignRole, canManageUser } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { ArrowLeft } from "lucide-react";
import { UserDetailForm } from "./user-detail-form";

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

// MAID = single branch (per [[chairops-maid-one-per-branch-collect-only]])
// MGR / OFFICE = multi-branch capable but Wave-1 stores only `primaryBranchId`.
// TODO[claude-design] (Wave 2): ChairopsBranchAssignment multi-rows for OFFICE/MGR.
const ALL_ROLES: ChairopsUserRole[] = [
  "TECHNICIAN",
  "MAID",
  "OFFICE",
  "MANAGER",
  "CEO",
  "ADMIN",
];

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("ADMIN");
  const { id } = await params;

  const target = await prisma.chairopsUser.findUnique({ where: { id } });
  if (!target) notFound();

  const [branches, recentAudit, recentByActor] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.chairopsAuditLog.findMany({
      where: { entity: "User", entityId: target.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { displayName: true, role: true } } },
    }),
    // First "create" entry (if any) tells us "who created this user"
    prisma.chairopsAuditLog.findFirst({
      where: { entity: "User", entityId: target.id, action: "user.create" },
      include: { user: { select: { displayName: true, role: true } } },
    }),
  ]);

  // GUARDED: assignable roles = roles actor can grant.
  // Page is read-only for higher-rank target (canManage=false → form disables).
  const canManage = canManageUser(session.user, target);
  const assignableRoles = ALL_ROLES.filter((r) =>
    canAssignRole(session.user, r),
  );

  const primaryBranch = target.primaryBranchId
    ? branches.find((b) => b.id === target.primaryBranchId)
    : null;

  return (
    <div className="chairops-scope">
      <MasterDetailShell
        sidebar={<DetailSidebar />}
        meta={
          <DetailMeta
            target={target}
            recentByActor={recentByActor}
            primaryBranch={primaryBranch ?? null}
          />
        }
      >
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link
              href="/chairops/users"
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              กลับรายการผู้ใช้
            </Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
              {target.displayName}
              {target.id === session.user.id && (
                <span className="ml-2 align-middle text-xs font-medium text-zinc-500">
                  (คุณ)
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-sm text-zinc-600">{target.email ?? "—"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={ROLE_TONE[target.role]} size="sm">
              {ROLE_LABEL[target.role]}
            </StatusPill>
            {target.isActive ? (
              <StatusPill tone="success" size="sm" dot>
                ใช้งาน
              </StatusPill>
            ) : (
              <StatusPill tone="neutral" size="sm" dot>
                ปิด
              </StatusPill>
            )}
          </div>
        </header>

        {!canManage && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">
              คุณ ({ROLE_LABEL[session.user.role]}) ไม่มีสิทธิ์แก้ไขผู้ใช้
              ระดับ {ROLE_LABEL[target.role]}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              ดูได้อย่างเดียว · ใช้บัญชี ADMIN/CEO เท่านั้น
            </p>
          </div>
        )}

        <UserDetailForm
          target={{
            id: target.id,
            email: target.email,
            displayName: target.displayName,
            role: target.role,
            primaryBranchId: target.primaryBranchId,
            isActive: target.isActive,
            lineUserId: target.lineUserId,
          }}
          canManage={canManage}
          assignableRoles={assignableRoles}
          branches={branches}
        />

        {/* Audit log mini-table */}
        <section className="mt-6 rounded-2xl border-2 border-zinc-200 bg-white shadow-soft">
          <header className="border-b border-zinc-200 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              Audit log
            </p>
            <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">
              ประวัติการเปลี่ยนแปลง ({recentAudit.length})
            </h2>
          </header>
          {recentAudit.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              ยังไม่มีประวัติ
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-zinc-50 text-xs font-semibold text-zinc-600">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-semibold">เมื่อ</th>
                    <th className="px-3 py-2 font-semibold">การกระทำ</th>
                    <th className="px-3 py-2 font-semibold">โดย</th>
                    <th className="px-3 py-2 font-semibold">เปลี่ยน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {recentAudit.map((a) => (
                    <tr key={a.id}>
                      <td className="px-3 py-2 align-top text-xs text-zinc-600">
                        {thaiDateTime(a.createdAt)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <AuditActionPill action={a.action} />
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-zinc-700">
                        {a.user
                          ? `${a.user.displayName} · ${a.user.role}`
                          : (
                            <span className="text-zinc-400">ระบบ</span>
                          )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        <DiffSpan
                          oldValue={a.oldValue}
                          newValue={a.newValue}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </MasterDetailShell>
    </div>
  );
}

// ---------- sidebar (server) ----------

function DetailSidebar() {
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
            href="/chairops/users/new"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-white"
          >
            + เพิ่มผู้ใช้
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

// ---------- meta rail (server) ----------

function DetailMeta({
  target,
  recentByActor,
  primaryBranch,
}: {
  target: {
    id: string;
    authUserId: string | null;
    lineUserId: string | null;
    phone: string | null;
    createdAt: Date;
    updatedAt: Date;
    role: ChairopsUserRole;
  };
  recentByActor: {
    createdAt: Date;
    user: { displayName: string; role: ChairopsUserRole } | null;
  } | null;
  primaryBranch: { id: string; name: string } | null;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-soft">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Maker / Checker
        </p>
        <div className="mt-2">
          <MakerCheckerBadge
            maker={
              recentByActor?.user
                ? {
                    name: `${recentByActor.user.displayName} · ${recentByActor.user.role}`,
                    at: thaiDateTime(recentByActor.createdAt),
                  }
                : null
            }
            noApprover
          />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-soft">
        <p className="text-[10px] font-bold tracking-[0.02em] text-zinc-500">
          ข้อมูลระบบ
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="User ID">
            <span className="font-mono text-xs">{target.id}</span>
          </Row>
          <Row label="Auth User ID">
            <span className="font-mono text-xs">
              {target.authUserId ?? "—"}
            </span>
          </Row>
          <Row label="LINE User ID">
            <span className="font-mono text-xs">
              {target.lineUserId ?? "—"}
            </span>
          </Row>
          <Row label="Phone">{target.phone ?? "—"}</Row>
          <Row label="สร้างเมื่อ">{thaiDateTime(target.createdAt)}</Row>
          <Row label="แก้ไขล่าสุด">{thaiDateTime(target.updatedAt)}</Row>
        </dl>
      </section>

      {primaryBranch && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-soft">
          <p className="text-[10px] font-bold tracking-[0.02em] text-zinc-500">
            สาขาประจำ
          </p>
          <div className="mt-2">
            <ChairCodeChip
              code={primaryBranch.name}
              branch={target.role === "MAID" ? "1 คน : 1 สาขา" : undefined}
              size="md"
            />
          </div>
        </section>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-24 shrink-0 text-xs text-zinc-500">{label}</dt>
      <dd className="text-zinc-800">{children}</dd>
    </div>
  );
}

// ---------- audit row helpers ----------

const ACTION_LABEL: Record<string, { label: string; tone: "info" | "warning" | "danger" | "success" | "violet" | "neutral" }> = {
  "user.create": { label: "สร้างผู้ใช้", tone: "info" },
  "user.update_role": { label: "เปลี่ยนสิทธิ์", tone: "warning" },
  "user.assign_branch": { label: "มอบสาขา", tone: "violet" },
  "user.update_display_name": { label: "แก้ชื่อ", tone: "neutral" },
  "user.deactivate": { label: "ปิดบัญชี", tone: "danger" },
  "user.reactivate": { label: "เปิดบัญชี", tone: "success" },
  "user.bind_line": { label: "ผูก LINE", tone: "success" },
  "user.unbind_line": { label: "ยกเลิกผูก LINE", tone: "neutral" },
  "user.access_approve": { label: "อนุมัติเข้าใช้", tone: "success" },
  "user.access_reject": { label: "ปฏิเสธคำขอ", tone: "danger" },
};

function AuditActionPill({ action }: { action: string }) {
  const meta = ACTION_LABEL[action];
  if (!meta) {
    return (
      <StatusPill tone="neutral" size="xs">
        <span className="font-mono">{action}</span>
      </StatusPill>
    );
  }
  return (
    <StatusPill tone={meta.tone} size="xs">
      {meta.label}
    </StatusPill>
  );
}

function DiffSpan({
  oldValue,
  newValue,
}: {
  oldValue: unknown;
  newValue: unknown;
}) {
  const o =
    oldValue && typeof oldValue === "object"
      ? (oldValue as Record<string, unknown>)
      : null;
  const n =
    newValue && typeof newValue === "object"
      ? (newValue as Record<string, unknown>)
      : null;
  const keys = Array.from(
    new Set([...(o ? Object.keys(o) : []), ...(n ? Object.keys(n) : [])]),
  );
  if (keys.length === 0) return <span className="text-zinc-400">—</span>;
  return (
    <span className="space-y-0.5 font-mono text-[11px]">
      {keys.map((k) => (
        <span key={k} className="mr-2 block">
          <span className="text-zinc-500">{k}: </span>
          <span className="text-rose-700 line-through">
            {String(o?.[k] ?? "∅")}
          </span>{" "}
          <span className="text-zinc-400">→</span>{" "}
          <span className="text-emerald-700">{String(n?.[k] ?? "∅")}</span>
        </span>
      ))}
    </span>
  );
}
