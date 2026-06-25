// DC · หลังบ้าน · รายการใบโอน (Transfer list)
//   • สถานะ · ต้นทาง → ปลายทาง · วันที่ส่ง · จำนวนบรรทัด
//   • เน้นแถบ "กำลังส่ง" (IN_TRANSIT) ที่รอปลายทางยืนยันรับ
import Link from "next/link";
import { Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { TRANSFER_STATUS_LABEL } from "@/lib/dc/nav";
import { DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  DISPATCHED: "info",
  IN_TRANSIT: "warning",
  CONFIRMED: "success",
  AUTO_UNVERIFIED: "danger",
  CANCELLED: "neutral",
};

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default async function DcTransfersPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const transfers = await prisma.dcTransfer.findMany({
    where: { orgId },
    orderBy: { dispatchedAt: "desc" },
    select: {
      id: true,
      transferCode: true,
      status: true,
      destType: true,
      fromWarehouseId: true,
      toWarehouseId: true,
      toLabel: true,
      sameSite: true,
      dispatchedAt: true,
      _count: { select: { lines: true } },
    },
  });

  // join ชื่อคลัง (ต้นทาง + ปลายทางที่เป็น warehouse)
  const whIds = new Set<string>();
  for (const t of transfers) {
    whIds.add(t.fromWarehouseId);
    if (t.toWarehouseId) whIds.add(t.toWarehouseId);
  }
  const warehouses = whIds.size
    ? await prisma.dcWarehouse.findMany({
        where: { id: { in: [...whIds] }, orgId },
        select: { id: true, name: true },
      })
    : [];
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));

  const destLabel = (t: (typeof transfers)[number]): string => {
    if (t.destType === DcTransferDestType.WAREHOUSE && t.toWarehouseId) {
      return whName.get(t.toWarehouseId) ?? "คลังปลายทาง";
    }
    return t.toLabel ?? "สาขา/โมดูล";
  };

  const inTransitCount = transfers.filter((t) => t.status === DcTransferStatus.IN_TRANSIT).length;

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ใบโอน (ส่ง / รับระหว่างคลัง)</div>
          <div className="dc-sub">ส่งของออก 2 จังหวะ — ปลายทางกดยืนยันรับ · ต้นทุนตามของไป</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      {inTransitCount > 0 && (
        <div
          style={{
            background: "#fff7ed",
            color: "#9a3412",
            border: "1px solid #fed7aa",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          มี {inTransitCount} ใบกำลังส่ง — รอปลายทางกดยืนยันรับ
        </div>
      )}

      {transfers.length === 0 ? (
        <EmptyState
          icon={<Truck size={26} />}
          title="ยังไม่มีใบโอน"
          description="ส่งของจากหน้าคลัง (ส่ง / โอน) — เลือกปลายทาง สแกนสินค้า แล้วส่งออก จะมาโผล่ที่นี่"
        />
      ) : (
        <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                <th style={cellHead}>เลขที่</th>
                <th style={cellHead}>ต้นทาง → ปลายทาง</th>
                <th style={{ ...cellHead, textAlign: "right" }}>รายการ</th>
                <th style={cellHead}>สถานะ</th>
                <th style={cellHead}>ส่งเมื่อ</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const isInTransit = t.status === DcTransferStatus.IN_TRANSIT;
                return (
                  <tr
                    key={t.id}
                    style={{
                      borderTop: "1px solid var(--dc-line, #f0f0f2)",
                      background: isInTransit ? "#fffbf5" : undefined,
                    }}
                  >
                    <td style={cell}>
                      <Link
                        href={`/dc/office/transfers/${t.id}`}
                        style={{ fontWeight: 700, color: "var(--color-brand-700, #1d4ed8)", fontVariantNumeric: "tabular-nums" }}
                      >
                        {t.transferCode}
                      </Link>
                    </td>
                    <td style={{ ...cell, color: "#52525b" }}>
                      {whName.get(t.fromWarehouseId) ?? "คลังต้นทาง"}
                      <span style={{ margin: "0 6px", color: "#a1a1aa" }}>→</span>
                      <strong style={{ color: "#3f3f46" }}>{destLabel(t)}</strong>
                      {t.sameSite ? <span style={{ marginLeft: 6, fontSize: 12, color: "#16a34a" }}>(อยู่ที่เดียวกัน)</span> : null}
                    </td>
                    <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                      {t._count.lines}
                    </td>
                    <td style={cell}>
                      <StatusPill tone={STATUS_TONE[t.status] ?? "neutral"} size="sm" dot>
                        {TRANSFER_STATUS_LABEL[t.status] ?? t.status}
                      </StatusPill>
                    </td>
                    <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
                      {fmtDate(t.dispatchedAt)}
                    </td>
                  </tr>
                );
              })}
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
