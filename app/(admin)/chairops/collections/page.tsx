// Admin · ประวัติเก็บเงิน (cross-maid · cross-branch)
//
// Replaces the broken "/chairops/collect" nav entry that previously redirected
// admins into the MAID-only PWA layout (which 403'd). Admins now land here
// to see ALL maid collections with date-range + branch filters.
//
// Defense-in-depth: layout already gates module entitlement · we require
// OFFICE+ here (admins/managers/office) to ensure no MAID account opens this.

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { ChairopsKpiTile } from "@/components/chairops/_kit";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { baht, thaiDateTime, thaiDate } from "@/lib/chairops/utils/format";
import { Banknote, Coins, ListChecks, Users } from "lucide-react";

export const dynamic = "force-dynamic";

type SP = {
  from?: string;
  to?: string;
  branch?: string;
  maid?: string;
};

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

export default async function AdminCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireRole("OFFICE");
  const sp = await searchParams;

  // Default window: this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const from = parseDate(sp.from, monthStart);
  const to = parseDate(sp.to, tomorrow);

  const where = {
    collectedAt: { gte: from, lt: to },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.maid ? { maidId: sp.maid } : {}),
  };

  // Wave-2 audit P0 #6: deposits now live on chairops_cash_deposit (separate
  // table linked by depositId · legacy collection.depositedAmount = 0 for
  // post-W2 rows). Aggregate the new table for KPIs + join via include for
  // per-row display. ChairopsCashDeposit has branchId/maidId directly, so we
  // mirror the same filters · timestamp lives on depositedAt.
  const depositWhere = {
    depositedAt: { gte: from, lt: to },
    ...(sp.branch ? { branchId: sp.branch } : {}),
    ...(sp.maid ? { maidId: sp.maid } : {}),
  };

  const [rows, agg, depositAgg, branches, maids] = await Promise.all([
    prisma.chairopsCashCollection.findMany({
      where,
      orderBy: { collectedAt: "desc" },
      take: 500,
      select: {
        id: true,
        collectedAt: true,
        countedAmount: true,
        depositedAmount: true,
        notes: true,
        branch: { select: { id: true, name: true, slug: true } },
        // Wave-2 B2: include role to label "(แทน)" when office tier collected.
        maid: { select: { id: true, displayName: true, role: true } },
        deposit: { select: { depositedAmount: true, bankFee: true } },
      },
    }),
    prisma.chairopsCashCollection.aggregate({
      where,
      _sum: { countedAmount: true, depositedAmount: true },
      _count: true,
    }),
    prisma.chairopsCashDeposit.aggregate({
      where: depositWhere,
      _sum: { depositedAmount: true, bankFee: true },
    }),
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.chairopsUser.findMany({
      where: { role: "MAID", isActive: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
  ]);

  const totalCounted = Number(agg._sum.countedAmount ?? 0);
  const legacyDeposited = Number(agg._sum.depositedAmount ?? 0);
  const newDeposited =
    Number(depositAgg._sum?.depositedAmount ?? 0) +
    Number(depositAgg._sum?.bankFee ?? 0);
  const totalDeposited = legacyDeposited + newDeposited;
  const totalDiff = totalCounted - totalDeposited;
  const activeMaidIds = new Set(rows.map((r) => r.maid?.id).filter(Boolean));

  const fromIso = from.toISOString().slice(0, 10);
  const toIso = new Date(to.getTime() - 86400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          ประวัติเก็บเงิน
        </h1>
        <p className="text-sm text-zinc-600">
          ทุกรอบเก็บเงินจากแม่บ้านทุกสาขา · กรองตามช่วงวันที่ · สาขา · แม่บ้าน
        </p>
      </header>

      {/* Filter bar */}
      <form
        method="GET"
        className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-4"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
          จากวันที่
          <input
            type="date"
            name="from"
            defaultValue={fromIso}
            className="h-9 rounded-md border border-zinc-300 px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={toIso}
            className="h-9 rounded-md border border-zinc-300 px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
          สาขา
          <select
            name="branch"
            defaultValue={sp.branch ?? ""}
            className="h-9 rounded-md border border-zinc-300 px-2 text-sm"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
          แม่บ้าน
          <select
            name="maid"
            defaultValue={sp.maid ?? ""}
            className="h-9 rounded-md border border-zinc-300 px-2 text-sm"
          >
            <option value="">ทุกคน</option>
            {maids.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-2 flex items-center gap-2 sm:col-span-4">
          <button
            type="submit"
            className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            กรอง
          </button>
          <Link
            href="/chairops/collections"
            className="h-9 inline-flex items-center rounded-md border border-zinc-300 px-3 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            ล้างตัวกรอง
          </Link>
        </div>
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ChairopsKpiTile
          label="รวมจำนวนรอบ"
          value={agg._count.toLocaleString("en-US")}
          tone="neutral"
          icon={<ListChecks className="size-4" aria-hidden />}
        />
        <ChairopsKpiTile
          label="ยอดนับรวม"
          value={baht(totalCounted)}
          tone="neutral"
          icon={<Coins className="size-4" aria-hidden />}
        />
        <ChairopsKpiTile
          label="ยอดฝากรวม"
          value={baht(totalDeposited)}
          tone="success"
          icon={<Banknote className="size-4" aria-hidden />}
        />
        <ChairopsKpiTile
          label={totalDiff >= 0 ? "ขาดสะสมในช่วง" : "เกินสะสมในช่วง"}
          value={baht(Math.abs(totalDiff), true)}
          tone={totalDiff > 0 ? "danger" : totalDiff < 0 ? "warning" : "success"}
          icon={<Users className="size-4" aria-hidden />}
          delta={`${activeMaidIds.size} แม่บ้านเก็บ`}
        />
      </div>

      {/* Table */}
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-zinc-200 bg-white [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300">
        <table className="min-w-[880px] w-full text-sm">
          <thead className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700 shadow-[0_1px_0_rgb(228_228_231)]">
            <tr className="bg-zinc-50 text-left [&>th]:bg-zinc-50">
              <th className="px-3 py-2.5">เวลา</th>
              <th className="px-3 py-2.5">สาขา</th>
              <th className="px-3 py-2.5">แม่บ้าน</th>
              <th className="px-3 py-2.5 text-right">นับได้</th>
              <th className="px-3 py-2.5 text-right">ฝาก</th>
              <th className="px-3 py-2.5 text-right">ส่วนต่าง</th>
              <th className="px-3 py-2.5">โน้ต</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-zinc-500">
                  ยังไม่มีรายการในช่วงนี้
                  <div className="mt-1 text-xs text-zinc-400">
                    {thaiDate(from)} – {thaiDate(new Date(to.getTime() - 86400_000))}
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                // Wave-2: prefer new cash_deposit row; fallback to legacy column.
                const rowDeposited = r.deposit
                  ? Number(r.deposit.depositedAmount) + Number(r.deposit.bankFee)
                  : Number(r.depositedAmount);
                const diff = Number(r.countedAmount) - rowDeposited;
                const notDepositedYet = !r.deposit && Number(r.depositedAmount) === 0;
                const diffTone: "danger" | "warning" | "success" | "neutral" =
                  notDepositedYet ? "neutral" : diff > 0 ? "danger" : diff < 0 ? "warning" : "neutral";
                const diffText = notDepositedYet
                  ? "รอฝาก"
                  : diff === 0
                    ? "ตรง"
                    : baht(diff, true);
                return (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50">
                    <td className="px-3 py-2.5 whitespace-nowrap text-zinc-700">{thaiDateTime(r.collectedAt)}</td>
                    <td className="px-3 py-2.5 text-zinc-700">
                      {r.branch?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-700">
                      {r.maid
                        ? r.maid.role && r.maid.role !== "MAID"
                          ? `${r.maid.displayName} (แทน)`
                          : r.maid.displayName
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{baht(Number(r.countedAmount))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {notDepositedYet ? "—" : baht(rowDeposited)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <Badge tone={diffTone}>{diffText}</Badge>
                    </td>
                    <td className="px-3 py-2.5 max-w-[280px] truncate text-xs text-zinc-500">
                      {r.notes ?? ""}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/chairops/m/collect/${r.id}`}
                        className="text-xs font-medium text-zinc-700 underline-offset-2 hover:underline"
                      >
                        ดู
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length === 500 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardBody className="p-3 text-xs text-amber-800">
            แสดงสูงสุด 500 แถวล่าสุด · ลดช่วงวันที่หรือกรองตามสาขา/แม่บ้านเพื่อดูผลที่แม่นยำกว่า
          </CardBody>
        </Card>
      )}
    </div>
  );
}
