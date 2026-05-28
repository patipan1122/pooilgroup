// Playland · Stock count cycle · cashier counts physical → diff vs system → save /bigfeature W7

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { StockCountForm } from "@/components/playland/stock-count-form";
import { ArrowLeft, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StockCountPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) return <div className="pl-page"><header className="pl-header"><h1>ตั้งค่าสาขาก่อน</h1></header></div>;

  const products = await prisma.playlandProduct.findMany({
    where: { orgId, branchId, active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sku: true, category: true, stock: true },
  });

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland/settings" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Settings</Link>
          <h1><ClipboardList size={18} style={{ display: "inline", marginRight: 6, verticalAlign: -3 }} />Stock Count · นับสต๊อก</h1>
        </div>
        <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>
          {products.length} SKU · สาขา {branches.find((b) => b.id === branchId)?.name ?? branchId}
        </div>
      </header>

      <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto", width: "100%" }}>
        <div className="pl-card" style={{ marginBottom: 14, background: "var(--pl-amber-50)", border: "1px solid var(--pl-amber-200)" }}>
          <div style={{ fontSize: 13 }}>
            💡 <strong>วิธีใช้:</strong> เดินไปนับสต๊อกจริงตามรายการ · กรอกจำนวนที่นับได้ที่ช่อง <em>"นับจริง"</em> · ระบบคำนวณส่วนต่างให้อัตโนมัติ · ใส่เหตุผลที่ของหายหรือเกิน · กดบันทึก
          </div>
          <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 4 }}>
            ⚠️ ปรับสต๊อกแล้ว <strong>แก้คืนไม่ได้</strong> · ตรวจให้แน่ก่อนบันทึก · ทุกการปรับมี audit log
          </div>
        </div>

        <StockCountForm branchId={branchId} products={products} />
      </div>
    </div>
  );
}
