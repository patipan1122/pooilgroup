// DC Redesign v2 · timeline การเดินของสินค้า 1 ตัว — "ของไปไหนบ้าง" กดต่อไปเอกสารต้นทางได้.
//   รับเข้า → โอนออก/รับโอน → เบิก → ปรับ · เรียงใหม่→เก่า · ลิงก์ใบรับ/ใบโอน.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, ExternalLink, Boxes } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, DC_ROLE_LABEL } from "@/lib/dc/office-chrome";
import { getProductTimeline } from "@/lib/dc/movement-tracing";
import { PRODUCT_TYPE_LABEL } from "@/lib/dc/nav";
import { DcOfficeShell } from "@/components/dc/office-shell";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

const DIR = {
  in: { color: "#1F8A55", bg: "#E1F0E8", icon: <ArrowDownToLine size={14} /> },
  out: { color: "#DC5B53", bg: "#FBE3E1", icon: <ArrowUpFromLine size={14} /> },
  flat: { color: "#64748B", bg: "#EEF1F5", icon: <ArrowLeftRight size={14} /> },
} as const;

export default async function DcProductTimelinePage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;
  const { id } = await params;

  const product = await prisma.dcProduct.findFirst({
    where: { id, orgId },
    select: { id: true, sku: true, name: true, unit: true, type: true, category: true },
  });
  if (!product) notFound();

  const allowed = ctx.warehouses.map((w) => ({ id: w.id, name: w.name }));
  const allowedIds = allowed.map((w) => w.id);

  const [chrome, balances, timeline] = await Promise.all([
    getDcOfficeChrome(orgId),
    allowedIds.length
      ? prisma.dcStockBalance.findMany({
          where: { orgId, productId: id, warehouseId: { in: allowedIds } },
          select: { warehouseId: true, qtyOnHand: true, qtyInTransit: true, location: true },
        })
      : Promise.resolve([] as { warehouseId: string; qtyOnHand: number; qtyInTransit: number; location: string | null }[]),
    getProductTimeline({ orgId, productId: id, allowedWarehouses: allowed }),
  ]);

  const whName = new Map(allowed.map((w) => [w.id, w.name]));
  const totalOnHand = balances.reduce((s, b) => s + b.qtyOnHand, 0);
  const totalInTransit = balances.reduce((s, b) => s + b.qtyInTransit, 0);

  return (
    <DcOfficeShell
      active="products"
      warehouseName={ctx.activeWarehouse?.name ?? "DC คลังกลาง"}
      userName={ctx.session.user.name || ctx.session.user.email || "ผู้ใช้"}
      userRole={DC_ROLE_LABEL[ctx.session.user.role] ?? ctx.session.user.role}
      badges={chrome.badges}
      taskStrip={chrome.taskStrip}
    >
      <div style={{ maxWidth: 860 }}>
        <Link href="/dc/office/products" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)", marginBottom: 8, textDecoration: "none" }}>
          <ArrowLeft size={15} /> กลับรายการสินค้า
        </Link>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.01em" }}>{product.name}</h1>
            <p className="num" style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 13.5 }}>
              {product.sku} · หน่วย {product.unit} · {PRODUCT_TYPE_LABEL[product.type] ?? product.type}
            </p>
          </div>
          <Link href={`/dc/office/products/${product.id}`} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}>
            แก้ไขสินค้า
          </Link>
        </div>

        {/* คงเหลือปัจจุบัน per คลัง */}
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, padding: "16px 18px", marginBottom: 22, boxShadow: "0 1px 2px rgba(30,42,68,.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--primary-soft)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}><Boxes size={15} /></span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>คงเหลือตอนนี้</span>
            <span className="num" style={{ marginLeft: "auto", fontSize: 18, fontWeight: 700 }}>{totalOnHand.toLocaleString("en-US")} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>{product.unit}</span></span>
          </div>
          {balances.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>ยังไม่มีของในคลังที่คุณดูได้</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
              {balances.map((b) => (
                <div key={b.warehouseId} style={{ border: "1px solid var(--border)", borderRadius: 11, padding: "10px 12px", background: "var(--bg)" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{whName.get(b.warehouseId) ?? "—"}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 3 }}>
                    <span className="num" style={{ fontSize: 16, fontWeight: 700 }}>{b.qtyOnHand.toLocaleString("en-US")}</span>
                    {b.qtyInTransit > 0 ? <span className="num" style={{ fontSize: 11.5, color: "#8B5CD8" }}>+{b.qtyInTransit} ระหว่างทาง</span> : null}
                  </div>
                  {b.location ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>ที่เก็บ: {b.location}</div> : null}
                </div>
              ))}
            </div>
          )}
          {totalInTransit > 0 ? <div style={{ fontSize: 11.5, color: "#8B5CD8", marginTop: 8 }}>มีของระหว่างทางรวม {totalInTransit.toLocaleString("en-US")} {product.unit}</div> : null}
        </div>

        {/* timeline */}
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>การเดินของสินค้า (ใหม่ → เก่า)</div>
        {timeline.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, padding: "40px 20px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            ยังไม่มีการเคลื่อนไหวของสินค้านี้
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            {timeline.map((m, i) => {
              const d = DIR[m.direction];
              const last = i === timeline.length - 1;
              const qtyText = m.direction === "in" ? `+${m.qtyAbs}` : m.direction === "out" ? `−${m.qtyAbs}` : "ย้ายที่";
              return (
                <div key={m.id} style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
                  {/* rail */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 30, flexShrink: 0 }}>
                    <span style={{ width: 30, height: 30, borderRadius: "50%", background: d.bg, color: d.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{d.icon}</span>
                    {!last ? <span style={{ width: 2, flex: 1, background: "var(--border)", margin: "2px 0" }} /> : null}
                  </div>
                  {/* card */}
                  <div style={{ flex: 1, background: "#fff", border: "1px solid var(--border)", borderRadius: 13, padding: "12px 15px", marginBottom: 12, boxShadow: "0 1px 2px rgba(30,42,68,.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{m.kindLabel}</span>
                      <span className="num" style={{ fontSize: 13, fontWeight: 700, color: d.color, background: d.bg, padding: "1px 9px", borderRadius: 20 }}>{qtyText}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{fmtDateTime(m.occurredAt)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 5 }}>
                      {m.warehouseName}
                      {m.balanceAfter != null ? <> · คงเหลือหลังรายการ <b className="num" style={{ color: "var(--ink)" }}>{m.balanceAfter.toLocaleString("en-US")}</b></> : null}
                    </div>
                    {m.note ? <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>“{m.note}”</div> : null}
                    {m.doc && m.doc.href ? (
                      <Link href={m.doc.href} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--primary)", textDecoration: "none" }}>
                        <ExternalLink size={13} /> {m.doc.kind === "grn" ? "ใบรับ" : "ใบโอน"} {m.doc.code ?? ""} — กดดูต่อ
                      </Link>
                    ) : m.doc && m.doc.kind === "floor" ? (
                      <span style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "var(--muted)" }}>งานหน้าคลัง</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DcOfficeShell>
  );
}
