// /repairs/parts — Pooil App parts queue · .panel + .dtable + .pill
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { partsQueue } from "@/lib/repair/queries";
import {
  PART_STATUS_LABELS,
  URGENCY_LABELS,
  formatBaht,
} from "@/lib/repair/types";
import { PartStatusButtons } from "@/components/repair/ticket-actions";
import { PackageSearch, ShoppingCart, Truck, AlertCircle, Receipt } from "lucide-react";
import { RepairSubHeader } from "@/components/repair/sub-header";

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  NEEDED: "pill-approval",
  ORDERED: "pill-new",
  DELIVERED: "pill-assess",
  INSTALLED: "pill-done",
  CANCELLED: "pill-low",
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
          <Link href="/repairs/triage" className="btn btn-sm">
            ดูใบใน Triage
          </Link>
        }
      />

      <div className="repair-content" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Consolidation hint */}
        {consolidate.length > 0 && (
          <div className="panel" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "var(--brand-50)", color: "var(--brand-700)",
              display: "grid", placeItems: "center", flexShrink: 0,
            }}>
              <ShoppingCart size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-900)" }}>
                รวมสั่งซื้อ ประหยัดค่าส่งได้
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 1 }}>
                vendor ที่มี ≥ 2 รายการรอสั่ง: {consolidate.map(([s, n]) => `${s} (${n})`).join(" · ")}
              </div>
            </div>
            <button type="button" className="btn btn-primary">
              จัดกลุ่มสั่ง
            </button>
          </div>
        )}

        {/* Aggregated buy-list */}
        <div className="panel">
          <div className="panel-head">
            <PackageSearch size={14} style={{ color: "var(--ink-500)" }} />
            <span className="panel-title">รวมต่ออะไหล่ (จัดซื้อใช้ตัวนี้)</span>
            <span style={{ flex: 1 }} />
            <span className="panel-sub">{groups.length} รายการ</span>
          </div>
          {groups.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center" }}>
              <PackageSearch size={32} style={{ color: "var(--ink-300)" }} />
              <p style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}>
                ยังไม่มีอะไหล่ที่ต้องสั่ง
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th>อะไหล่</th>
                    <th className="num">จำนวนรวม</th>
                    <th>รอสั่ง / สั่งแล้ว / ของถึง</th>
                    <th className="num">ใบที่เกี่ยว</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.key}>
                      <td>
                        <p style={{ fontWeight: 600, color: "var(--ink-900)", margin: 0 }}>{g.name}</p>
                        {g.spec && (
                          <p style={{ fontSize: 10.5, color: "var(--ink-500)", fontFamily: "var(--font-mono)", margin: "1px 0 0" }}>
                            {g.spec}
                          </p>
                        )}
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>{g.totalQty}</td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {g.statusBreakdown.NEEDED > 0 && (
                            <span className="pill pill-approval">รอสั่ง {g.statusBreakdown.NEEDED}</span>
                          )}
                          {g.statusBreakdown.ORDERED > 0 && (
                            <span className="pill pill-new">สั่งแล้ว {g.statusBreakdown.ORDERED}</span>
                          )}
                          {g.statusBreakdown.DELIVERED > 0 && (
                            <span className="pill pill-assess">กำลังส่ง {g.statusBreakdown.DELIVERED}</span>
                          )}
                        </div>
                      </td>
                      <td className="num" style={{ color: "var(--ink-500)" }}>{g.items.length} ใบ</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Per-part rows */}
        <div className="panel">
          <div className="panel-head">
            <Receipt size={14} style={{ color: "var(--ink-500)" }} />
            <span className="panel-title">รายการแยกตามใบ</span>
            <span style={{ flex: 1 }} />
            <span className="panel-sub">{rawParts.length} รายการ</span>
          </div>
          {rawParts.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center" }}>
              <PackageSearch size={32} style={{ color: "var(--ink-300)" }} />
              <p style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}>ไม่มีรายการ</p>
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {rawParts.map((p, i) => (
                <li
                  key={p.id}
                  style={{
                    padding: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
                    borderBottom: i === rawParts.length - 1 ? 0 : "1px solid var(--line-2)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, color: "var(--ink-900)", margin: 0 }}>{p.name}</p>
                    <div style={{
                      display: "flex", flexWrap: "wrap", gap: "0 8px",
                      fontSize: 11, color: "var(--ink-500)", marginTop: 2,
                    }}>
                      {p.spec && <span style={{ fontFamily: "var(--font-mono)" }}>{p.spec}</span>}
                      <span className="num">×{p.quantity} {p.unit}</span>
                      <span className="num">{formatBaht(p.unitPriceCents)}/หน่วย</span>
                      {p.supplier && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <Truck size={10} /> {p.supplier}
                        </span>
                      )}
                      {p.ticket.branch && (
                        <span className="num" style={{ fontWeight: 600, color: "var(--ink-700)" }}>
                          {p.ticket.branch.code}
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/repairs/${p.ticket.id}`}
                      style={{
                        marginTop: 6, display: "inline-block",
                        fontSize: 11.5, color: "var(--brand-700)", fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      <span style={{ fontFamily: "var(--font-mono)" }}>{p.ticket.ticketCode}</span> · {p.ticket.title}
                    </Link>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className={"pill " + STATUS_CLS[p.status]}>
                      <span className="dot" />
                      {PART_STATUS_LABELS[p.status]}
                    </span>
                    <span className={
                      "pill " +
                      (p.ticket.urgency === "URGENT" ? "pill-urgent" :
                       p.ticket.urgency === "NORMAL" ? "pill-normal" : "pill-low")
                    }>
                      {URGENCY_LABELS[p.ticket.urgency]}
                    </span>
                    <PartStatusButtons partId={p.id} current={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          background: "var(--surface-2)", border: "1px solid var(--line)",
          borderRadius: 10, padding: 14,
          display: "flex", gap: 10,
          fontSize: 11.5, color: "var(--ink-600)", lineHeight: 1.5,
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0, color: "var(--ink-500)", marginTop: 2 }} />
          <div>
            <b style={{ color: "var(--ink-900)" }}>วิธีใช้:</b>{" "}
            กดปุ่ม &quot;สั่งของ&quot; เมื่อสั่งซื้อแล้ว · กด &quot;ของถึง&quot; เมื่อรับของ · กด &quot;ติดตั้ง&quot;
            เมื่อช่างใช้แล้ว · ระบบจะอัปเดต timeline ใบนั้นอัตโนมัติ
          </div>
        </div>
      </div>
    </>
  );
}
