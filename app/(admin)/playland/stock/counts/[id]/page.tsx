// Playland · ใบนับสต๊อก (cycle count round) — รายละเอียดรอบ · ใครนับ · ส่วนต่าง · ดูย้อนหลังได้
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

export default async function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requirePlaylandManager(session.user.role);
  const orgId = session.user.org_id;

  const c = await prisma.playlandStockCount.findFirst({
    where: { id, orgId },
    include: { lines: { orderBy: { createdAt: "asc" } }, branch: { select: { name: true } } },
  });
  if (!c) notFound();

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#F7F2EA", fontFamily: MITR, color: "#3A3026" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", background: "#fff", borderBottom: "1px solid #ece5d8" }}>
        <Link href={`/playland/stock?branch=${c.branchId}&tab=counts`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6b6052", textDecoration: "none", fontSize: 15 }}><ArrowLeft size={18} /> นับสต๊อก</Link>
        <div style={{ width: 1, height: 24, background: "#ece5d8" }} />
        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.3rem", display: "flex", alignItems: "center", gap: 8 }}><ClipboardList size={20} /> {c.countCode}</div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 28px 48px" }}>
        {/* หัวใบนับ */}
        <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 18, padding: "20px 22px", marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
            <Field label="เลขที่รอบ" value={c.countCode} />
            <Field label="วันที่นับ" value={new Date(c.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} />
            <Field label="ผู้นับ" value={c.countedByName ?? "—"} />
            <Field label="สาขา" value={c.branch?.name ?? "—"} />
            <Field label="รายการที่ปรับ" value={`${c.itemsCounted} รายการ`} />
            <Field label="ส่วนต่างรวม" value={`${c.totalDiff >= 0 ? "+" : ""}${c.totalDiff} ชิ้น`} tone={c.totalDiff === 0 ? undefined : c.totalDiff > 0 ? "#1F8A5B" : "#E74C3C"} />
          </div>
          {c.note && <div style={{ marginTop: 14, fontSize: 14, color: "#6b6052" }}><span style={{ color: "#a89c8b" }}>หมายเหตุ:</span> {c.note}</div>}
        </div>

        {/* บรรทัดนับ */}
        <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ ...grid, padding: "11px 18px", background: "#f9f4ea", fontSize: 12.5, color: "#8a7f70", fontWeight: 500 }}>
            <div>สินค้า</div><div style={{ textAlign: "right" }}>ระบบ</div><div style={{ textAlign: "right" }}>นับจริง</div><div style={{ textAlign: "right" }}>ต่าง</div><div>เหตุผล</div>
          </div>
          {c.lines.map((l) => (
            <div key={l.id} style={{ ...grid, padding: "12px 18px", borderTop: "1px solid #f2ebdd", alignItems: "center" }}>
              <div style={{ fontSize: 15 }}>{l.productName}</div>
              <div style={{ textAlign: "right", fontSize: 14, color: "#8a7f70" }}>{l.systemQty}</div>
              <div style={{ textAlign: "right", fontFamily: FREDOKA, fontWeight: 600 }}>{l.countedQty}</div>
              <div style={{ textAlign: "right", fontFamily: FREDOKA, fontWeight: 700, color: l.diff === 0 ? "#8a7f70" : l.diff > 0 ? "#1F8A5B" : "#E74C3C" }}>{l.diff >= 0 ? "+" : ""}{l.diff}</div>
              <div style={{ fontSize: 13, color: "#8a7f70" }}>{l.reason ?? "—"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#a89c8b", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: tone ?? "#3A3026" }}>{value}</div>
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 56px 64px 56px 1fr", gap: 10 };
