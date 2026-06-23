// Settings root · welcome screen guides to first action (kiosk look · Play a lot)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { ArrowRight, Check } from "lucide-react";

export const dynamic = "force-dynamic";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

export default async function SettingsHome() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);

  // Smart suggestions based on what's missing
  const suggestions: Array<{ done: boolean; label: string; href: string }> = [];
  suggestions.push({ done: branches.length > 0, label: "สร้างสาขาแรก", href: "/playland/settings/branches" });
  if (branches.length > 0) {
    const [pkgCount, productCount, deviceCount] = await Promise.all([
      prisma.playlandPackage.count({ where: { orgId, active: true } }),
      prisma.playlandProduct.count({ where: { orgId, active: true } }),
      prisma.playlandDevice.count({ where: { orgId } }),
    ]);
    suggestions.push({ done: pkgCount > 0, label: "สร้างแพ็กเกจเวลาอย่างน้อย 1", href: "/playland/settings/packages" });
    suggestions.push({ done: productCount > 0, label: "เพิ่มขนม · เครื่องดื่มใน POS", href: "/playland/settings/products" });
    suggestions.push({ done: productCount > 0, label: "นับสต๊อกสินค้าให้ตรง", href: "/playland/settings/stock-count" });
    suggestions.push({ done: deviceCount > 0, label: "ผูกเครื่องสแกน (หรือใช้ mock ก่อน)", href: "/playland/settings/devices" });
  }

  const remaining = suggestions.filter((s) => !s.done);

  return (
    <div style={{ padding: "32px 24px", maxWidth: 660, margin: "0 auto", fontFamily: MITR, color: "#3A3026" }}>
      <div style={{ marginBottom: 26 }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#8a7f70", letterSpacing: "0.04em", marginBottom: 8 }}>ตั้งค่าร้าน</div>
        <h2 style={{ fontFamily: FREDOKA, fontSize: "1.85rem", fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 6, lineHeight: 1.15 }}>
          {remaining.length === 0 ? "พร้อมรับลูกค้าแล้ว 🎉" : "ตั้งค่าให้ครบก่อนเริ่ม"}
        </h2>
        <div style={{ color: "#8a7f70", fontSize: "0.95rem" }}>
          {remaining.length === 0
            ? "ทุกอย่างพร้อม · กลับไปหน้าร้านเริ่มรับลูกค้าได้เลย"
            : `เหลืออีก ${remaining.length} ขั้นตอน · ทำตามด้านล่าง`}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {suggestions.map((s) => (
          <Link
            key={s.href + s.label}
            href={s.href}
            style={{
              textDecoration: "none", color: "inherit",
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
              background: "#fff", border: `1px solid ${s.done ? "#ece5d8" : "#fadf8c"}`,
              borderRadius: 16, padding: "16px 18px",
              boxShadow: "0 1px 2px rgba(58,48,38,0.04)",
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
              <div
                style={{
                  width: 30, height: 30, borderRadius: 999, flexShrink: 0,
                  background: s.done ? "#1F8A5B" : "#F0B323", color: "#fff",
                  display: "grid", placeItems: "center", fontSize: 14, fontWeight: 700,
                }}
              >
                {s.done ? <Check size={16} /> : "•"}
              </div>
              <span style={{ fontWeight: 500, textDecoration: s.done ? "line-through" : "none", opacity: s.done ? 0.55 : 1 }}>
                {s.label}
              </span>
            </div>
            <ArrowRight size={16} color="#c9bfae" style={{ flexShrink: 0 }} />
          </Link>
        ))}
      </div>

      {remaining.length === 0 && (
        <Link
          href="/playland"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            marginTop: 26, width: "100%", textDecoration: "none",
            background: "#2D6CB1", color: "#fff", borderRadius: 16,
            padding: "15px", fontWeight: 600, fontSize: "1rem",
            boxShadow: "0 2px 8px rgba(45,108,177,0.25)",
          }}
        >
          กลับหน้าร้าน · เริ่มเลย →
        </Link>
      )}
    </div>
  );
}
