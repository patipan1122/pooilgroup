import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { fmtDate, thb } from "@/lib/playland/format";
import { Tag, ArrowLeft, PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PromosSettingsPage() {
  const session = await requireSession();
  const promos = await prisma.playlandPromo.findMany({ where: { orgId: session.user.org_id }, orderBy: { createdAt: "desc" } });
  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland/settings" className="pl-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}><ArrowLeft size={12} /> Settings</Link>
          <h1>Promo / Coupon · {promos.length}</h1>
        </div>
        <button className="pl-btn pl-btn-primary" disabled><PlusCircle size={14} /> เพิ่ม (เร็ว ๆ นี้)</button>
      </header>
      <div style={{ padding: 16 }}>
        {promos.length === 0 ? (
          <div className="pl-card pl-empty">
            <Tag size={32} opacity={0.4} />
            ยังไม่มี promo · ตอนนี้เป็น stub · เปิดใช้งานจริงใน Phase 9
          </div>
        ) : (
          <table className="pl-table">
            <thead><tr><th>Type</th><th>Code</th><th>Name</th><th>ส่วนลด</th><th>ใช้ไป</th><th>หมดอายุ</th><th>Active</th></tr></thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id}>
                  <td><span className="pl-chip pl-chip-brand">{p.type}</span></td>
                  <td><code>{p.code ?? "—"}</code></td>
                  <td>{p.name}</td>
                  <td>{p.discountPercent ? `${p.discountPercent}%` : p.discountCents ? thb(p.discountCents) : "—"}</td>
                  <td>{p.usesCount} / {p.maxUses ?? "∞"}</td>
                  <td>{p.endsAt ? fmtDate(p.endsAt) : "ไม่กำหนด"}</td>
                  <td>{p.active ? <span className="pl-chip pl-chip-ok">ใช้</span> : <span className="pl-chip pl-chip-muted">ปิด</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
