// Settings hub · clean white tile grid (locked "Play a lot" · matches office cards)
// Renders inside settings/layout (white shell + rail) → content = grouped tiles

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { canPlaylandAdmin } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { Building2, Package, ShoppingBasket, Boxes, ScanFace, ShieldCheck, ChevronRight, type LucideIcon } from "lucide-react";

export const dynamic = "force-dynamic";

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", AMBER = "#a9791a", LINE = "#ece5d8";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

interface Tile { href: string; icon: LucideIcon; title: string; gloss: string; count: number; tint: string; done?: boolean }

export default async function SettingsHome() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);

  const [pkgCount, productCount, deviceCount] = branches.length > 0
    ? await Promise.all([
        prisma.playlandPackage.count({ where: { orgId, active: true } }),
        prisma.playlandProduct.count({ where: { orgId, active: true } }),
        prisma.playlandDevice.count({ where: { orgId } }),
      ])
    : [0, 0, 0];

  // กลุ่มที่ 1 · พื้นฐานร้าน
  const setupTiles: Tile[] = [
    { href: "/playland/settings/branches", icon: Building2, title: "สาขา & ทีม", gloss: "พื้นที่ทำธุรกิจ · ผูกพนักงานเข้าสาขา", count: branches.length, tint: BLUE, done: branches.length > 0 },
  ];
  // กลุ่มที่ 2 · ราคา & สินค้า
  const catalogTiles: Tile[] = [
    { href: "/playland/settings/packages", icon: Package, title: "Packages", gloss: "ราคาเข้าเล่น · เหมารอบ · Day Pass · คิดนาที", count: pkgCount, tint: BLUE, done: pkgCount > 0 },
    { href: "/playland/settings/products", icon: ShoppingBasket, title: "สินค้า POS", gloss: "ขนม · เครื่องดื่ม · ของขายหน้าร้าน", count: productCount, tint: AMBER, done: productCount > 0 },
    { href: "/playland/settings/stock-count", icon: Boxes, title: "นับสต๊อก", gloss: "ปรับจำนวนคงเหลือให้ตรงของจริง", count: productCount, tint: GREEN },
  ];
  // กลุ่มที่ 3 · งานดูแลร้าน (ตั้งค่า = ผู้ดูแลเท่านั้น)
  const careTiles: Tile[] = canPlaylandAdmin(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))
    ? [{ href: "/playland/settings/care", icon: ShieldCheck, title: "ตั้งค่างานดูแลร้าน", gloss: "เช็กลิสต์ความปลอดภัย · ตั้งทีละสาขา", count: branches.length, tint: GREEN }]
    : [];
  // กลุ่มที่ 4 · อุปกรณ์ (super_admin)
  const deviceTiles: Tile[] = isSuperAdmin(session.user.role)
    ? [{ href: "/playland/settings/devices", icon: ScanFace, title: "อุปกรณ์ / ACS", gloss: "เครื่องสแกนหน้า · ประตูเข้า-ออก", count: deviceCount, tint: INK }]
    : [];

  const groups: Array<{ head: string; tiles: Tile[] }> = [
    { head: "พื้นฐานร้าน", tiles: setupTiles },
    { head: "ราคา & สินค้า", tiles: catalogTiles },
    ...(careTiles.length ? [{ head: "งานดูแลร้าน", tiles: careTiles }] : []),
    ...(deviceTiles.length ? [{ head: "อุปกรณ์", tiles: deviceTiles }] : []),
  ];

  return (
    <div style={{ fontFamily: MITR, color: INK, padding: "26px 28px 48px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: "1.2rem", fontWeight: 600, fontFamily: FREDOKA }}>ตั้งค่าร้าน</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>เลือกหมวดที่ต้องการแก้ไข · กดการ์ดเพื่อเข้าไปจัดการ</div>
      </div>

      {groups.map((g) => (
        <section key={g.head} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: MUTED, marginBottom: 11 }}>{g.head}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {g.tiles.map((t) => {
              const Icon = t.icon;
              return (
                <Link key={t.href} href={t.href} style={{ ...card, display: "flex", alignItems: "center", gap: 14, padding: 16, textDecoration: "none", color: INK }}>
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: `${t.tint}14`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={20} color={t.tint} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{t.title}</span>
                      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: t.tint, background: `${t.tint}14`, borderRadius: 99, padding: "1px 8px" }}>{t.count}</span>
                      {t.done && <span style={{ fontSize: 11, color: GREEN }}>✓</span>}
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.gloss}</div>
                  </div>
                  <ChevronRight size={17} color="#c9bfae" style={{ flexShrink: 0 }} />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
