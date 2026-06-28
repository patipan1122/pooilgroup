// DC Redesign v2 · หลังบ้าน · รายการชิปเมนต์ (Shipment list) — shell ครีม/ฟ้า (เข้าชุด DC).
import Link from "next/link";
import { Ship } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { SHIPMENT_STATUS_LABEL } from "@/lib/dc/nav";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { PurchasingSubnav } from "@/components/dc/purchasing-subnav";
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

  const [chrome, shipments] = await Promise.all([
    getDcOfficeChrome(orgId),
    prisma.dcShipment.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, shipmentCode: true, status: true, mode: true, trackingNo: true,
        cbmTotal: true, eta: true, createdAt: true,
        po: { select: { poCode: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return (
    <DcOfficeShell active="ship" {...dcShellChrome(ctx, chrome)}>
      <div>
        <PurchasingSubnav active="ship" />
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>ชิปเมนต์ (ขนของจากจีน)</h1>
            <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>แต่ละเที่ยวขนของ · เก็บค่าขนส่ง/ภาษีนำเข้า → เฉลี่ยลงต้นทุนสินค้าตอนรับเข้า</p>
          </div>
          <Link href="/dc/office/shipments/new" style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--primary)", color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, textDecoration: "none", boxShadow: "0 2px 6px rgba(31,79,214,.25)" }}>
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
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "0 1px 2px rgba(30,42,68,.04)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", background: "#FCFAF7" }}>
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
                  <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={cell}>
                      <Link href={`/dc/office/shipments/${s.id}`} className="num" style={{ fontWeight: 700, color: "var(--primary)" }}>
                        {s.shipmentCode}
                      </Link>
                    </td>
                    <td style={{ ...cell, color: "var(--ink2)" }}>{MODE_LABEL[s.mode] ?? s.mode}</td>
                    <td style={{ ...cell, color: "var(--ink2)" }} className="num">{s.trackingNo ?? "—"}</td>
                    <td style={{ ...cell, color: "var(--ink2)" }} className="num">{s.po?.poCode ?? "—"}</td>
                    <td style={{ ...cell, textAlign: "right", color: "var(--ink2)" }} className="num">{s._count.lines}</td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 600 }} className="num">
                      {s.cbmTotal != null ? `${fmtNum(Number(s.cbmTotal))} m³` : "—"}
                    </td>
                    <td style={cell}>
                      <StatusPill tone={STATUS_TONE[s.status] ?? "neutral"} size="sm" dot>
                        {SHIPMENT_STATUS_LABEL[s.status] ?? s.status}
                      </StatusPill>
                    </td>
                    <td style={{ ...cell, color: "var(--ink2)" }} className="num">{fmtDate(s.eta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DcOfficeShell>
  );
}

const cellHead: React.CSSProperties = { padding: "11px 16px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" };
const cell: React.CSSProperties = { padding: "13px 16px", verticalAlign: "middle" };
