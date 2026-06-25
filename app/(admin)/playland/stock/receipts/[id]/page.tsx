// Playland · ใบรับสินค้า (goods receipt) — รายละเอียดใบ · ดูย้อนหลังได้
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { thb } from "@/lib/playland/format";
import { ArrowLeft, ReceiptText } from "lucide-react";

export const dynamic = "force-dynamic";
const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  const orgId = session.user.org_id;

  const r = await prisma.playlandPurchase.findFirst({
    where: { id, orgId },
    include: { lines: { orderBy: { createdAt: "asc" } }, branch: { select: { name: true } } },
  });
  if (!r) notFound();

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><ReceiptText size={20} /> {r.purchaseCode}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>ใบรับสินค้า · {r.branch?.name ?? "—"}</div>
        </div>
        <Link href={`/playland/stock?branch=${r.branchId}&tab=receipts`} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, color: MUTED, textDecoration: "none", fontSize: 13, fontWeight: 600, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 9, padding: "8px 16px" }}><ArrowLeft size={15} /> ใบรับสินค้า</Link>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "22px 32px 48px" }}>
        {/* หัวใบ */}
        <div style={{ ...card, padding: "20px 22px", marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
            <Field label="เลขที่ใบ" value={r.purchaseCode} mono />
            <Field label="วันที่รับ" value={new Date(r.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} />
            <Field label="ผู้ขาย/ร้านค้า" value={r.supplierName ?? "—"} />
            <Field label="สาขา" value={r.branch?.name ?? "—"} />
          </div>
          {r.note && <div style={{ marginTop: 14, fontSize: 14, color: "#6b6052" }}><span style={{ color: "#a89c8b" }}>หมายเหตุ:</span> {r.note}</div>}
        </div>

        {/* รายการ */}
        <div style={{ ...card, overflow: "hidden" }}>
         <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: 480 }}>
          <div style={{ ...grid, padding: "12px 18px", background: "#f9f7f2", fontSize: 12.5, color: MUTED, fontWeight: 500 }}>
            <div>สินค้า</div><div style={{ textAlign: "right" }}>จำนวน</div><div style={{ textAlign: "right" }}>ต้นทุน/ชิ้น</div><div style={{ textAlign: "right" }}>รวม</div>
          </div>
          {r.lines.map((l) => (
            <div key={l.id} style={{ ...grid, padding: "12px 18px", borderTop: `1px solid #f2ebdd`, alignItems: "center" }}>
              <div style={{ fontSize: 15 }}>{l.productName}</div>
              <div style={{ textAlign: "right", fontFamily: MONO, fontWeight: 600 }}>{l.quantity}</div>
              <div style={{ textAlign: "right", fontSize: 14, color: MUTED, fontFamily: MONO }}>{thb(l.unitCostCents)}</div>
              <div style={{ textAlign: "right", fontWeight: 500, fontFamily: MONO }}>{thb(l.unitCostCents * l.quantity)}</div>
            </div>
          ))}
          </div>
         </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px", background: "#f9f7f2", borderTop: `1px solid #f2ebdd` }}>
            <span style={{ fontWeight: 500 }}>รวมต้นทุนรับเข้า</span>
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: BLUE }}>{thb(r.totalCostCents)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#a89c8b", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 500, fontFamily: mono ? MONO : undefined }}>{value}</div>
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 70px 100px 100px", gap: 10 };
