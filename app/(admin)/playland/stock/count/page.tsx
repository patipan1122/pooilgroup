// Playland · นับสต๊อกรอบใหม่ (cycle count) — server shell · บันทึกเป็น "ใบนับ" ดูย้อนหลังได้
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { StockCountForm } from "@/components/playland/stock-count-form";
import { ArrowLeft, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "นับสต๊อก · Play a lot" };
const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", LINE = "#ece5d8";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

export default async function StockCountCreatePage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(session.user.role);
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland/settings/branches");

  const products = await prisma.playlandProduct.findMany({
    where: { orgId, branchId, active: true },
    orderBy: [{ kind: "asc" }, { category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sku: true, category: true, stock: true },
  });

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><ClipboardList size={20} /> นับสต๊อกรอบใหม่</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>นับของจริง → ระบบคำนวณส่วนต่าง → ปรับสต๊อกพร้อม audit log</div>
        </div>
        <Link href={`/playland/stock?branch=${branchId}&tab=counts`} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, color: MUTED, textDecoration: "none", fontSize: 13, fontWeight: 600, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 9, padding: "8px 16px" }}><ArrowLeft size={15} /> กลับสต๊อก</Link>
      </header>
      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 32px 48px", width: "100%" }}>
        <div style={{ ...card, padding: "16px 18px", marginBottom: 16, fontSize: 13.5, color: "#6b6052" }}>
          💡 <strong>วิธีนับ:</strong> เดินนับของจริงตามชั้น · กรอกจำนวนที่นับได้ในช่อง “นับจริง” · ระบบคำนวณส่วนต่างให้ · ใส่เหตุผลที่ของหาย/เกิน · กดบันทึก →
          เก็บเป็น “ใบนับ” (ใครนับ · เมื่อไหร่ · ส่วนต่าง) ดูย้อนหลังได้
          <div style={{ marginTop: 4, color: AMBER }}>⚠️ บันทึกแล้วปรับสต๊อกทันที · มี audit log ทุกครั้ง</div>
        </div>
        {products.length === 0 ? (
          <div style={{ ...card, padding: 24, textAlign: "center", color: MUTED }}>
            ยังไม่มีสินค้าให้นับ · <Link href={`/playland/stock?branch=${branchId}&tab=items`} style={{ color: BLUE }}>เพิ่มสินค้าก่อน</Link>
          </div>
        ) : (
          <StockCountForm branchId={branchId} products={products} />
        )}
      </div>
    </div>
  );
}
