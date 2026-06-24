// Playland · ซ่อมเครื่อง + เบิกอะไหล่ — server shell + ประวัติซ่อม
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { RepairForm } from "@/components/playland/repair-form";
import { ArrowLeft, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "ซ่อม · อะไหล่ · Play a lot" };
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

export default async function RepairsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(session.user.role);
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland/settings/branches");
  const [parts, repairs] = await Promise.all([
    prisma.playlandProduct.findMany({ where: { orgId, branchId, active: true, kind: "SPARE_PART" }, orderBy: { name: "asc" }, select: { id: true, name: true, stock: true, costCents: true } }),
    prisma.playlandRepairLog.findMany({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 15, include: { parts: true } }),
  ]);

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#F7F2EA", fontFamily: MITR, color: "#3A3026" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", background: "#fff", borderBottom: "1px solid #ece5d8" }}>
        <Link href={`/playland/stock?branch=${branchId}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6b6052", textDecoration: "none", fontSize: 15 }}><ArrowLeft size={18} /> สต๊อก</Link>
        <div style={{ width: 1, height: 24, background: "#ece5d8" }} />
        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.3rem", display: "flex", alignItems: "center", gap: 8 }}><Wrench size={20} /> ซ่อมเครื่อง · เบิกอะไหล่</div>
      </header>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 28px 48px", display: "grid", gap: 28 }}>
        <RepairForm branchId={branchId} parts={parts} />

        <section>
          <h2 style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 12px 2px" }}>ประวัติการซ่อมล่าสุด</h2>
          {repairs.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 22, color: "#8a7f70" }}>ยังไม่มีประวัติซ่อม</div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden" }}>
              {repairs.map((r) => (
                <div key={r.id} style={{ padding: "14px 18px", borderBottom: "1px solid #f2ebdd" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <div style={{ flex: 1, fontWeight: 500, fontSize: 16 }}>{r.machineLabel}</div>
                    <div style={{ fontFamily: FREDOKA, fontWeight: 600, color: "#a9791a" }}>฿{Math.round(r.partsCostCents / 100).toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: "#a89c8b" }}>{new Date(r.createdAt).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" })}</div>
                  </div>
                  {r.description && <div style={{ fontSize: 13, color: "#8a7f70", marginTop: 2 }}>{r.description}</div>}
                  {r.parts.length > 0 && <div style={{ fontSize: 13, color: "#6b6052", marginTop: 4 }}>อะไหล่: {r.parts.map((p) => `${p.productName}×${p.quantity}`).join(" · ")}</div>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
