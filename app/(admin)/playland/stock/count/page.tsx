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
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

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
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#F7F2EA", fontFamily: MITR, color: "#3A3026" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", background: "#fff", borderBottom: "1px solid #ece5d8" }}>
        <Link href={`/playland/stock?branch=${branchId}&tab=counts`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6b6052", textDecoration: "none", fontSize: 15 }}><ArrowLeft size={18} /> สต๊อก</Link>
        <div style={{ width: 1, height: 24, background: "#ece5d8" }} />
        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.3rem", display: "flex", alignItems: "center", gap: 8 }}><ClipboardList size={20} /> นับสต๊อกรอบใหม่</div>
      </header>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 28px 48px", width: "100%" }}>
        <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 14, padding: "16px 18px", marginBottom: 16, fontSize: 13.5, color: "#6b6052" }}>
          💡 <strong>วิธีนับ:</strong> เดินนับของจริงตามชั้น · กรอกจำนวนที่นับได้ในช่อง “นับจริง” · ระบบคำนวณส่วนต่างให้ · ใส่เหตุผลที่ของหาย/เกิน · กดบันทึก →
          เก็บเป็น “ใบนับ” (ใครนับ · เมื่อไหร่ · ส่วนต่าง) ดูย้อนหลังได้
          <div style={{ marginTop: 4, color: "#a9791a" }}>⚠️ บันทึกแล้วปรับสต๊อกทันที · มี audit log ทุกครั้ง</div>
        </div>
        {products.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 24, textAlign: "center", color: "#8a7f70" }}>
            ยังไม่มีสินค้าให้นับ · <Link href={`/playland/stock?branch=${branchId}&tab=items`} style={{ color: "#2D6CB1" }}>เพิ่มสินค้าก่อน</Link>
          </div>
        ) : (
          <StockCountForm branchId={branchId} products={products} />
        )}
      </div>
    </div>
  );
}
