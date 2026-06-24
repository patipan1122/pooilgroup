// DC · หลังบ้าน · รายการใบสั่งซื้อจีน (China PO list)
// แสดงใบสั่งซื้อทั้งหมดของ org · สถานะ · ผู้ขาย · ยอดรวม CNY · วันที่.
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { PO_STATUS_LABEL } from "@/lib/dc/nav";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import type { DcPoStatus } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

// สีป้ายสถานะ (map → tone ของ StatusPill)
const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  ORDERED: "brand",
  PARTIAL: "brand",
  CLOSED: "success",
  CANCELLED: "danger",
};

function fmtCny(n: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short", year: "2-digit" }).format(d);
}

export default async function DcPurchasingPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const pos = await prisma.dcPurchaseOrder.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      poCode: true,
      status: true,
      currency: true,
      createdAt: true,
      orderedAt: true,
      supplier: { select: { name: true } },
      lines: { select: { qty: true, unitPriceCny: true } },
    },
  });

  const rows = pos.map((po) => {
    const totalCny = po.lines.reduce((sum, l) => sum + l.qty * Number(l.unitPriceCny), 0);
    return {
      id: po.id,
      poCode: po.poCode,
      status: po.status as DcPoStatus,
      supplierName: po.supplier?.name ?? "—",
      totalCny,
      lineCount: po.lines.length,
      date: po.orderedAt ?? po.createdAt,
    };
  });

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">สั่งซื้อจีน</div>
          <div className="dc-sub">ใบสั่งซื้อจากจีน · อนุมัติ 1 คนก่อนสั่งจริง · CNY + ขนาด/CBM</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Link
          href="/dc/office/purchasing/new"
          className="dc-btn-xl"
          style={{ width: "auto", minHeight: 44, padding: "0 18px", fontSize: 15 }}
        >
          ＋ สร้างใบสั่งซื้อ
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={26} />}
          title="ยังไม่มีใบสั่งซื้อ"
          description="สร้างใบสั่งซื้อจีนใบแรก — เลือกผู้ขาย เพิ่มสินค้า ใส่ราคา CNY แล้วส่งอนุมัติ"
        />
      ) : (
        <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                <th style={cellHead}>เลขที่ใบ</th>
                <th style={cellHead}>ผู้ขาย</th>
                <th style={{ ...cellHead, textAlign: "right" }}>ยอดรวม (CNY)</th>
                <th style={{ ...cellHead, textAlign: "right" }}>รายการ</th>
                <th style={cellHead}>สถานะ</th>
                <th style={cellHead}>วันที่</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                  <td style={cell}>
                    <Link
                      href={`/dc/office/purchasing/${r.id}`}
                      style={{ fontWeight: 700, color: "var(--color-brand-700, #1d4ed8)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {r.poCode}
                    </Link>
                  </td>
                  <td style={cell}>{r.supplierName}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    ¥{fmtCny(r.totalCny)}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                    {r.lineCount}
                  </td>
                  <td style={cell}>
                    <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"} size="sm" dot>
                      {PO_STATUS_LABEL[r.status] ?? r.status}
                    </StatusPill>
                  </td>
                  <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
                    {fmtDate(r.date)}
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

const cellHead: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const cell: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "top",
};
