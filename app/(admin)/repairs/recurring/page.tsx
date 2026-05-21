// /repairs/recurring — Recurring failure report (Pooil App redesign)
// "Pumps that fail every 30 days never get capex-replaced." (BA insight)
// Groups closed/resolved tickets by (branch, category) over a window and shows
// repeat offenders so CEO can flag for replacement instead of repeated repair.
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { prisma } from "@/lib/prisma";
import { formatBaht, downtimeCostBaht } from "@/lib/repair/types";
import { AlertTriangle, MapPin, ChevronRight, TrendingUp } from "lucide-react";
import { RepairSubHeader } from "@/components/repair/sub-header";

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

  const totalSpent = offenders.reduce((s, r) => s + r.totalCostCents, 0);
  const totalDowntime = offenders.reduce((s, r) => s + r.downtimeBaht * 100, 0);

  return (
    <>
      <RepairSubHeader
        icon={AlertTriangle}
        eyebrow="Insights · Recurring failures"
        title="ของพังซ้ำ"
        subtitle={`สาขา + หมวด ที่ซ่อมซ้ำ ≥ 2 ครั้ง ใน ${days} วันที่ผ่านมา · แทนที่จะซ่อมซ้ำ ลองเปลี่ยนของใหม่อาจคุ้มกว่า`}
        stats={[
          { label: "จุดที่ซ้ำ", value: offenders.length, tone: offenders.length > 0 ? "warn" : "default" },
          { label: "ค่าซ่อมรวม", value: formatBaht(totalSpent) },
          { label: "ค่าเสียโอกาส", value: formatBaht(totalDowntime), tone: "danger" },
        ]}
        actions={
          <div className="flex gap-1">
            {[30, 60, 90, 180, 365].map((d) => (
              <Link
                key={d}
                href={`/repairs/recurring?days=${d}`}
                className={`h-8 px-2.5 inline-flex items-center rounded text-[11.5px] font-semibold border ${
                  days === d
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                {d} วัน
              </Link>
            ))}
          </div>
        }
      />

      <div className="p-3 sm:p-5 lg:p-6 max-w-[1200px] mx-auto">
        {offenders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-emerald-300 p-12 text-center">
            <div className="size-16 mx-auto rounded-full bg-emerald-50 grid place-items-center text-emerald-600">
              <TrendingUp className="size-7" />
            </div>
            <p className="mt-4 font-bold text-zinc-900 text-lg">ไม่มีของพังซ้ำใน {days} วัน</p>
            <p className="text-sm text-zinc-500 mt-1">
              เครื่องยนต์/อุปกรณ์ของทุกสาขาเสถียร · ไม่ต้องห่วง capex
            </p>
          </div>
        ) : (
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-500 border-b border-zinc-100 bg-zinc-50">
                  <th className="px-4 py-2.5 font-bold">สาขา · หมวด</th>
                  <th className="px-4 py-2.5 font-bold text-right">ครั้งที่ซ่อม</th>
                  <th className="px-4 py-2.5 font-bold text-right">ค่าซ่อมรวม</th>
                  <th className="px-4 py-2.5 font-bold text-right">ค่าเสียโอกาส</th>
                  <th className="px-4 py-2.5 font-bold">ใบล่าสุด</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {offenders.map((row) => (
                  <tr key={row.key} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-zinc-900 flex items-center gap-1.5">
                        <span className="text-lg">{row.categoryEmoji ?? "🛠"}</span>
                        {row.categoryLabel}
                      </p>
                      <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="size-3" />
                        <span className="font-mono font-bold text-zinc-700">{row.branchCode}</span>
                        {row.branchName}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded font-bold text-[14px] tabular-nums border ${
                          row.tickets.length >= 5
                            ? "bg-red-50 text-red-700 border-red-200"
                            : row.tickets.length >= 3
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-zinc-100 text-zinc-700 border-zinc-200"
                        }`}
                      >
                        {row.tickets.length}
                        <span className="ml-1 text-[10px] font-medium opacity-80">ครั้ง</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-900">
                      {formatBaht(row.totalCostCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-red-700">
                      {formatBaht(row.downtimeBaht * 100)}
                    </td>
                    <td className="px-4 py-3 text-[11.5px]">
                      <Link
                        href={`/repairs/${row.tickets[0].id}`}
                        className="font-mono font-semibold text-blue-700 hover:text-blue-900"
                      >
                        {row.tickets[0].ticketCode}
                      </Link>
                      <span className="text-zinc-400 ml-1">
                        ·{" "}
                        {new Intl.DateTimeFormat("th-TH", {
                          day: "numeric",
                          month: "short",
                        }).format(row.tickets[0].createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/repairs/triage?branch=${row.branchId}&category=${row.categoryId}`}
                        className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold text-blue-700 hover:text-blue-900"
                      >
                        ดูใบทั้งหมด <ChevronRight className="size-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
