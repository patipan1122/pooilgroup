// /repairs/parts — Purchasing queue (aggregated parts across tickets) · Pooil App redesign
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { partsQueue } from "@/lib/repair/queries";
import {
  PART_STATUS_LABELS,
  PART_STATUS_COLORS,
  URGENCY_LABELS,
  URGENCY_COLORS,
  formatBaht,
} from "@/lib/repair/types";
import { PartStatusButtons } from "@/components/repair/ticket-actions";
import { PackageSearch, ShoppingCart, Truck, AlertCircle, Receipt } from "lucide-react";
import { RepairSubHeader } from "@/components/repair/sub-header";

export const dynamic = "force-dynamic";

const STATUS_DOT: Record<string, string> = {
  NEEDED: "bg-amber-500",
  ORDERED: "bg-blue-500",
  DELIVERED: "bg-violet-500",
  INSTALLED: "bg-emerald-500",
  CANCELLED: "bg-zinc-400",
};

export default async function RepairPartsPage() {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const { rawParts, groups } = await partsQueue(session.user.org_id);

  const totalCost = rawParts.reduce((s, p) => s + p.quantity * p.unitPriceCents, 0);
  const countNeeded = rawParts.filter((p) => p.status === "NEEDED").length;
  const countOrdered = rawParts.filter((p) => p.status === "ORDERED").length;
  const countDelivered = rawParts.filter((p) => p.status === "DELIVERED").length;
  const totalQty = rawParts.reduce((s, p) => s + p.quantity, 0);

  // group by supplier (consolidation hint)
  const bySupplier = new Map<string, number>();
  for (const p of rawParts) {
    if (p.status === "NEEDED" && p.supplier) {
      bySupplier.set(p.supplier, (bySupplier.get(p.supplier) ?? 0) + 1);
    }
  }
  const consolidate = Array.from(bySupplier.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);

  return (
    <>
      <RepairSubHeader
        icon={PackageSearch}
        eyebrow="Resources · Parts"
        title="อะไหล่ที่ต้องสั่ง"
        subtitle={`รวมอะไหล่ข้ามใบ · จัดซื้อใช้รายการนี้สั่งของได้ทีเดียว · ${rawParts.length} รายการ · ${totalQty} ชิ้น`}
        stats={[
          { label: "รอสั่ง", value: countNeeded, tone: countNeeded > 0 ? "warn" : "default" },
          { label: "สั่งแล้ว", value: countOrdered },
          { label: "กำลังส่ง", value: countDelivered },
          { label: "มูลค่ารวม", value: formatBaht(totalCost), tone: "success" },
          { label: "รายการรวม", value: groups.length },
        ]}
        actions={
          <Link
            href="/repairs/triage"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-zinc-700 font-semibold text-xs hover:bg-zinc-50"
          >
            ดูใบใน Triage
          </Link>
        }
      />

      <div className="p-3 sm:p-5 lg:p-6 max-w-[1400px] mx-auto space-y-4">
        {/* Consolidation hint */}
        {consolidate.length > 0 && (
          <div className="bg-white border border-blue-200 rounded-xl p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-blue-50 text-blue-700 grid place-items-center shrink-0">
              <ShoppingCart className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-bold text-zinc-900">รวมสั่งซื้อ ประหยัดค่าส่งได้</div>
              <div className="text-[11.5px] text-zinc-500 mt-0.5">
                vendor ที่มี ≥ 2 รายการรอสั่ง: {consolidate.map(([s, n]) => `${s} (${n})`).join(" · ")}
              </div>
            </div>
            <button
              type="button"
              className="text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 h-9 rounded-lg"
            >
              จัดกลุ่มสั่ง
            </button>
          </div>
        )}

        {/* Aggregated buy-list */}
        <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center gap-2 bg-zinc-50">
            <PackageSearch className="size-3.5 text-zinc-500" />
            <p className="text-[12.5px] font-bold text-zinc-900">รวมต่ออะไหล่ (จัดซื้อใช้ตัวนี้)</p>
            <span className="text-[11px] text-zinc-500 ml-2">{groups.length} รายการ</span>
          </div>
          {groups.length === 0 ? (
            <div className="p-10 text-center">
              <PackageSearch className="size-10 mx-auto text-zinc-300" />
              <p className="mt-2 text-sm font-semibold text-zinc-700">ยังไม่มีอะไหล่ที่ต้องสั่ง</p>
              <p className="mt-1 text-xs text-zinc-500">
                เพิ่มอะไหล่จากหน้าใบแจ้งซ่อม → เลือก &quot;เพิ่มอะไหล่&quot;
              </p>
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-500 border-b border-zinc-100">
                  <th className="px-4 py-2 font-bold">อะไหล่</th>
                  <th className="px-4 py-2 font-bold text-right">จำนวนรวม</th>
                  <th className="px-4 py-2 font-bold">รอสั่ง / สั่งแล้ว / ของถึง</th>
                  <th className="px-4 py-2 font-bold text-right">ใบที่เกี่ยว</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {groups.map((g) => (
                  <tr key={g.key} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-zinc-900">{g.name}</p>
                      {g.spec && (
                        <p className="text-[11px] text-zinc-500 font-mono">{g.spec}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-zinc-900">
                      {g.totalQty}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {g.statusBreakdown.NEEDED > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-px rounded border bg-amber-50 text-amber-700 border-amber-200">
                            <span className="size-1.5 rounded-full bg-amber-500" />
                            รอสั่ง {g.statusBreakdown.NEEDED}
                          </span>
                        )}
                        {g.statusBreakdown.ORDERED > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-px rounded border bg-blue-50 text-blue-700 border-blue-200">
                            <span className="size-1.5 rounded-full bg-blue-500" />
                            สั่งแล้ว {g.statusBreakdown.ORDERED}
                          </span>
                        )}
                        {g.statusBreakdown.DELIVERED > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-px rounded border bg-violet-50 text-violet-700 border-violet-200">
                            <span className="size-1.5 rounded-full bg-violet-500" />
                            กำลังส่ง {g.statusBreakdown.DELIVERED}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[11px] text-zinc-500 tabular-nums">
                      {g.items.length} ใบ
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Per-part rows with action buttons */}
        <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center gap-2 bg-zinc-50">
            <Receipt className="size-3.5 text-zinc-500" />
            <p className="text-[12.5px] font-bold text-zinc-900">รายการแยกตามใบ</p>
            <span className="text-[11px] text-zinc-500 ml-2">{rawParts.length} รายการ</span>
          </div>
          {rawParts.length === 0 ? (
            <div className="p-8 text-center">
              <PackageSearch className="size-10 mx-auto text-zinc-300" />
              <p className="mt-3 text-sm font-bold text-zinc-700">ไม่มีรายการ</p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {rawParts.map((p) => (
                <li key={p.id} className="p-3 sm:p-4 flex flex-wrap gap-3 items-center hover:bg-zinc-50/50">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900">{p.name}</p>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                      {p.spec && <span className="font-mono">{p.spec}</span>}
                      <span className="tabular-nums">
                        ×{p.quantity} {p.unit}
                      </span>
                      <span className="tabular-nums">{formatBaht(p.unitPriceCents)}/หน่วย</span>
                      {p.supplier && (
                        <span className="inline-flex items-center gap-0.5">
                          <Truck className="size-3" />
                          {p.supplier}
                        </span>
                      )}
                      {p.ticket.branch && (
                        <span className="font-mono font-semibold text-zinc-700">
                          {p.ticket.branch.code}
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/repairs/${p.ticket.id}`}
                      className="mt-1.5 text-[11.5px] font-semibold text-blue-700 hover:text-blue-900 inline-block"
                    >
                      <span className="font-mono">{p.ticket.ticketCode}</span> ·{" "}
                      {p.ticket.title}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10.5px] font-bold ${PART_STATUS_COLORS[p.status]}`}
                    >
                      <span className={`size-1.5 rounded-full ${STATUS_DOT[p.status]}`} />
                      {PART_STATUS_LABELS[p.status]}
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10.5px] font-bold ${URGENCY_COLORS[p.ticket.urgency]}`}
                    >
                      {URGENCY_LABELS[p.ticket.urgency]}
                    </span>
                    <PartStatusButtons partId={p.id} current={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Footer help */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-[11.5px] text-zinc-600 leading-relaxed flex gap-3">
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-zinc-500" />
          <div>
            <span className="font-bold text-zinc-900">วิธีใช้:</span>{" "}
            กดปุ่ม &quot;สั่งของ&quot; เมื่อสั่งซื้อแล้ว · กด &quot;ของถึง&quot;
            เมื่อรับของแล้ว · กด &quot;ติดตั้ง&quot; เมื่อช่างใช้แล้ว ระบบจะอัปเดต
            timeline ใบนั้นอัตโนมัติ
          </div>
        </div>
      </div>
    </>
  );
}
