// Pending access requests (W7 · claude-design Wave-1b)
// Spec: /tmp/claude-design_chairops_plan.md §W7 + AUDIT_chairops_2026-05-25
//
// Source data: ChairopsAuditLog WHERE action='access.denied_no_chairops_user'
// Grouped by entityId (= authUserId · see lib/chairops/auth/session.ts) so we
// show ONE row per requester with `attempts` count + latest metadata.
//
// Wave-1b STUB: no dedicated ChairopsAccessRequest table yet — the denial log
// IS our queue. Approve creates a ChairopsUser row (via approveAccessRequest);
// reject just emits an audit row (the user keeps getting 403 until manually
// approved later or removed from the system).
// TODO[claude-design] Wave 2: real ChairopsAccessRequest table with status =
// PENDING / APPROVED / REJECTED so we can hide rejected requests from the UI.

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDetailShell } from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import { thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import { canAssignRole } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { ArrowLeft } from "lucide-react";
import { PendingRowActions } from "./pending-row-actions";

const ALL_ROLES: ChairopsUserRole[] = [
  "TECHNICIAN",
  "MAID",
  "OFFICE",
  "MANAGER",
  "CEO",
  "ADMIN",
];

interface PendingRow {
  authUserId: string;
  email: string | null;
  poolRole: string | null;
  attempts: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastNote: string | null;
}

export default async function PendingAccessRequestsPage() {
  const session = await requireRole("ADMIN");

  // Pull last 30 days of denials · last 200 rows is plenty (denial is rare)
  const raw = await prisma.chairopsAuditLog.findMany({
    where: {
      action: "access.denied_no_chairops_user",
      createdAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Group by entityId (= authUserId).
  const grouped = new Map<string, PendingRow>();
  for (const r of raw) {
    const authUserId = r.entityId;
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const email =
      typeof meta.email === "string" ? meta.email : null;
    const poolRole =
      typeof meta.poolRole === "string" ? meta.poolRole : null;
    const note = typeof meta.note === "string" ? meta.note : null;

    const existing = grouped.get(authUserId);
    if (!existing) {
      grouped.set(authUserId, {
        authUserId,
        email,
        poolRole,
        attempts: 1,
        firstSeenAt: r.createdAt,
        lastSeenAt: r.createdAt,
        lastNote: note,
      });
    } else {
      existing.attempts += 1;
      // r is in DESC order, so first iteration set lastSeenAt; update firstSeenAt
      if (r.createdAt < existing.firstSeenAt) {
        existing.firstSeenAt = r.createdAt;
      }
    }
  }

  // Filter out already-approved (an authUserId could exist in ChairopsUser now).
  const allUserIds = Array.from(grouped.keys());
  let approvedAuthIds = new Set<string>();
  if (allUserIds.length > 0) {
    const existing = await prisma.chairopsUser.findMany({
      where: { authUserId: { in: allUserIds } },
      select: { authUserId: true },
    });
    approvedAuthIds = new Set(
      existing
        .map((u) => u.authUserId)
        .filter((id): id is string => !!id),
    );
  }

  const rows: PendingRow[] = Array.from(grouped.values())
    .filter((r) => !approvedAuthIds.has(r.authUserId))
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());

  // Branches + assignable roles for the inline approve form (per row).
  const [branches] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const assignableRoles = ALL_ROLES.filter((r) =>
    canAssignRole(session.user, r),
  );

  return (
    <div className="chairops-scope">
      <MasterDetailShell sidebar={<PendingSidebar count={rows.length} />} noMeta>
        <header className="mb-5">
          <Link
            href="/chairops/users"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            กลับรายการผู้ใช้
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
            คำขอเข้าใช้งาน
          </h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600">
            ผู้ใช้ที่มีบัญชี Pool แล้ว แต่ยังไม่ได้ถูก approve เข้า ChairOps ·
            ดึงจาก audit log 30 วันล่าสุด · approve = สร้าง ChairopsUser row
          </p>
        </header>

        <div className="rounded-2xl border-2 border-zinc-200 bg-white shadow-soft">
          {rows.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-zinc-500">
                ยังไม่มีคำขอเข้าใช้ · ทุกคนที่ login Pool เข้าถึง ChairOps ได้แล้ว
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-600">
                  <tr className="text-left">
                    <th className="px-3 py-3 font-semibold">ผู้ขอ</th>
                    <th className="px-3 py-3 font-semibold">Pool Role</th>
                    <th className="px-3 py-3 font-semibold text-right">
                      ครั้งที่พยายาม
                    </th>
                    <th className="px-3 py-3 font-semibold">ครั้งล่าสุด</th>
                    <th className="px-3 py-3 font-semibold">การกระทำ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map((r) => (
                    <tr key={r.authUserId}>
                      <td className="px-3 py-3 align-top">
                        <div className="font-semibold text-zinc-900">
                          {r.email ?? "—"}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                          {r.authUserId}
                        </div>
                        {r.lastNote && (
                          <div className="mt-1 text-[11px] text-zinc-600">
                            {r.lastNote}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {r.poolRole ? (
                          <StatusPill tone="info" size="xs">
                            {r.poolRole}
                          </StatusPill>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-right">
                        <StatusPill
                          tone={r.attempts >= 5 ? "danger" : r.attempts >= 2 ? "warning" : "neutral"}
                          size="xs"
                        >
                          {r.attempts}×
                        </StatusPill>
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-zinc-700">
                        <div>{thaiDateTime(r.lastSeenAt)}</div>
                        <div className="text-[11px] text-zinc-400">
                          {thaiRelative(r.lastSeenAt)}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <PendingRowActions
                          authUserId={r.authUserId}
                          suggestedEmail={r.email ?? ""}
                          assignableRoles={assignableRoles}
                          branches={branches}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-4 text-[11px] text-zinc-500">
          STUB · Wave 1b: ใช้ audit log แทน table จริง · Wave 2 จะมี
          ChairopsAccessRequest table + LINE notify เมื่อ approve / reject
        </p>
      </MasterDetailShell>
    </div>
  );
}

function PendingSidebar({ count }: { count: number }) {
  return (
    <nav className="flex h-full flex-col" aria-label="นำทาง">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Users
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">
          คำขอ ({count})
        </h2>
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
      </ul>
    </nav>
  );
}
