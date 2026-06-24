// Playland · ใบรับสินค้า (goods receipt) — รายละเอียดใบ · ดูย้อนหลังได้
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { thb } from "@/lib/playland/format";
import { ArrowLeft, ReceiptText } from "lucide-react";

export const dynamic = "force-dynamic";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requirePlaylandManager(session.user.role);
  const orgId = session.user.org_id;

  const r = await prisma.playlandPurchase.findFirst({
    where: { id, orgId },
    include: { lines: { orderBy: { createdAt: "asc" } }, branch: { select: { name: true } } },
  });
  if (!r) notFound();

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#F7F2EA", fontFamily: MITR, color: "#3A3026" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", background: "#fff", borderBottom: "1px solid #ece5d8" }}>
        <Link href={`/playland/stock?branch=${r.branchId}&tab=receipts`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6b6052", textDecoration: "none", fontSize: 15 }}><ArrowLeft size={18} /> ใบรับสินค้า</Link>
        <div style={{ width: 1, height: 24, background: "#ece5d8" }} />
        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.3rem", display: "flex", alignItems: "center", gap: 8 }}><ReceiptText size={20} /> {r.purchaseCode}</div>
      </header>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 28px 48px" }}>
        {/* หัวใบ */}
        <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 18, padding: "20px 22px", marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
            <Field label="เลขที่ใบ" value={r.purchaseCode} />
            <Field label="วันที่รับ" value={new Date(r.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} />
            <Field label="ผู้ขาย/ร้านค้า" value={r.supplierName ?? "—"} />
            <Field label="สาขา" value={r.branch?.name ?? "—"} />
          </div>
          {r.note && <div style={{ marginTop: 14, fontSize: 14, color: "#6b6052" }}><span style={{ color: "#a89c8b" }}>หมายเหตุ:</span> {r.note}</div>}
        </div>

        {/* รายการ */}
        <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ ...grid, padding: "11px 18px", background: "#f9f4ea", fontSize: 12.5, color: "#8a7f70", fontWeight: 500 }}>
            <div>สินค้า</div><div style={{ textAlign: "right" }}>จำนวน</div><div style={{ textAlign: "right" }}>ต้นทุน/ชิ้น</div><div style={{ textAlign: "right" }}>รวม</div>
          </div>
          {r.lines.map((l) => (
            <div key={l.id} style={{ ...grid, padding: "12px 18px", borderTop: "1px solid #f2ebdd", alignItems: "center" }}>
              <div style={{ fontSize: 15 }}>{l.productName}</div>
              <div style={{ textAlign: "right", fontFamily: FREDOKA, fontWeight: 600 }}>{l.quantity}</div>
              <div style={{ textAlign: "right", fontSize: 14, color: "#8a7f70" }}>{thb(l.unitCostCents)}</div>
              <div style={{ textAlign: "right", fontWeight: 500 }}>{thb(l.unitCostCents * l.quantity)}</div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px", background: "#f9f4ea", borderTop: "1px solid #f2ebdd" }}>
            <span style={{ fontWeight: 500 }}>รวมต้นทุนรับเข้า</span>
            <span style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 20, color: "#2D6CB1" }}>{thb(r.totalCostCents)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#a89c8b", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 70px 100px 100px", gap: 10 };
