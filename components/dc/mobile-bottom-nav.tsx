"use client";

// DC · เมนูแถบล่าง (mobile bottom nav) — ทำงานหน้าคลัง + หลังบ้าน ผ่านมือถือสะดวก
// แสดงเฉพาะจอเล็ก (<1024px · class dc-mobile-nav ใน dc.css) · เดสก์ท็อปใช้ sidebar
// 4 แท็บด่วน + ปุ่ม "เมนู" เปิดชีตรวมทุกฟีเจอร์ (จัดกลุ่ม หน้าคลัง/หลังบ้าน)

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes, PackagePlus, ShoppingCart, BarChart3, LayoutGrid, X,
  Truck, ArrowLeftRight, ClipboardCheck, PackageMinus, Search, QrCode,
  Building2, Ship, Warehouse, Users, GitCompare, LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon };

// ---- 4 แท็บด่วนล่าง (floor + office) ----
function quickTabs(canManage: boolean): Item[] {
  if (canManage) {
    return [
      { href: "/dc", label: "หน้าคลัง", icon: Boxes },
      { href: "/dc/receive-po", label: "รับของ", icon: PackagePlus },
      { href: "/dc/office/purchasing", label: "สั่งซื้อ", icon: ShoppingCart },
      { href: "/dc/office/reports", label: "รายงาน", icon: BarChart3 },
    ];
  }
  // floor-only (staff)
  return [
    { href: "/dc", label: "หน้าคลัง", icon: Boxes },
    { href: "/dc/receive", label: "รับเข้า", icon: PackagePlus },
    { href: "/dc/count", label: "นับ", icon: ClipboardCheck },
    { href: "/dc/issue", label: "เบิกออก", icon: PackageMinus },
  ];
}

const FLOOR_MENU: Item[] = [
  { href: "/dc", label: "หน้าหลัก", icon: Boxes },
  { href: "/dc/receive", label: "รับเข้า", icon: PackagePlus },
  { href: "/dc/receive-po", label: "รับตาม PO", icon: PackagePlus },
  { href: "/dc/transfer", label: "ส่ง / โอน", icon: Truck },
  { href: "/dc/move", label: "ย้ายที่", icon: ArrowLeftRight },
  { href: "/dc/count", label: "นับสต๊อก", icon: ClipboardCheck },
  { href: "/dc/issue", label: "เบิกออก", icon: PackageMinus },
  { href: "/dc/search", label: "ค้นหา", icon: Search },
  { href: "/dc/labels", label: "ปริ้นฉลาก", icon: QrCode },
];

const OFFICE_MENU: Item[] = [
  { href: "/dc/office", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/dc/office/purchasing", label: "สั่งซื้อ", icon: ShoppingCart },
  { href: "/dc/office/suppliers", label: "ผู้ขาย", icon: Building2 },
  { href: "/dc/office/products", label: "สินค้า", icon: Boxes },
  { href: "/dc/office/shipments", label: "ขนส่ง", icon: Ship },
  { href: "/dc/office/receipts", label: "ใบรับสินค้า", icon: ClipboardCheck },
  { href: "/dc/office/transfers", label: "การโอน", icon: Truck },
  { href: "/dc/office/warehouses", label: "โกดัง", icon: Warehouse },
  { href: "/dc/office/reports", label: "รายงาน", icon: BarChart3 },
  { href: "/dc/office/reconcile", label: "กระทบยอด", icon: GitCompare },
  { href: "/dc/office/permissions", label: "สิทธิ์", icon: Users },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dc") return pathname === "/dc";
  if (href === "/dc/office") return pathname === "/dc/office";
  return pathname === href || pathname.startsWith(href + "/");
}

export function DcMobileNav({ canManage }: { canManage: boolean }) {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  const tabs = quickTabs(canManage);

  return (
    <>
      {/* full-menu sheet */}
      {open && (
        <div className="dc-msheet" onClick={() => setOpen(false)}>
          <div className="dc-msheet__panel" onClick={(e) => e.stopPropagation()}>
            <div className="dc-msheet__head">
              <span>เมนูทั้งหมด</span>
              <button type="button" aria-label="ปิด" onClick={() => setOpen(false)}><X size={20} /></button>
            </div>
            <div className="dc-msheet__group">หน้าคลัง</div>
            <div className="dc-msheet__grid">
              {FLOOR_MENU.map((it) => (
                <Link key={it.href} href={it.href} onClick={() => setOpen(false)}
                  className={`dc-msheet__item${isActive(pathname, it.href) ? " is-active" : ""}`}>
                  <it.icon size={22} /><span>{it.label}</span>
                </Link>
              ))}
            </div>
            {canManage && (
              <>
                <div className="dc-msheet__group">หลังบ้าน</div>
                <div className="dc-msheet__grid">
                  {OFFICE_MENU.map((it) => (
                    <Link key={it.href} href={it.href} onClick={() => setOpen(false)}
                      className={`dc-msheet__item${isActive(pathname, it.href) ? " is-active" : ""}`}>
                      <it.icon size={22} /><span>{it.label}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* bottom bar */}
      <nav className="dc-mobile-nav" aria-label="เมนูแถบล่าง DC">
        {tabs.map((it) => {
          const active = isActive(pathname, it.href);
          return (
            <Link key={it.href} href={it.href} className={`dc-mnav__tab${active ? " is-active" : ""}`} aria-label={it.label}>
              <it.icon size={21} strokeWidth={active ? 2.4 : 1.9} />
              <span>{it.label}</span>
            </Link>
          );
        })}
        <button type="button" className={`dc-mnav__tab${open ? " is-active" : ""}`} onClick={() => setOpen(true)} aria-label="เมนูทั้งหมด">
          <LayoutGrid size={21} strokeWidth={open ? 2.4 : 1.9} />
          <span>เมนู</span>
        </button>
      </nav>
    </>
  );
}
