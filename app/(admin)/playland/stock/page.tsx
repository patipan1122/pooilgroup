// Playland · สต๊อก/คลัง — dashboard (ของใกล้หมด + ความเคลื่อนไหว) · ลุค Play a lot หลังบ้าน
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { thb } from "@/lib/playland/format";
import { Boxes, PackagePlus, Wrench, AlertTriangle, ArrowLeft, Cookie } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "สต๊อก · Play a lot" };

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

const MOVE_LABEL: Record<string, { t: string; up: boolean }> = {
  PURCHASE_IN: { t: "รับเข้า", up: true },
  SALE_OUT: { t: "ขายออก", up: false },
  COUNT_ADJUST: { t: "ปรับนับ", up: true },
  PART_USED: { t: "เบิกซ่อม", up: false },
  RETURN_IN: { t: "คืนเข้า", up: true },
  MANUAL_ADJUST: { t: "ปรับมือ", up: true },
};

export default async function StockPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(session.user.role);
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland/settings/branches");

  const [items, movements] = await Promise.all([
    prisma.playlandProduct.findMany({ where: { orgId, branchId, active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.playlandStockMovement.findMany({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 20, include: { product: { select: { name: true } } } }),
  ]);
  const low = items.filter((p) => p.reorderLevel > 0 && p.stock <= p.reorderLevel);
  const saleCount = items.filter((p) => p.kind === "SALE_ITEM").length;
  const partCount = items.filter((p) => p.kind === "SPARE_PART").length;
  const stockValue = items.reduce((a, p) => a + (p.costCents ?? 0) * p.stock, 0);

  const kpis = [
    { label: "ของใกล้หมด", value: String(low.length), tint: low.length > 0 ? { bg: "#fdeceb", fg: "#E74C3C" } : { bg: "#eaf3eb", fg: "#1F8A5B" }, icon: AlertTriangle },
    { label: "สินค้าขาย / อะไหล่", value: `${saleCount} / ${partCount}`, tint: { bg: "#eaf3f6", fg: "#2D6CB1" }, icon: Boxes },
    { label: "มูลค่าสต๊อก (ทุน)", value: thb(stockValue), tint: { bg: "#fdf3df", fg: "#a9791a" }, icon: Cookie },
  ];

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#F7F2EA", fontFamily: MITR, color: "#3A3026" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", background: "#fff", borderBottom: "1px solid #ece5d8", flexWrap: "wrap" }}>
        <Link href="/playland/office" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6b6052", textDecoration: "none", fontSize: 15 }}><ArrowLeft size={18} /> หลังบ้าน</Link>
        <div style={{ width: 1, height: 24, background: "#ece5d8" }} />
        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.3rem" }}>สต๊อก · คลังสินค้า</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <Link href={`/playland/stock/receive?branch=${branchId}`} style={btnPrimary}><PackagePlus size={16} /> รับของเข้า</Link>
          <Link href={`/playland/repairs?branch=${branchId}`} style={btnGhost}><Wrench size={16} /> ซ่อม · เบิกอะไหล่</Link>
        </div>
      </header>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "26px 28px 48px" }}>
        {branches.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {branches.map((b) => (
              <Link key={b.id} href={`/playland/stock?branch=${b.id}`} style={{ padding: "7px 14px", borderRadius: 999, fontSize: 14, textDecoration: "none", background: b.id === branchId ? "#2D6CB1" : "#fff", color: b.id === branchId ? "#fff" : "#6b6052", border: "1px solid #ece5d8" }}>{b.name}</Link>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 30 }}>
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 18, padding: "20px 22px", display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: k.tint.bg, color: k.tint.fg, display: "grid", placeItems: "center", flexShrink: 0 }}><Icon size={24} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.82rem", color: "#8a7f70", marginBottom: 3 }}>{k.label}</div>
                  <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.6rem", lineHeight: 1, color: "#3A3026", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ของใกล้หมด */}
        <section style={{ marginBottom: 30 }}>
          <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 12px 2px" }}>⚠️ ของใกล้หมด (ถึงจุดสั่งซื้อ)</h2>
          {low.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "22px", color: "#8a7f70", fontSize: 15 }}>สต๊อกเพียงพอทุกรายการ ✓</div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden" }}>
              {low.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid #f2ebdd" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 16 }}>{p.name} {p.kind === "SPARE_PART" && <span style={{ fontSize: 12, color: "#a9791a", background: "#fdf3df", padding: "1px 8px", borderRadius: 999 }}>อะไหล่</span>}</div>
                    <div style={{ fontSize: 13, color: "#8a7f70" }}>จุดสั่งซื้อ {p.reorderLevel}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                  </div>
                  <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 20, color: p.stock === 0 ? "#E74C3C" : "#a9791a" }}>{p.stock}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ความเคลื่อนไหวล่าสุด */}
        <section>
          <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 12px 2px" }}>ความเคลื่อนไหวล่าสุด</h2>
          {movements.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "22px", color: "#8a7f70", fontSize: 15 }}>ยังไม่มีการเคลื่อนไหว</div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden" }}>
              {movements.map((m) => {
                const lbl = MOVE_LABEL[m.kind] ?? { t: m.kind, up: true };
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid #f2ebdd" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: lbl.up ? "#1F8A5B" : "#E74C3C", background: lbl.up ? "#eaf3eb" : "#fdeceb", padding: "2px 9px", borderRadius: 999, flexShrink: 0 }}>{lbl.t}</span>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{m.product?.name ?? "—"}</div>
                    <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 16, color: m.quantity >= 0 ? "#1F8A5B" : "#E74C3C" }}>{m.quantity >= 0 ? "+" : ""}{m.quantity}</div>
                    <div style={{ fontSize: 12, color: "#a89c8b", width: 92, textAlign: "right", flexShrink: 0 }}>{new Date(m.createdAt).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, background: "#2D6CB1", color: "#fff", textDecoration: "none", padding: "10px 16px", borderRadius: 999, fontWeight: 600, fontSize: 14 };
const btnGhost: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, background: "#fff", color: "#6b6052", textDecoration: "none", padding: "10px 16px", borderRadius: 999, fontWeight: 600, fontSize: 14, border: "1px solid #ece5d8" };
