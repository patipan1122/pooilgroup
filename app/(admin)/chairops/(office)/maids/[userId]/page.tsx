// /chairops/maids/[userId] — Maid detail page (BF1).
//
// Layout (3 sections on desktop, stacked on mobile):
//   Today + assignment (left top)
//   Day-off history (90d)
//   Pay history list (ADMIN+ only)
//   Assignment history (branch moves)

import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Wallet, Coffee, MapPin, Pencil } from "lucide-react";

import { requireRole } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { getMaidDetail } from "@/lib/chairops/queries/maid-roster";
import { baht, thaiDate } from "@/lib/chairops/utils/format";
import { prisma } from "@/lib/prisma";
import { LeaveRequestForm } from "../_components/leave-request-form";
import { DeleteLeaveButton } from "../_components/delete-leave-button";
import { ReassignBranchForm } from "../_components/reassign-branch-form";

export const dynamic = "force-dynamic";

export default async function MaidDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await requireRole(ChairopsUserRole.OFFICE);
  const { userId } = await params;
  const canMutate = rankOf(session.user.role) >= rankOf(ChairopsUserRole.ADMIN);
  const canViewCost = rankOf(session.user.role) >= rankOf(ChairopsUserRole.CEO);

  const detail = await getMaidDetail(session.user.orgId, userId);
  if (!detail) notFound();

  const branches = canMutate
    ? await prisma.chairopsBranch.findMany({
        where: { orgId: session.user.orgId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  const { maid, leaves, pay, assignments } = detail;
  const currentBranch = assignments.find((a) => a.isActive);
  const currentBranchName = currentBranch?.branchName ?? "ยังไม่ผูกสาขา";

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-500">
            <Link href="/chairops/maids" className="hover:text-emerald-700">
              แม่บ้าน
            </Link>{" "}
            / {maid.displayName}
          </div>
          <h1 className="text-xl font-bold text-zinc-900">{maid.displayName}</h1>
          <p className="text-sm text-zinc-500">
            สาขา: <span className="font-medium text-zinc-700">{currentBranchName}</span>
            {maid.phone ? ` · โทร ${maid.phone}` : ""}
          </p>
        </div>
        {canViewCost && (
          <Link
            href={`/chairops/maids/${maid.id}/pay`}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <Wallet className="size-4" aria-hidden /> บันทึกค่าจ้าง
          </Link>
        )}
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* Add leave */}
        {canMutate && (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <CalendarPlus className="size-4 text-amber-600" /> บันทึกวันลา
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              1 แถว = 1 วัน · ป้อนจำนวนวันได้ทีเดียว · ลบทีหลังได้
            </p>
            <LeaveRequestForm maidId={maid.id} />
          </div>
        )}

        {/* Re-assign branch */}
        {canMutate && (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <MapPin className="size-4 text-emerald-600" /> ย้ายสาขา
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              ปิด assignment เก่า · เปิดใหม่อัตโนมัติ (1:1 แม่บ้าน-สาขา)
            </p>
            <ReassignBranchForm
              maidId={maid.id}
              currentBranchId={maid.primaryBranchId}
              branches={branches}
            />
          </div>
        )}

        {/* Status sticky summary */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <Coffee className="size-4 text-amber-600" /> สถานะ
          </div>
          <ul className="space-y-1 text-sm">
            <li>
              <span className="text-zinc-500">บัญชี:</span>{" "}
              {maid.isActive ? (
                <span className="font-medium text-emerald-700">เปิดใช้งาน</span>
              ) : (
                <span className="font-medium text-rose-700">ปิดบัญชี</span>
              )}
            </li>
            <li>
              <span className="text-zinc-500">LINE:</span>{" "}
              {maid.lineUserId ? (
                <span className="font-mono text-xs">{maid.lineUserId.slice(0, 8)}…</span>
              ) : (
                <span className="text-zinc-400">ยังไม่เชื่อม</span>
              )}
            </li>
            <li>
              <span className="text-zinc-500">เริ่มต้นทำงาน:</span>{" "}
              {thaiDate(maid.createdAt)}
            </li>
            {canMutate && (
              <li className="pt-2">
                <Link
                  href={`/chairops/users/${maid.id}`}
                  className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900"
                >
                  <Pencil className="size-3" /> แก้ไขในผู้ใช้
                </Link>
              </li>
            )}
          </ul>
        </div>
      </section>

      {/* Leave history (90d) */}
      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <header className="border-b border-zinc-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-800">
            วันลา (ย้อนหลัง 90 วัน · {leaves.length} รายการ)
          </h2>
        </header>
        {leaves.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">ไม่มีรายการลา</div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {leaves.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="grow">
                  <div className="font-medium text-zinc-900">{thaiDate(l.date)}</div>
                  <div className="text-xs text-zinc-500">
                    {l.reason ?? "ไม่ระบุเหตุผล"} · บันทึกโดย {l.createdByName}
                  </div>
                </div>
                {canMutate && <DeleteLeaveButton id={l.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pay history (ADMIN+ only · CEO LOCKED) */}
      {canViewCost && (
        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-800">ค่าจ้างย้อนหลัง</h2>
            <Link
              href={`/chairops/maids/${maid.id}/pay`}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              ดู / บันทึกตามวัน →
            </Link>
          </header>
          {pay.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">ยังไม่มีบันทึกค่าจ้าง</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {pay.slice(0, 20).map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="grow">
                    <div className="font-medium text-zinc-900">{thaiDate(p.date)}</div>
                    <div className="text-xs text-zinc-500">
                      {p.note ?? "ไม่มีหมายเหตุ"} · {p.paidByName}
                    </div>
                  </div>
                  <div
                    className={
                      "tabular-nums font-semibold " +
                      (p.amount < 0 ? "text-rose-700" : "text-zinc-900")
                    }
                  >
                    {baht(p.amount, p.amount > 0)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Assignment history */}
      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <header className="border-b border-zinc-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-800">ประวัติสาขา</h2>
        </header>
        {assignments.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            ยังไม่มี assignment (สามารถสร้างได้จากบล็อก &quot;ย้ายสาขา&quot;)
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="grow">
                  <div className="font-medium text-zinc-900">{a.branchName}</div>
                  <div className="text-xs text-zinc-500">
                    {thaiDate(a.startedAt)} →{" "}
                    {a.endedAt ? thaiDate(a.endedAt) : "ปัจจุบัน"}
                  </div>
                </div>
                {a.isActive && (
                  <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    Active
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
