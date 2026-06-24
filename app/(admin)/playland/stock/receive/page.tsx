// Playland · รับของเข้า (goods receipt) — server shell
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { StockReceiveForm } from "@/components/playland/stock-receive-form";
import { ArrowLeft, PackagePlus } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "รับของเข้า · Play a lot" };
const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", LINE = "#ece5d8";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(session.user.role);
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland/settings/branches");
  const products = await prisma.playlandProduct.findMany({
    where: { orgId, branchId, active: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, barcode: true, stock: true, costCents: true, kind: true },
  });

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><PackagePlus size={20} /> รับของเข้า</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>ยิงบาร์โค้ดหรือเลือกสินค้า → ใส่จำนวน+ต้นทุน → สต๊อกเพิ่มทันที</div>
        </div>
        <Link href={`/playland/stock?branch=${branchId}`} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, color: MUTED, textDecoration: "none", fontSize: 13, fontWeight: 600, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 9, padding: "8px 16px" }}><ArrowLeft size={15} /> กลับสต๊อก</Link>
      </header>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "22px 32px 48px" }}>
        {products.length === 0 ? (
          <div style={{ ...card, padding: 24, textAlign: "center", color: MUTED }}>
            ยังไม่มีสินค้า/อะไหล่ในสาขานี้ · <Link href="/playland/settings/products" style={{ color: BLUE }}>เพิ่มสินค้าก่อน</Link>
          </div>
        ) : (
          <StockReceiveForm branchId={branchId} products={products} />
        )}
      </div>
    </div>
  );
}
