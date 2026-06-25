"use client";

// Playland · เมนูล่างมือถือ (bottom nav) — โชว์ ≤900px (.pl-mobile-nav จาก playland.css)
// 4 แท็บหลัก (เจ้าของ/ผู้จัดการเปิดมือถือ) + "เพิ่มเติม" เปิด sheet เข้าถึงทุกฟีเจอร์ (จัดกลุ่ม · กรองตามสิทธิ์)
// ซ่อนบนหน้าร้าน kiosk (/playland) ที่มี UI ของตัวเอง + หน้าพิมพ์

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, BarChart3, Boxes, Users, Menu, X, ChevronRight,
  Store, LogIn, CalendarClock, MonitorSmartphone, Coins, ShieldCheck,
  Building2, Settings, ScanFace, Wrench, DoorOpen, Percent,
  AlertTriangle, ClipboardCheck, PackageSearch,
} from "lucide-react";

type Item = { href: string; icon: typeof Store; label: string; admin?: boolean };

// แท็บหลัก = หน้าหลังบ้านจริงเท่านั้น (ไม่ redirect เข้า kiosk → เมนูล่างไม่หาย)
const MAIN: { href: string; icon: typeof Store; label: string; badge?: boolean }[] = [
  { href: "/playland/office", icon: LayoutDashboard, label: "ภาพรวม", badge: true },
  { href: "/playland/reports", icon: BarChart3, label: "รายงาน" },
  { href: "/playland/stock", icon: Boxes, label: "สต๊อก" },
  { href: "/playland/shifts", icon: Coins, label: "กะ·เงิน" },
];

const SHEET: { title: string; items: Item[] }[] = [
  { title: "งานหน้าร้าน", items: [
    { href: "/playland", icon: Store, label: "หน้าร้าน · POS" },
    { href: "/playland/checkin", icon: LogIn, label: "เช็คอินเด็ก" },
    { href: "/playland/members", icon: Users, label: "สมาชิก" },
    { href: "/playland/bookings", icon: CalendarClock, label: "จองล่วงหน้า" },
    { href: "/playland/monitor", icon: MonitorSmartphone, label: "มอนิเตอร์ (จอกำลังเล่น)" },
  ] },
  { title: "การเงิน", items: [
    { href: "/playland/audit", icon: ShieldCheck, label: "Audit Log", admin: true },
    { href: "/playland/overrides", icon: DoorOpen, label: "เปิดประตูเอง (กันโกง)", admin: true },
  ] },
  { title: "ความปลอดภัย & ดูแล", items: [
    { href: "/playland/incidents", icon: AlertTriangle, label: "บันทึกอุบัติเหตุ/เหตุการณ์" },
    { href: "/playland/safety", icon: ClipboardCheck, label: "ตรวจความปลอดภัย/ทำความสะอาด" },
    { href: "/playland/lost-found", icon: PackageSearch, label: "ของหาย-ของเก็บได้" },
    { href: "/playland/repairs", icon: Wrench, label: "บันทึกซ่อม" },
  ] },
  { title: "จัดการร้าน", items: [
    { href: "/playland/settings/branches", icon: Building2, label: "ทีม & สาขา", admin: true },
    { href: "/playland/settings", icon: Settings, label: "ตั้งค่า · Packages · สินค้า", admin: true },
    { href: "/playland/settings/promos", icon: Percent, label: "โปรโมชั่น / ส่วนลด", admin: true },
    { href: "/playland/settings/devices", icon: ScanFace, label: "อุปกรณ์ประตู", admin: true },
  ] },
];

