// Playland · ใบนับสต๊อก (cycle count round) — รายละเอียดรอบ · ใครนับ · ส่วนต่าง · ดูย้อนหลังได้
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";
const INK = "#3A3026", MUTED = "#8a7f70", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

export default async function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  const orgId = session.user.org_id;

  const c = await prisma.playlandStockCount.findFirst({
    where: { id, orgId },
    include: { lines: { orderBy: { createdAt: "asc" } }, branch: { select: { name: true } } },
  });
  if (!c) notFound();

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><ClipboardList size={20} /> {c.countCode}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>ใบนับสต๊อก · {c.branch?.name ?? "—"}</div>
        </div>
        <Link href={`/playland/stock?branch=${c.branchId}&tab=counts`} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, color: MUTED, textDecoration: "none", fontSize: 13, fontWeight: 600, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 9, padding: "8px 16px" }}><ArrowLeft size={15} /> นับสต๊อก</Link>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "22px 32px 48px" }}>
        {/* หัวใบนับ */}
        <div style={{ ...card, padding: "20px 22px", marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
            <Field label="เลขที่รอบ" value={c.countCode} mono />
            <Field label="วันที่นับ" value={new Date(c.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} />
            <Field label="ผู้นับ" value={c.countedByName ?? "—"} />
            <Field label="สาขา" value={c.branch?.name ?? "—"} />
            <Field label="รายการที่ปรับ" value={`${c.itemsCounted} รายการ`} />
            <Field label="ส่วนต่างรวม" value={`${c.totalDiff >= 0 ? "+" : ""}${c.totalDiff} ชิ้น`} mono tone={c.totalDiff === 0 ? undefined : c.totalDiff > 0 ? GREEN : RED} />
          </div>
          {c.note && <div style={{ marginTop: 14, fontSize: 14, color: "#6b6052" }}><span style={{ color: "#a89c8b" }}>หมายเหตุ:</span> {c.note}</div>}
        </div>

        {/* บรรทัดนับ */}
        <div style={{ ...card, overflow: "hidden" }}>
         <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: 560 }}>
          <div style={{ ...grid, padding: "12px 18px", background: "#f9f7f2", fontSize: 12.5, color: MUTED, fontWeight: 500 }}>
            <div>สินค้า</div><div style={{ textAlign: "right" }}>ระบบ</div><div style={{ textAlign: "right" }}>นับจริง</div><div style={{ textAlign: "right" }}>ต่าง</div><div>เหตุผล</div>
          </div>
          {c.lines.map((l) => (
            <div key={l.id} style={{ ...grid, padding: "12px 18px", borderTop: `1px solid #f2ebdd`, alignItems: "center" }}>
              <div style={{ fontSize: 15 }}>{l.productName}</div>
              <div style={{ textAlign: "right", fontSize: 14, color: MUTED, fontFamily: MONO }}>{l.systemQty}</div>
              <div style={{ textAlign: "right", fontFamily: MONO, fontWeight: 600 }}>{l.countedQty}</div>
              <div style={{ textAlign: "right", fontFamily: MONO, fontWeight: 700, color: l.diff === 0 ? MUTED : l.diff > 0 ? GREEN : RED }}>{l.diff >= 0 ? "+" : ""}{l.diff}</div>
              <div style={{ fontSize: 13, color: MUTED }}>{l.reason ?? "—"}</div>
            </div>
          ))}
          </div>
         </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, tone, mono }: { label: string; value: string; tone?: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#a89c8b", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: tone ?? INK, fontFamily: mono ? MONO : undefined }}>{value}</div>
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 56px 64px 56px 1fr", gap: 10 };
