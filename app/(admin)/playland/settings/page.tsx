// Settings root · welcome screen guides to first action

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { Sparkles, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsHome() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);

  // Smart suggestions based on what's missing
  const suggestions: Array<{ done: boolean; label: string; href: string }> = [];
  suggestions.push({ done: branches.length > 0, label: "สร้างสาขาแรก", href: "/playland/settings/branches" });
  if (branches.length > 0) {
    const pkgCount = await prisma.playlandPackage.count({ where: { orgId, active: true } });
    const productCount = await prisma.playlandProduct.count({ where: { orgId, active: true } });
    const deviceCount = await prisma.playlandDevice.count({ where: { orgId } });
    suggestions.push({ done: pkgCount > 0, label: "สร้าง package อย่างน้อย 1", href: "/playland/settings/packages" });
    suggestions.push({ done: productCount > 0, label: "เพิ่มสินค้าใน POS", href: "/playland/settings/products" });
    suggestions.push({ done: deviceCount > 0, label: "ผูก ACS device (หรือใช้ mock ก่อน)", href: "/playland/settings/devices" });
  }

  const remaining = suggestions.filter((s) => !s.done);

  return (
    <div style={{ padding: 32, maxWidth: 640, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div className="pl-eyebrow" style={{ marginBottom: 6 }}><Sparkles size={11} /> setup</div>
        <h2 style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.8rem", fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 6 }}>
          {remaining.length === 0 ? "พร้อมรับลูกค้าแล้ว 🎉" : "ตั้งค่าให้ครบก่อนเริ่ม"}
        </h2>
        <div style={{ color: "var(--pl-text-muted)" }}>
          {remaining.length === 0
            ? "ทุกอย่างพร้อม · กลับไปที่ Workspace เริ่มรับลูกค้าได้เลย"
            : `เหลือ ${remaining.length} ขั้นตอน · ตามคำแนะนำด้านล่าง`}
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {suggestions.map((s) => (
          <Link key={s.href} href={s.href} className={`pl-card ${s.done ? "" : "pl-card-accent"}`} style={{ textDecoration: "none", color: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{
                width: 24, height: 24, borderRadius: 12,
                background: s.done ? "var(--pl-ok)" : "var(--pl-amber-500)",
                color: "white", display: "grid", placeItems: "center",
                fontSize: 14, fontWeight: 700,
              }}>
                {s.done ? "✓" : "•"}
              </div>
              <span style={{ fontWeight: 500, textDecoration: s.done ? "line-through" : "none", opacity: s.done ? 0.6 : 1 }}>{s.label}</span>
            </div>
            <ArrowRight size={14} color="var(--pl-text-muted)" />
          </Link>
        ))}
      </div>

      {remaining.length === 0 && (
        <Link href="/playland" className="pl-btn pl-btn-primary pl-btn-lg" style={{ marginTop: 24, width: "100%" }}>
          กลับ Workspace · เริ่มเลย →
        </Link>
      )}
    </div>
  );
}
