// DC · หลังบ้าน · รายการใบรับสินค้า (GRN list)
// แสดงใบรับเข้า · คลัง · วันที่ · สถานะลงบัญชี (PENDING/POSTED/FAILED).
import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";

export const dynamic = "force-dynamic";

const POST_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  PENDING: "warning",
  POSTED: "success",
  FAILED: "danger",
  NA: "neutral",
};
const POST_LABEL: Record<string, string> = {
  PENDING: "รอลงบัญชี",
  POSTED: "ลง TRCloud แล้ว",
  FAILED: "ส่งไม่สำเร็จ",
  NA: "ไม่เกี่ยวข้อง",
};

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export default async function DcReceiptsPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const grns = await prisma.dcGoodsReceipt.findMany({
    where: { orgId },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      grnCode: true,
      warehouseId: true,
      postStatus: true,
      receivedAt: true,
      shipment: { select: { shipmentCode: true } },
      _count: { select: { lines: true } },
    },
  });

  // ชื่อคลัง (join เอง — GRN เก็บแค่ warehouseId)
  const whIds = [...new Set(grns.map((g) => g.warehouseId))];
  const whs = whIds.length
    ? await prisma.dcWarehouse.findMany({ where: { id: { in: whIds }, orgId }, select: { id: true, name: true } })
    : [];
  const whById = new Map(whs.map((w) => [w.id, w.name]));

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">รับสินค้าเข้าคลัง (GRN)</div>
          <div className="dc-sub">ใบรับเข้าจริง · คิดต้นทุนนำเข้าต่อชิ้น + ตัดสต๊อก + ส่ง TRCloud</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Link
          href="/dc/office/receipts/new"
          className="dc-btn-xl"
          style={{ width: "auto", minHeight: 44, padding: "0 18px", fontSize: 15 }}
        >
          ＋ รับสินค้า
        </Link>
      </div>

      {grns.length === 0 ? (
        <EmptyState
          icon={<PackageCheck size={26} />}
          title="ยังไม่มีใบรับสินค้า"
          description="เมื่อของจากจีนมาถึง สร้างใบรับสินค้า — เลือกคลัง ใส่จำนวนที่รับจริง แล้วลงรับเข้า + คิดต้นทุน"
        />
      ) : (
        <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                <th style={cellHead}>เลขที่ใบ</th>
                <th style={cellHead}>คลัง</th>
                <th style={cellHead}>ชิปเมนต์</th>
                <th style={{ ...cellHead, textAlign: "right" }}>รายการ</th>
                <th style={cellHead}>วันที่รับ</th>
                <th style={cellHead}>สถานะลงบัญชี</th>
              </tr>
            </thead>
            <tbody>
              {grns.map((g) => (
                <tr key={g.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                  <td style={cell}>
                    <Link
                      href={`/dc/office/receipts/${g.id}`}
                      style={{ fontWeight: 700, color: "var(--color-brand-700, #1d4ed8)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {g.grnCode}
                    </Link>
                  </td>
                  <td style={{ ...cell, color: "#52525b" }}>{whById.get(g.warehouseId) ?? "—"}</td>
                  <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
                    {g.shipment?.shipmentCode ?? "—"}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                    {g._count.lines}
                  </td>
                  <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(g.receivedAt)}</td>
                  <td style={cell}>
                    <StatusPill tone={POST_TONE[g.postStatus] ?? "neutral"} size="sm" dot>
                      {POST_LABEL[g.postStatus] ?? g.postStatus}
                    </StatusPill>
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
  verticalAlign: "middle",
};
