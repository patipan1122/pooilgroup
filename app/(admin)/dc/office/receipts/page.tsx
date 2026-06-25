// DC Redesign v2 · ใบรับสินค้า (GRN) — list. shell ครีม/ฟ้า ตาม prototype isGRN.
//   • "รอรับเข้า": ใบสั่งที่ของถึงโกดังแล้ว (AT_WAREHOUSE) → การ์ดเริ่มรับเข้า
//   • "ประวัติการรับเข้า": ตาราง GRN (รับ X/Y · รับครบ/ไม่ครบ) กดแถว → รายละเอียด+เหลือ+timeline
import Link from "next/link";
import { ScanLine, ArrowRight, PackageCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { DcPoStatus } from "@/lib/generated/prisma/enums";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, DC_ROLE_LABEL } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(d);
}

export default async function DcReceiptsPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [chrome, grns, pendingPos] = await Promise.all([
    getDcOfficeChrome(orgId),
    prisma.dcGoodsReceipt.findMany({
      where: { orgId },
      orderBy: { receivedAt: "desc" },
      take: 100,
      select: {
        id: true, grnCode: true, warehouseId: true, poId: true, postStatus: true, receivedAt: true,
        shipment: { select: { shipmentCode: true } },
        lines: { select: { qtyReceived: true, qtyExpected: true } },
      },
    }),
    prisma.dcPurchaseOrder.findMany({
      where: { orgId, status: DcPoStatus.AT_WAREHOUSE },
      orderBy: { orderedAt: "desc" },
      take: 6,
      select: { id: true, poCode: true, supplier: { select: { name: true } }, _count: { select: { lines: true } } },
    }),
  ]);

  // join คลัง + PO code (GRN เก็บแค่ id)
  const whIds = [...new Set(grns.map((g) => g.warehouseId))];
  const poIds = [...new Set(grns.map((g) => g.poId).filter((x): x is string => !!x))];
  const [whs, pos] = await Promise.all([
    whIds.length ? prisma.dcWarehouse.findMany({ where: { id: { in: whIds }, orgId }, select: { id: true, name: true } }) : Promise.resolve([]),
    poIds.length ? prisma.dcPurchaseOrder.findMany({ where: { id: { in: poIds }, orgId }, select: { id: true, poCode: true, supplier: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const whName = new Map(whs.map((w) => [w.id, w.name]));
  const poInfo = new Map(pos.map((p) => [p.id, p]));

  const rows = grns.map((g) => {
    const recv = g.lines.reduce((s, l) => s + l.qtyReceived, 0);
    const exp = g.lines.reduce((s, l) => s + l.qtyExpected, 0);
    const ok = exp > 0 ? recv >= exp : true;
    const po = g.poId ? poInfo.get(g.poId) : null;
    return {
      id: g.id, grnCode: g.grnCode,
      poCode: po?.poCode ?? "—",
      vendor: po?.supplier?.name ?? "—",
      wh: whName.get(g.warehouseId) ?? "—",
      date: fmtDate(g.receivedAt),
      recvText: exp > 0 ? `${recv}/${exp}` : `${recv}`,
      ok,
    };
  });

  const GRID = "1.1fr 1fr 1.1fr 1fr auto auto auto";

  return (
    <DcOfficeShell
      active="grn"
      warehouseName={ctx.activeWarehouse?.name ?? "DC คลังกลาง"}
      userName={ctx.session.user.name || ctx.session.user.email || "ผู้ใช้"}
      userRole={DC_ROLE_LABEL[ctx.session.user.role] ?? ctx.session.user.role}
      badges={chrome.badges}
      taskStrip={chrome.taskStrip}
    >
      <div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>ใบรับสินค้า (GRN)</h1>
            <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>รับของเข้าคลังตามใบสั่งซื้อ · เทียบจำนวนสั่ง–รับ · กดดูใบไหนก็ได้เพื่อตามว่าของไปไหนต่อ</p>
          </div>
          <Link href="/dc/office/receipts/new" style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--primary)", color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, textDecoration: "none", boxShadow: "0 2px 6px rgba(31,79,214,.25)" }}>
            <ScanLine size={16} /> รับสินค้าเข้า
          </Link>
        </div>

        {/* รอรับเข้า */}
        {pendingPos.length > 0 ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              รอรับเข้า <span style={{ fontSize: 12, fontWeight: 600, color: "#2E9D6B", background: "#DFF1E8", padding: "2px 9px", borderRadius: 20 }}>ถึงโกดังแล้ว</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))", gap: 14, marginBottom: 24 }}>
              {pendingPos.map((p) => (
                <div key={p.id} style={{ background: "#fff", border: "1px solid var(--border)", borderLeft: "3px solid #2E9D6B", borderRadius: 13, padding: "16px 18px", boxShadow: "0 1px 2px rgba(30,42,68,.04)" }}>
                  <div className="num" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>{p.poCode}</div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{p.supplier?.name ?? "ไม่ระบุผู้ขาย"}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 14 }}>{p._count.lines} รายการ · รอรับเข้าคลัง</div>
                  <Link href={`/dc/office/receipts/new?po=${p.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#2E9D6B", color: "#fff", borderRadius: 9, padding: 9, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                    เริ่มรับเข้า <ArrowRight size={15} />
                  </Link>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* ประวัติการรับเข้า */}
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>ประวัติการรับเข้า</div>
        {rows.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, padding: "40px 20px", textAlign: "center", color: "var(--muted)" }}>
            <PackageCheck size={26} style={{ marginBottom: 8, opacity: 0.6 }} />
            <div style={{ fontSize: 14 }}>ยังไม่มีใบรับสินค้า — เมื่อของถึงโกดัง กด “รับสินค้าเข้า” เพื่อสร้างใบแรก</div>
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "0 1px 2px rgba(30,42,68,.04)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 14, padding: "13px 20px", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", background: "#FCFAF7" }}>
              <span>เลข GRN</span><span>อ้างอิง PO</span><span>ผู้ขาย</span><span>คลัง</span><span>วันที่</span><span style={{ textAlign: "center" }}>รับ</span><span style={{ textAlign: "right" }}>สถานะ</span>
            </div>
            {rows.map((g) => (
              <Link key={g.id} href={`/dc/office/receipts/${g.id}`} className="dcx-trow" style={{ display: "grid", gridTemplateColumns: GRID, gap: 14, padding: "15px 20px", borderBottom: "1px solid var(--border)", alignItems: "center", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{g.grnCode}</span>
                <span className="num" style={{ color: "var(--ink2)" }}>{g.poCode}</span>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.vendor}</span>
                <span style={{ color: "var(--ink2)" }}>{g.wh}</span>
                <span style={{ color: "var(--ink2)" }}>{g.date}</span>
                <span className="num" style={{ textAlign: "center", color: "var(--ink2)" }}>{g.recvText}</span>
                <span style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: g.ok ? "#1F8A55" : "#B45309", background: g.ok ? "#E1F0E8" : "#FEF1DE", padding: "2px 9px", borderRadius: 20 }}>
                    {g.ok ? "รับครบ" : "รับไม่ครบ"}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DcOfficeShell>
  );
}
