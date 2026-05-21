// /repairs/recurring — Recurring failure report
// "Pumps that fail every 30 days never get capex-replaced." (BA insight)
// Groups closed/resolved tickets by (branch, category) over a window and shows
// repeat offenders so CEO can flag for replacement instead of repeated repair.
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { prisma } from "@/lib/prisma";
import { formatBaht, downtimeCostBaht } from "@/lib/repair/types";
import { AlertTriangle, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

interface Search { days?: string }

export default async function RecurringFailurePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const params = await searchParams;
  const days = Math.max(7, Math.min(365, parseInt(params.days ?? "90", 10)));
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const tickets = await prisma.repairTicket.findMany({
    where: {
      orgId: session.user.org_id,
      createdAt: { gte: since },
      branchId: { not: null },
      categoryId: { not: null },
    },
    select: {
      id: true,
      ticketCode: true,
      title: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      partsCostCents: true,
      laborCostCents: true,
      branch: { select: { id: true, code: true, name: true, businessType: true } },
      category: { select: { id: true, label: true, emoji: true } },
    },
  });

  // Group by (branchId, categoryId)
  type Row = {
    key: string;
    branchId: string;
    branchCode: string;
    branchName: string;
    businessType: string;
    categoryId: string;
    categoryLabel: string;
    categoryEmoji: string | null;
    tickets: typeof tickets;
    totalCostCents: number;
    downtimeBaht: number;
  };
  const map = new Map<string, Row>();
  for (const t of tickets) {
    if (!t.branch || !t.category) continue;
    const key = `${t.branch.id}|${t.category.id}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        branchId: t.branch.id,
        branchCode: t.branch.code,
        branchName: t.branch.name,
        businessType: t.branch.businessType as string,
        categoryId: t.category.id,
        categoryLabel: t.category.label,
        categoryEmoji: t.category.emoji,
        tickets: [],
        totalCostCents: 0,
        downtimeBaht: 0,
      });
    }
    const row = map.get(key)!;
    row.tickets.push(t);
    row.totalCostCents += t.partsCostCents + t.laborCostCents;
    row.downtimeBaht += downtimeCostBaht({
      businessType: t.branch.businessType as string,
      startedAt: t.createdAt,
      endedAt: t.resolvedAt,
    });
  }

  const offenders = Array.from(map.values())
    .filter((r) => r.tickets.length >= 2)
    .sort((a, b) => b.tickets.length - a.tickets.length);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 flex items-center gap-2">
          <AlertTriangle className="size-7 text-amber-600" />
          ของพังซ้ำ
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          สาขา + หมวด ที่ซ่อมซ้ำ ≥ 2 ครั้ง ใน {days} วันที่ผ่านมา · แทนที่จะซ่อม ลองเปลี่ยนของใหม่อาจคุ้มกว่า
        </p>
        <div className="mt-3 flex gap-1.5">
          {[30, 60, 90, 180, 365].map((d) => (
            <Link
              key={d}
              href={`/repairs/recurring?days=${d}`}
              className={`h-8 px-3 inline-flex items-center rounded-lg text-xs font-bold border ${
                days === d
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400"
              }`}
            >
              {d} วัน
            </Link>
          ))}
        </div>
      </header>

      {offenders.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-10 text-center">
          <p className="text-2xl">✅</p>
          <p className="mt-3 font-extrabold text-emerald-900">ไม่มีของพังซ้ำใน {days} วัน</p>
          <p className="text-sm text-emerald-700 mt-1">เครื่องยนต์ของบริษัทเสถียรดี</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-14 sm:top-16 z-20 bg-zinc-50 border-b border-zinc-200">
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2 font-bold">สาขา · หมวด</th>
                <th className="px-3 py-2 font-bold text-right">ครั้งที่ซ่อม</th>
                <th className="px-3 py-2 font-bold text-right">ค่าซ่อมรวม</th>
                <th className="px-3 py-2 font-bold text-right">ค่าเสียโอกาสรวม</th>
                <th className="px-3 py-2 font-bold">ใบล่าสุด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {offenders.map((row) => (
                <tr key={row.key} className="hover:bg-zinc-50">
                  <td className="px-3 py-3">
                    <p className="font-bold text-zinc-900">
                      <span className="mr-1">{row.categoryEmoji ?? "🛠"}</span>
                      {row.categoryLabel}
                    </p>
                    <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="size-3" />
                      {row.branchCode} · {row.branchName}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`inline-flex items-center px-2 h-7 rounded font-extrabold text-base tabular-num ${
                      row.tickets.length >= 5
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : row.tickets.length >= 3
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-zinc-100 text-zinc-700"
                    }`}>
                      {row.tickets.length} ครั้ง
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-num font-medium">
                    {formatBaht(row.totalCostCents)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-num font-medium text-red-700">
                    {formatBaht(row.downtimeBaht * 100)}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <Link
                      href={`/repairs/${row.tickets[0].id}`}
                      className="font-bold text-[var(--color-brand-700)] hover:underline"
                    >
                      {row.tickets[0].ticketCode}
                    </Link>
                    <span className="text-zinc-400 ml-1">
                      ·{" "}
                      {new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(
                        row.tickets[0].createdAt,
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
