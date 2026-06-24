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
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

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
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#F7F2EA", fontFamily: MITR, color: "#3A3026" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", background: "#fff", borderBottom: "1px solid #ece5d8" }}>
        <Link href={`/playland/stock?branch=${branchId}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6b6052", textDecoration: "none", fontSize: 15 }}><ArrowLeft size={18} /> สต๊อก</Link>
        <div style={{ width: 1, height: 24, background: "#ece5d8" }} />
        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.3rem", display: "flex", alignItems: "center", gap: 8 }}><PackagePlus size={20} /> รับของเข้า</div>
      </header>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 28px 48px" }}>
        {products.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 24, textAlign: "center", color: "#8a7f70" }}>
            ยังไม่มีสินค้า/อะไหล่ในสาขานี้ · <Link href="/playland/settings/products" style={{ color: "#2D6CB1" }}>เพิ่มสินค้าก่อน</Link>
          </div>
        ) : (
          <StockReceiveForm branchId={branchId} products={products} />
        )}
      </div>
    </div>
  );
}
