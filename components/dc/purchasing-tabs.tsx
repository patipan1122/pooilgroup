"use client";

// DC · แท็บรวมเมนูจัดซื้อ — ใบสั่งซื้อ / ผู้ขาย / สินค้า (active ตาม pathname)
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart, Building2, Boxes } from "lucide-react";

const TABS = [
  { href: "/dc/office/purchasing", label: "ใบสั่งซื้อ", icon: ShoppingCart },
  { href: "/dc/office/suppliers", label: "ผู้ขาย", icon: Building2 },
  { href: "/dc/office/products", label: "สินค้า", icon: Boxes },
] as const;

export function PurchasingTabs() {
  const pathname = usePathname() || "";
  return (
    <div className="dc-subtabs" role="tablist" aria-label="เมนูจัดซื้อ">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            className={`dc-subtab${active ? " is-active" : ""}`}
          >
            <t.icon size={16} strokeWidth={active ? 2.4 : 2} /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