export function MobileBottomNav({ canManage = false }: { canManage?: boolean }) {
  const pathname = usePathname();
  const [alertCount, setAlertCount] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  // badge แจ้งเตือนบนแท็บภาพรวม (poll 30 วิ)
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/playland/alerts/count", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (typeof data?.count === "number") setAlertCount(data.count);
      } catch { /* เงียบ · อย่าให้ counter ทำ nav พัง */ }
    };
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ปิด sheet เมื่อเปลี่ยนหน้า + ล็อก scroll พื้นหลังตอนเปิด sheet
  useEffect(() => { setSheetOpen(false); }, [pathname]);
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sheetOpen]);

  // ซ่อนบน kiosk หน้าร้าน (มี UI ของตัวเอง) + หน้าพิมพ์
  if (pathname === "/playland" || pathname.includes("/print")) return null;

  const isActive = (href: string) => pathname === href || (href !== "/playland" && pathname.startsWith(href));
  const groups = SHEET.map((g) => ({ ...g, items: g.items.filter((it) => !it.admin || canManage) })).filter((g) => g.items.length > 0);

  return (
    <>
      {sheetOpen && (
        <>
          <div className="pl-mnav-sheet-backdrop" onClick={() => setSheetOpen(false)} aria-hidden="true" />
          <div className="pl-mnav-sheet" role="dialog" aria-label="เมนูเพิ่มเติม">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 16, fontFamily: "var(--font-fredoka), 'Fredoka', sans-serif", color: "var(--pl-brand-dark, #3A3026)" }}>เมนูทั้งหมด</div>
              <button onClick={() => setSheetOpen(false)} aria-label="ปิด" style={{ marginLeft: "auto", width: 40, height: 40, display: "grid", placeItems: "center", border: "none", background: "transparent", color: "var(--pl-text-muted, #8a7f70)", cursor: "pointer" }}><X size={22} /></button>
            </div>
            {groups.map((g) => (
              <div key={g.title} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--pl-text-muted, #8a7f70)", padding: "2px 4px 8px" }}>{g.title}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {g.items.map((it) => {
                    const Icon = it.icon;
                    return (
                      <Link key={it.href} href={it.href} onClick={() => setSheetOpen(false)}
                        style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 12px", minHeight: 52, borderRadius: 13, background: isActive(it.href) ? "#eaf2fb" : "#fff", border: "1px solid var(--pl-line, #ece5d8)", textDecoration: "none", color: "var(--pl-brand-dark, #3A3026)" }}>
                        <span style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 9, background: "#f4efe6", color: "var(--pl-blue, #2D6CB1)", flexShrink: 0 }}><Icon size={18} /></span>
                        <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{it.label}</span>
                        <ChevronRight size={16} color="#c9bfae" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <nav aria-label="Playland mobile navigation" className="pl-mobile-nav"
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60,
          background: "rgba(255, 252, 245, 0.97)",
          backdropFilter: "saturate(180%) blur(14px)", WebkitBackdropFilter: "saturate(180%) blur(14px)",
          borderTop: "1px solid var(--pl-line, #ece5d8)", boxShadow: "0 -2px 16px rgba(28, 25, 23, 0.06)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)" }}>
          {MAIN.map((it) => {
            const Icon = it.icon;
            const active = isActive(it.href);
            const badge = it.badge ? alertCount : 0;
            return (
              <Link key={it.href} href={it.href}
                aria-label={badge > 0 ? `${it.label} · ${badge} แจ้งเตือน` : it.label}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "9px 4px 10px", minHeight: 56, justifyContent: "center", color: active ? "var(--pl-brand-dark, #3A3026)" : "var(--pl-text-muted, #8a7f70)", textDecoration: "none", fontSize: 10.5, fontWeight: 600, position: "relative" }}>
                <span style={{ position: "relative" }}>
                  <Icon size={21} strokeWidth={active ? 2.4 : 1.8} />
                  {badge > 0 && (
                    <span aria-hidden="true" style={{ position: "absolute", top: -5, right: -9, background: "var(--pl-danger, #E74C3C)", color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 999, padding: "1px 5px", minWidth: 16, height: 15, lineHeight: "13px", textAlign: "center", boxShadow: "0 0 0 2px var(--pl-paper, #fff)" }}>{badge > 9 ? "9+" : badge}</span>
                  )}
                </span>
                <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                {active && <span aria-hidden="true" style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 28, height: 3, background: "var(--pl-brand, #2D6CB1)", borderRadius: "0 0 3px 3px" }} />}
              </Link>
            );
          })}
          <button onClick={() => setSheetOpen(true)} aria-label="เพิ่มเติม"
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "9px 4px 10px", minHeight: 56, justifyContent: "center", color: sheetOpen ? "var(--pl-brand-dark, #3A3026)" : "var(--pl-text-muted, #8a7f70)", background: "transparent", border: "none", cursor: "pointer", fontSize: 10.5, fontWeight: 600, fontFamily: "inherit" }}>
            <Menu size={21} strokeWidth={1.8} />
            <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>เพิ่มเติม</span>
          </button>
        </div>
      </nav>
    </>
  );
}
