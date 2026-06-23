// Playland · "Play a lot" — หลังบ้าน · Command Hub
//
// Landing ของโหมดหลังร้าน · อ่านสบายเหมือนหน้าร้าน (kiosk look):
//   • พื้นครีม · การ์ดขาวขอบนุ่ม · เลข Fredoka · เว้นช่องหายใจเยอะ
//   • KPI สด + 3 หมวดงานชัดเจน · ทุกไทล์เป็นลิงก์จริง (ไม่มี dead UI · ไม่มีโปรโม)
// ไม่ย้าย route เดิม → ลิงก์ทุกหน้ายังทำงาน · หน้าปลายทางคุม role gate ของตัวเอง

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/module-access";
import { requirePlaylandAccess } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getTodayStats, listBranches, listPackages, listProducts } from "@/lib/playland/queries";
import { thb } from "@/lib/playland/format";
import {
  BarChart3, Clock, Package, Cookie, Building2, Boxes,
  ScanFace, DoorOpen, History, ArrowRight, Store, Baby, Wallet,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "หลังบ้าน · Play a lot" };

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

type Tile = {
  href: string;
  title: string;
  gloss: string;
  icon: React.ComponentType<{ size?: number }>;
  count?: number;
  tint: { bg: string; fg: string };
};

// ───────── Playalot tinted icon chips (จากหน้าร้าน) ─────────
const BLUE = { bg: "#eaf3f6", fg: "#2D6CB1" };
const AMBER = { bg: "#fdf3df", fg: "#a9791a" };
const GREEN = { bg: "#eaf3eb", fg: "#1F8A5B" };
const RED = { bg: "#fdeceb", fg: "#E74C3C" };

