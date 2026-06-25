// ChairOps · ประวัติการอนุมัติตัดเงินขาด (Write-off approval history)
// CEO 2026-06-25: หน้าประวัติแยก ค้นหา/กรองได้ (วันที่ · สาขา · คนอนุมัติ · ยอด ·
// อนุมัติเอง). อ่านอย่างเดียว — ทุกการตัดสิน (อนุมัติ/ปฏิเสธ) ถูก stamp ที่นี่.
// "อนุมัติเอง" ตรวจจาก approverId === makerId (single-approver superadmin · BR7 waiver).
// ดู memory [[chairops-writeoff-single-approver-superadmin-2026-06-25]].
//
// Server-first · GET-form filters · org-scoped (multi-tenant safe).

import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { StatusPill } from "@/components/ui/status-pill";
import { baht, thaiDateTime } from "@/lib/chairops/utils/format";

type Decision = "ALL" | "APPROVED" | "REJECTED";

function bangkokStart(d: string): Date | null {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00+07:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function bangkokEnd(d: string): Date | null {
  if (!d) return null;
  const dt = new Date(`${d}T23:59:59+07:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export default async function WriteOffHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    decision?: string;
    branch?: string;
    approver?: string;
    from?: string;
    to?: string;
    amountMin?: string;
    amountMax?: string;
    self?: string;
  }>;
}) {
  const session = await requireRole("OFFICE");
  if (!session) redirect("/login");
  const sp = await searchParams;
  const orgId = session.user.orgId;

  const decision: Decision =
    sp.decision === "APPROVED" || sp.decision === "REJECTED"
      ? sp.decision
      : "ALL";
  const fromVal = sp.from ?? "";
  const toVal = sp.to ?? "";
  const branchVal = sp.branch ?? "";
  const approverVal = sp.approver ?? "";
  const amountMinVal = sp.amountMin ?? "";
  const amountMaxVal = sp.amountMax ?? "";
  const selfOnly = sp.self === "1";

  // ---------- build WHERE ----------
  const statusWhere =
    decision === "ALL" ? { in: ["APPROVED", "REJECTED"] } : decision;

  const approverAtRange: { gte?: Date; lte?: Date } = {};
  const from = bangkokStart(fromVal);
  const to = bangkokEnd(toVal);
  if (from) approverAtRange.gte = from;
  if (to) approverAtRange.lte = to;

  const amountRange: { gte?: number; lte?: number } = {};
  const amountMin = Number(amountMinVal);
  const amountMax = Number(amountMaxVal);
  if (amountMinVal && Number.isFinite(amountMin)) amountRange.gte = amountMin;
  if (amountMaxVal && Number.isFinite(amountMax)) amountRange.lte = amountMax;

  const where = {
    orgId,
    status: statusWhere,
    ...(branchVal ? { branchId: branchVal } : {}),
    ...(approverVal ? { approverId: approverVal } : {}),
    ...(Object.keys(approverAtRange).length ? { approverAt: approverAtRange } : {}),
    ...(Object.keys(amountRange).length ? { amount: amountRange } : {}),
  };

  const [rows, branches, approverUsers] = await Promise.all([
    prisma.chairopsWriteOff.findMany({
      where,
      orderBy: { approverAt: "desc" },
      take: 500,
      include: {
        maker: { select: { displayName: true, role: true } },
        approver: { select: { id: true, displayName: true, role: true } },
      },
    }),
    prisma.chairopsBranch.findMany({
      where: { orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.chairopsUser.findMany({
      where: { orgId, role: { in: ["MANAGER", "CEO", "ADMIN"] } },
      select: { id: true, displayName: true, role: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  // "อนุมัติเอง" = ปิดแบบ APPROVED และ ผู้อนุมัติ = ผู้สร้าง
  const decorated = rows
    .map((w) => ({
      ...w,
      selfApproved:
        w.status === "APPROVED" && w.approverId != null && w.approverId === w.makerId,
    }))
    .filter((w) => (selfOnly ? w.selfApproved : true));

  const approvedTotal = decorated
    .filter((w) => w.status === "APPROVED")
    .reduce((sum, w) => sum + w.amount, 0);
  const rejectedCount = decorated.filter((w) => w.status === "REJECTED").length;
  const selfCount = decorated.filter((w) => w.selfApproved).length;

  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  const inputCls =
    "h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300";
  const labelCls =
    "text-[11px] font-semibold tracking-[0.02em] text-zinc-500";

  return (
    <div className="chairops-scope min-h-screen bg-muted/40">
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4 sm:px-6">
          <Link href="/chairops/dashboard" className="text-sm font-bold text-foreground">
            ChairOps · ออฟฟิศ
          </Link>
          <span className="text-zinc-300">/</span>
          <Link
            href="/chairops/write-offs"
            className="text-sm font-medium text-zinc-600 hover:underline"
          >
            ตัดเงินขาด
          </Link>
          <span className="text-zinc-300">/</span>
          <span className="text-sm font-semibold text-foreground">ประวัติการอนุมัติ</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {session.user.displayName} · {session.user.role}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              ประวัติการอนุมัติตัดเงินขาด
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              ทุกการอนุมัติ/ปฏิเสธ พร้อม ใครอนุมัติ · เมื่อไหร่ · ยอด · เหตุผล ·
              ป้าย “อนุมัติเอง” เมื่อผู้ขอ = ผู้อนุมัติ
            </p>
          </div>
          <Link
            href="/chairops/write-offs"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            ← กลับไปคำขอที่รออนุมัติ
          </Link>
        </div>

        {/* summary */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <p className="text-[11px] font-semibold text-zinc-500">รายการทั้งหมด</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-zinc-900">
              {decorated.length}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-[11px] font-semibold text-emerald-700">ยอดที่อนุมัติรวม</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-emerald-800">
              {baht(approvedTotal)}
            </p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
            <p className="text-[11px] font-semibold text-rose-700">ปฏิเสธ</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-rose-800">
              {rejectedCount}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-[11px] font-semibold text-amber-700">อนุมัติเอง</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-amber-800">
              {selfCount}
            </p>
          </div>
        </div>

        {/* filters — GET form (server-first, no JS) */}
        <form
          method="GET"
          className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-3"
        >
          <label className="flex flex-col gap-1">
            <span className={labelCls}>ผล</span>
            <select name="decision" defaultValue={decision} className={inputCls}>
              <option value="ALL">ทั้งหมด</option>
              <option value="APPROVED">อนุมัติแล้ว</option>
              <option value="REJECTED">ปฏิเสธ</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>สาขา</span>
            <select name="branch" defaultValue={branchVal} className={inputCls}>
              <option value="">ทุกสาขา</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>ผู้อนุมัติ</span>
            <select name="approver" defaultValue={approverVal} className={inputCls}>
              <option value="">ทุกคน</option>
              {approverUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} · {u.role}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>ตั้งแต่วันที่</span>
            <input type="date" name="from" defaultValue={fromVal} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>ถึงวันที่</span>
            <input type="date" name="to" defaultValue={toVal} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>ยอดต่ำสุด</span>
            <input
              type="number"
              name="amountMin"
              defaultValue={amountMinVal}
              placeholder="0"
              className={`${inputCls} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>ยอดสูงสุด</span>
            <input
              type="number"
              name="amountMax"
              defaultValue={amountMaxVal}
              placeholder="∞"
              className={`${inputCls} w-24`}
            />
          </label>
          <label className="flex items-center gap-1.5 pb-2">
            <input
              type="checkbox"
              name="self"
              value="1"
              defaultChecked={selfOnly}
              className="size-4 rounded border-zinc-400 text-amber-600 focus:ring-2 focus:ring-amber-500"
            />
            <span className="text-sm text-zinc-700">เฉพาะ “อนุมัติเอง”</span>
          </label>
          <div className="flex items-center gap-2 pb-0.5">
            <button
              type="submit"
              className="h-9 rounded-md border border-zinc-900 bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
            >
              กรอง
            </button>
            <Link
              href="/chairops/write-offs/history"
              className="h-9 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium leading-9 text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              ล้าง
            </Link>
          </div>
        </form>

        {/* table */}
        <div className="max-h-[68vh] overflow-auto rounded-xl border border-zinc-200 bg-white">
          <table className="min-w-[920px] w-full text-sm">
            <thead className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700">
              <tr className="bg-zinc-50 text-left [&>th]:bg-zinc-50">
                <th className="px-3 py-2.5">วันเวลาที่ตัดสิน</th>
                <th className="px-2 py-2.5">สาขา</th>
                <th className="px-2 py-2.5 text-right">ยอด</th>
                <th className="px-2 py-2.5">ผู้ขอ</th>
                <th className="px-2 py-2.5">ผู้อนุมัติ</th>
                <th className="px-2 py-2.5">ผล</th>
                <th className="px-2 py-2.5">เหตุผล · หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {decorated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-sm text-zinc-500">
                    ไม่มีรายการตามเงื่อนไขที่กรอง
                  </td>
                </tr>
              ) : (
                decorated.map((w) => (
                  <tr key={w.id} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-zinc-700">
                      {w.approverAt ? thaiDateTime(w.approverAt) : "—"}
                    </td>
                    <td className="px-2 py-2 align-top text-sm font-medium text-zinc-900">
                      {branchMap.get(w.branchId) ?? w.branchId.slice(0, 8)}
                    </td>
                    <td className="px-2 py-2 align-top text-right font-semibold tabular-nums text-zinc-900">
                      {baht(w.amount)}
                    </td>
                    <td className="px-2 py-2 align-top text-xs text-zinc-700">
                      {w.maker.displayName} · {w.maker.role}
                    </td>
                    <td className="px-2 py-2 align-top text-xs text-zinc-700">
                      {w.approver?.displayName ?? "—"}
                      {w.approver ? ` · ${w.approver.role}` : ""}
                      {w.selfApproved && (
                        <span className="ml-1 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-200">
                          อนุมัติเอง
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <StatusPill
                        tone={w.status === "APPROVED" ? "success" : "danger"}
                        size="xs"
                      >
                        {w.status === "APPROVED" ? "อนุมัติแล้ว" : "ปฏิเสธ"}
                      </StatusPill>
                    </td>
                    <td className="max-w-[280px] px-2 py-2 align-top text-xs text-zinc-600">
                      <div className="line-clamp-2">{w.reason}</div>
                      {w.notes && (
                        <div className="mt-0.5 italic text-zinc-500">
                          &ldquo;{w.notes}&rdquo;
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {decorated.length >= 500 && (
          <p className="mt-2 text-xs text-amber-700">
            ⚠️ แสดงสูงสุด 500 รายการ — กรองให้แคบลง (เลือกช่วงวันที่/สาขา) เพื่อดูครบ
          </p>
        )}
      </div>
    </div>
  );
}
