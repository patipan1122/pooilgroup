// /chairops/maids — Maid roster list (BF1).
//
// OFFICE+ read · ADMIN+ mutate. Status pills at top filter the table; clicking
// a row navigates to /chairops/maids/[userId]. The "ลาวันนี้" action is on the
// detail page (this list is scan-first, action-second).

import Link from "next/link";
import { ChevronRight, UserPlus, AlertTriangle, Coffee, CheckCircle2 } from "lucide-react";

import { requireRole } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { listMaidRoster } from "@/lib/chairops/queries/maid-roster";
import { baht } from "@/lib/chairops/utils/format";
import type { MaidRosterStatus } from "./types";

export const dynamic = "force-dynamic";

type SearchParams = { filter?: string };

const STATUS_LABEL: Record<MaidRosterStatus, string> = {
  working: "ทำงาน",
  on_leave: "ลา",
  no_slot: "ไม่มีสาขา",
  disabled: "ปิดบัญชี",
};

const STATUS_TONE: Record<MaidRosterStatus, string> = {
  working: "border-emerald-300 bg-emerald-50 text-emerald-800",
  on_leave: "border-amber-300 bg-amber-50 text-amber-800",
  no_slot: "border-rose-300 bg-rose-50 text-rose-800",
  disabled: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

export default async function MaidRosterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireRole(ChairopsUserRole.OFFICE);
  const sp = await searchParams;
  const filter = (sp.filter as MaidRosterStatus | "all" | undefined) ?? "all";
  const canMutate = rankOf(session.user.role) >= rankOf(ChairopsUserRole.ADMIN);
  const canViewCost = rankOf(session.user.role) >= rankOf(ChairopsUserRole.CEO);

  const rows = await listMaidRoster(session.user.orgId);

  const counts = {
    all: rows.length,
    working: rows.filter((r) => r.status === "working").length,
    on_leave: rows.filter((r) => r.status === "on_leave").length,
    no_slot: rows.filter((r) => r.status === "no_slot").length,
    disabled: rows.filter((r) => r.status === "disabled").length,
  };

  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">แม่บ้าน</h1>
          <p className="text-sm text-zinc-500">
            ภาพรวมแม่บ้านทุกสาขา · วันนี้มีลา {counts.on_leave} คน · ไม่มีแม่บ้าน {counts.no_slot} สาขา
          </p>
        </div>
        {canMutate && (
          <Link
            href="/chairops/users?new=MAID"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <UserPlus className="size-4" aria-hidden /> เพิ่มแม่บ้าน
          </Link>
        )}
      </header>

      <nav
        aria-label="กรองสถานะ"
        className="flex flex-wrap gap-2 text-xs font-medium"
      >
        <FilterPill href="/chairops/maids" label={`ทั้งหมด · ${counts.all}`} active={filter === "all"} />
        <FilterPill href="/chairops/maids?filter=working" label={`${STATUS_LABEL.working} · ${counts.working}`} active={filter === "working"} icon={<CheckCircle2 className="size-3" />} />
        <FilterPill href="/chairops/maids?filter=on_leave" label={`${STATUS_LABEL.on_leave} · ${counts.on_leave}`} active={filter === "on_leave"} icon={<Coffee className="size-3" />} />
        <FilterPill href="/chairops/maids?filter=no_slot" label={`${STATUS_LABEL.no_slot} · ${counts.no_slot}`} active={filter === "no_slot"} icon={<AlertTriangle className="size-3" />} />
        {counts.disabled > 0 && (
          <FilterPill href="/chairops/maids?filter=disabled" label={`${STATUS_LABEL.disabled} · ${counts.disabled}`} active={filter === "disabled"} />
        )}
      </nav>

      {/* มือถือ: เลื่อนซ้าย-ขวาดูคอลัมน์ค่าจ้าง/ปุ่มได้ (เดิม overflow-hidden ตัดทิ้ง) */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">ชื่อ</th>
              <th className="px-4 py-2.5">สาขา</th>
              <th className="px-4 py-2.5">สถานะวันนี้</th>
              <th className="px-4 py-2.5 text-right">วันลาเดือนนี้</th>
              {canViewCost && (
                <th className="px-4 py-2.5 text-right">ค่าจ้างเดือนนี้</th>
              )}
              <th className="px-4 py-2.5" aria-label="actions"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={canViewCost ? 6 : 5} className="px-4 py-8 text-center text-zinc-500">
                  ไม่มีรายการในตัวกรองนี้
                </td>
              </tr>
            )}
            {visible.map((m) => (
              <tr key={m.userId} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/chairops/maids/${m.userId}`}
                    className="font-medium text-zinc-900 hover:text-emerald-700"
                  >
                    {m.displayName}
                  </Link>
                  {m.phone && (
                    <div className="text-[11px] text-zinc-500">{m.phone}</div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-zinc-700">
                  {m.branchName ?? <span className="text-rose-600">ยังไม่ผูกสาขา</span>}
                  {m.branchCount > 1 && (
                    <span className="ml-1.5 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold text-emerald-700">
                      +{m.branchCount - 1} สาขา
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[m.status]}`}
                  >
                    {STATUS_LABEL[m.status]}
                    {m.todayDayOffReason ? ` · ${m.todayDayOffReason}` : ""}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                  {m.daysOffThisMonth}
                </td>
                {canViewCost && (
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-900">
                    {baht(m.thisMonthPaid)}
                  </td>
                )}
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/chairops/maids/${m.userId}`}
                    className="inline-flex items-center text-zinc-400 hover:text-zinc-900"
                    aria-label={`เปิดรายละเอียด ${m.displayName}`}
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterPill({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition-colors " +
        (active
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50")
      }
    >
      {icon}
      {label}
    </Link>
  );
}