export default async function PlaylandOfficeHub() {
  const session = await requireSession();
  requirePlaylandAccess(session.user.role);
  const orgId = session.user.org_id;
  const admin = isAdminTier(session.user.role);

  // ── ดึงข้อมูลจริง (reuse queries เดิม · ไม่สร้าง data layer ใหม่) ──
  const branches = await listBranches(orgId);
  const firstBranchId = branches[0]?.id;
  const [stats, packages, products, openShiftCount] = await Promise.all([
    getTodayStats(orgId),
    listPackages(orgId),
    firstBranchId ? listProducts(orgId, firstBranchId) : Promise.resolve([]),
    prisma.playlandShift.count({ where: { orgId, status: "OPEN" } }),
  ]);

  const kpis = [
    { label: "รายได้วันนี้", value: thb(stats.totalRevenueCents), tint: GREEN, icon: Wallet },
    { label: "เด็กกำลังเล่น", value: String(stats.activeSessions), tint: BLUE, icon: Baby },
    { label: "กะที่เปิดอยู่", value: `${openShiftCount} / ${branches.length || "—"}`, sub: "เปิด · สาขา", tint: AMBER, icon: Clock },
  ];

  const groupReports: Tile[] = [
    { href: "/playland/reports", title: "รายงานยอดขาย", gloss: "ยอดขาย · จำนวนเด็ก · สรุปรายวัน/เดือน", icon: BarChart3, tint: BLUE },
    { href: "/playland/shifts", title: "ประวัติกะ · ปิดวัน", gloss: "เปิด/ปิดกะ · นับเงิน · ตรวจ variance", icon: Clock, tint: AMBER },
  ];

  const groupSettings: Tile[] = [
    { href: "/playland/settings/packages", title: "แพ็กเกจเวลา", gloss: "ราคาเข้าเล่น · day pass", icon: Package, count: packages.length, tint: AMBER },
    { href: "/playland/settings/products", title: "ขนม · เครื่องดื่ม", gloss: "สินค้าใน POS หน้าร้าน", icon: Cookie, count: products.length, tint: GREEN },
    { href: "/playland/settings/branches", title: "สาขา", gloss: "พื้นที่ทำธุรกิจ", icon: Building2, count: branches.length, tint: BLUE },
    { href: "/playland/settings/stock-count", title: "นับสต๊อก", gloss: "เช็คจำนวนสินค้าคงเหลือ", icon: Boxes, tint: GREEN },
  ];

  const groupSystem: Tile[] = [
    { href: "/playland/settings/devices", title: "อุปกรณ์ · เครื่องสแกน", gloss: "ผูกเครื่องอ่านหน้า · สถานะ", icon: ScanFace, tint: BLUE },
    { href: "/playland/overrides", title: "เปิดประตูเอง · log", gloss: "สั่งเปิดประตูด้วยมือ · บันทึกเหตุผล", icon: DoorOpen, tint: RED },
    { href: "/playland/audit", title: "Audit Log", gloss: "ประวัติการกระทำทั้งหมดในระบบ", icon: History, tint: AMBER },
  ];

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#F7F2EA", fontFamily: MITR, color: "#3A3026" }}>
      {/* ───────── Header ───────── */}
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          padding: "20px 28px", background: "#fff", borderBottom: "1px solid #ece5d8",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/playland/brand/mascot-skye.png" alt="" width={52} height={52} style={{ objectFit: "contain", flexShrink: 0 }} />
          <div>
            <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.5rem", lineHeight: 1, letterSpacing: "-0.01em" }}>
              <span style={{ color: "#2D6CB1" }}>Play</span>{" "}
              <span style={{ color: "#F0B323" }}>a</span>{" "}
              <span style={{ color: "#2D6CB1" }}>lot</span>
            </div>
            <div style={{ fontSize: "0.95rem", color: "#8a7f70", marginTop: 4 }}>หลังบ้าน · จัดการร้าน</div>
          </div>
        </div>
        <Link
          href="/playland"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "#2D6CB1", color: "#fff", textDecoration: "none",
            padding: "12px 20px", borderRadius: 999, fontWeight: 600, fontSize: "0.95rem",
            boxShadow: "0 2px 8px rgba(45,108,177,0.25)",
          }}
        >
          <Store size={17} /> ไปหน้าร้าน (Play a lot) →
        </Link>
      </header>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 28px 48px" }}>
        {/* ───────── KPI strip ───────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 36 }}>
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <div
                key={k.label}
                style={{
                  background: "#fff", border: "1px solid #ece5d8", borderRadius: 18,
                  padding: "20px 22px", display: "flex", alignItems: "center", gap: 16,
                }}
              >
                <div style={{ width: 48, height: 48, borderRadius: 14, background: k.tint.bg, color: k.tint.fg, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon size={24} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.82rem", color: "#8a7f70", marginBottom: 3 }}>{k.label}</div>
                  <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.75rem", lineHeight: 1, color: "#3A3026", fontVariantNumeric: "tabular-nums" }}>
                    {k.value}
                  </div>
                  {"sub" in k && k.sub ? <div style={{ fontSize: "0.72rem", color: "#a89c8b", marginTop: 3 }}>{k.sub}</div> : null}
                </div>
              </div>
            );
          })}
        </div>

        <HubGroup title="ดูผลประกอบการ" tiles={groupReports} />
        <HubGroup title="ตั้งค่าร้าน" tiles={groupSettings} />
        {admin && <HubGroup title="ระบบ · ความปลอดภัย" tiles={groupSystem} />}
      </div>
    </div>
  );
}

// ───────── หมวด + การ์ดไทล์ (kiosk card style) ─────────
function HubGroup({ title, tiles }: { title: string; tiles: Tile[] }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2
        style={{
          fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", color: "#3A3026",
          margin: "0 0 14px 2px", letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))", gap: 16 }}>
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              style={{
                display: "flex", alignItems: "flex-start", gap: 14,
                background: "#fff", border: "1px solid #ece5d8", borderRadius: 18,
                padding: "20px", textDecoration: "none", color: "inherit",
                boxShadow: "0 1px 2px rgba(58,48,38,0.04)",
              }}
            >
              <div style={{ width: 46, height: 46, borderRadius: 13, background: t.tint.bg, color: t.tint.fg, display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.02rem", color: "#3A3026" }}>{t.title}</span>
                  {typeof t.count === "number" && (
                    <span
                      style={{
                        fontFamily: FREDOKA, fontWeight: 600, fontSize: "0.72rem",
                        background: "#f4ede0", color: "#8a7f70", borderRadius: 999,
                        padding: "2px 9px", lineHeight: 1.6,
                      }}
                    >
                      {t.count}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.82rem", color: "#8a7f70", lineHeight: 1.5, marginTop: 4 }}>{t.gloss}</div>
              </div>
              <ArrowRight size={17} color="#c9bfae" style={{ flexShrink: 0, marginTop: 4 }} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
