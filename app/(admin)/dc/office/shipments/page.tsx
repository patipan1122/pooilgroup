// DC · หลังบ้าน · รายการชิปเมนต์ (Shipment list)
// แสดงเที่ยวขนของจากจีน → ไทย · สถานะ · tracking · โหมด (เรือ/รถ) · ETA · CBM · PO.
import Link from "next/link";
import { Ship } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { SHIPMENT_STATUS_LABEL } from "@/lib/dc/nav";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  PREPARING: "neutral",
  IN_TRANSIT: "warning",
  ARRIVED: "info",
  RECEIVED: "success",
};

const MODE_LABEL: Record<string, string> = { TRUCK: "รถบรรทุก", SEA: "เรือ" };

function fmtNum(n: number, d = 4): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short", year: "2-digit" }).format(d);
}

export default async function DcShipmentsPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const shipments = await prisma.dcShipment.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shipmentCode: true,
      status: true,
      mode: true,
      trackingNo: true,
      cbmTotal: true,
      eta: true,
      createdAt: true,
      po: { select: { poCode: true } },
      _count: { select: { lines: true } },
    },
  });

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ชิปเมนต์ (ขนของจากจีน)</div>
          <div className="dc-sub">แต่ละเที่ยวขนของ · เก็บค่าขนส่ง/ภาษีนำเข้า → เฉลี่ยลงต้นทุนสินค้าตอนรับเข้า</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Link
          href="/dc/office/shipments/new"
          className="dc-btn-xl"
          style={{ width: "auto", minHeight: 44, padding: "0 18px", fontSize: 15 }}
        >
          ＋ สร้างชิปเมนต์
        </Link>
      </div>

      {shipments.length === 0 ? (
        <EmptyState
          icon={<Ship size={26} />}
          title="ยังไม่มีชิปเมนต์"
          description="สร้างชิปเมนต์ใบแรก — เลือกใบสั่งซื้อ (หรือใส่สินค้าเอง) เลือกเรือ/รถ ใส่ tracking แล้วบันทึก"
        />
      ) : (
        <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                <th style={cellHead}>เลขที่</th>
                <th style={cellHead}>ขนส่ง</th>
                <th style={cellHead}>Tracking</th>
                <th style={cellHead}>ใบสั่งซื้อ</th>
                <th style={{ ...cellHead, textAlign: "right" }}>รายการ</th>
                <th style={{ ...cellHead, textAlign: "right" }}>CBM รวม</th>
                <th style={cellHead}>สถานะ</th>
                <th style={cellHead}>ETA</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                  <td style={cell}>
                    <Link
                      href={`/dc/office/shipments/${s.id}`}
                      style={{ fontWeight: 700, color: "var(--color-brand-700, #1d4ed8)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {s.shipmentCode}
                    </Link>
                  </td>
                  <td style={{ ...cell, color: "#52525b" }}>{MODE_LABEL[s.mode] ?? s.mode}</td>
                  <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
                    {s.trackingNo ?? "—"}
                  </td>
                  <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
                    {s.po?.poCode ?? "—"}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                    {s._count.lines}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {s.cbmTotal != null ? `${fmtNum(Number(s.cbmTotal))} m³` : "—"}
                  </td>
                  <td style={cell}>
                    <StatusPill tone={STATUS_TONE[s.status] ?? "neutral"} size="sm" dot>
                      {SHIPMENT_STATUS_LABEL[s.status] ?? s.status}
                    </StatusPill>
                  </td>
                  <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
                    {fmtDate(s.eta)}
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
