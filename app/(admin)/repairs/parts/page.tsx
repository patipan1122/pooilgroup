// /repairs/parts — Purchasing queue (aggregated parts across tickets)
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { partsQueue } from "@/lib/repair/queries";
import { PART_STATUS_LABELS, PART_STATUS_COLORS, URGENCY_LABELS, URGENCY_COLORS, formatBaht } from "@/lib/repair/types";
import { PartStatusButtons } from "@/components/repair/ticket-actions";
import { PackageSearch } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RepairPartsPage() {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const { rawParts, groups } = await partsQueue(session.user.org_id);

  const totalCost = rawParts.reduce((s, p) => s + p.quantity * p.unitPriceCents, 0);

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 flex items-center gap-2">
          <PackageSearch className="size-7" />
          อะไหล่ที่ต้องสั่ง
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          รวมอะไหล่ข้ามใบ · จัดซื้อใช้รายการนี้สั่งของได้ทีเดียว
        </p>
      </header>

      {/* Summary — รอสั่งโผล่ขึ้นก่อน (สิ่งที่ต้องลงมือทำที่สุด) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
        <div className="bg-white rounded-xl border border-amber-200 p-3">
          <p className="text-xs font-bold text-amber-700">รอสั่ง</p>
          <p className="text-2xl font-extrabold text-amber-700 tabular-num">
            {rawParts.filter((p) => p.status === "NEEDED").length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          <p className="text-xs font-bold text-zinc-500">สั่งแล้ว</p>
          <p className="text-2xl font-extrabold text-blue-700 tabular-num">
            {rawParts.filter((p) => p.status === "ORDERED").length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          <p className="text-xs font-bold text-zinc-500">รายการรวม</p>
          <p className="text-2xl font-extrabold text-zinc-900 tabular-num">{groups.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          <p className="text-xs font-bold text-zinc-500">มูลค่ารวม</p>
          <p className="text-lg font-extrabold text-zinc-900">{formatBaht(totalCost)}</p>
        </div>
      </div>

      {/* Aggregated buy-list */}
      <section className="bg-white rounded-xl border border-zinc-200 overflow-hidden mb-6">
        <header className="px-4 h-12 flex items-center justify-between border-b border-zinc-200 bg-zinc-50">
          <p className="font-bold text-zinc-900 text-sm">รายการอะไหล่ที่ต้องสั่ง (รวม)</p>
        </header>
        {groups.length === 0 ? (
          <div className="p-8 text-center">
            <PackageSearch className="size-10 mx-auto text-zinc-300" />
            <p className="mt-3 text-sm font-bold text-zinc-700">ยังไม่มีอะไหล่ที่ต้องสั่ง</p>
            <p className="mt-1 text-xs text-zinc-500">เพิ่มอะไหล่จากหน้าใบแจ้งซ่อมแต่ละใบ</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-14 sm:top-16 z-20 bg-zinc-50 border-b border-zinc-200">
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2 font-bold">อะไหล่</th>
                <th className="px-3 py-2 font-bold text-right">จำนวนรวม</th>
                <th className="px-3 py-2 font-bold">รอสั่ง / สั่งแล้ว / ของถึง</th>
                <th className="px-3 py-2 font-bold text-right">ใบที่เกี่ยวข้อง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {groups.map((g) => (
                <tr key={g.key}>
                  <td className="px-3 py-2">
                    <p className="font-bold text-zinc-900">{g.name}</p>
                    {g.spec && <p className="text-xs text-zinc-500">{g.spec}</p>}
                  </td>
                  <td className="px-3 py-2 text-right font-extrabold text-lg">{g.totalQty}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {g.statusBreakdown.NEEDED > 0 && (
                        <span className="px-1.5 h-6 inline-flex items-center rounded text-xs font-bold border bg-amber-50 text-amber-700 border-amber-200">
                          รอสั่ง {g.statusBreakdown.NEEDED}
                        </span>
                      )}
                      {g.statusBreakdown.ORDERED > 0 && (
                        <span className="px-1.5 h-6 inline-flex items-center rounded text-xs font-bold border bg-blue-50 text-blue-700 border-blue-200">
                          สั่งแล้ว {g.statusBreakdown.ORDERED}
                        </span>
                      )}
                      {g.statusBreakdown.DELIVERED > 0 && (
                        <span className="px-1.5 h-6 inline-flex items-center rounded text-xs font-bold border bg-violet-50 text-violet-700 border-violet-200">
                          ของถึง {g.statusBreakdown.DELIVERED}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-600">
                    {g.items.length} ใบ
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Per-part rows with action buttons */}
      <section className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <header className="px-4 h-12 flex items-center justify-between border-b border-zinc-200 bg-zinc-50">
          <p className="font-bold text-zinc-900 text-sm">รายการแยกตามใบ</p>
        </header>
        {rawParts.length === 0 ? (
          <div className="p-8 text-center">
            <PackageSearch className="size-10 mx-auto text-zinc-300" />
            <p className="mt-3 text-sm font-bold text-zinc-700">ไม่มีรายการ</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {rawParts.map((p) => (
              <li key={p.id} className="p-3 sm:p-4 flex flex-wrap gap-3 items-center">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-zinc-900">{p.name}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                    {p.spec && <span>{p.spec}</span>}
                    <span>×{p.quantity} {p.unit}</span>
                    <span>{formatBaht(p.unitPriceCents)}/หน่วย</span>
                    {p.ticket.branch && <span>· {p.ticket.branch.code}</span>}
                  </div>
                  <Link
                    href={`/repairs/${p.ticket.id}`}
                    className="mt-1 text-xs font-bold text-[var(--color-brand-700)] hover:underline inline-block"
                  >
                    {p.ticket.ticketCode} · {p.ticket.title}
                  </Link>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 h-6 rounded text-xs font-bold border ${PART_STATUS_COLORS[p.status]}`}>
                    {PART_STATUS_LABELS[p.status]}
                  </span>
                  <span className={`inline-flex items-center px-1.5 h-6 rounded text-xs font-bold border ${URGENCY_COLORS[p.ticket.urgency]}`}>
                    {URGENCY_LABELS[p.ticket.urgency]}
                  </span>
                  <PartStatusButtons partId={p.id} current={p.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
