"use client";

// แถบ "3 จังหวะ" ของงานหน้าร้าน — หน้าหลัก → ระหว่างเล่น → เช็คเอาท์
// (งานเดียวต่อเนื่อง ไม่ใช่ 3 เมนูแข่งกัน) · active ตาม pathname

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Clock, LogOut } from "lucide-react";

const RHYTHMS = [
  { r: "home", href: "/playland", label: "หน้าหลัก", icon: Home },
  { r: "board", href: "/playland/board", label: "ระหว่างเล่น", icon: Clock },
  { r: "checkout", href: "/playland/checkout", label: "เช็คเอาท์", icon: LogOut },
] as const;

export function RhythmNav({ branchId }: { branchId?: string }) {
  const pathname = usePathname() || "";
  const q = branchId ? `?branch=${branchId}` : "";
  return (
    <div className="pl-rhythm" role="tablist" aria-label="3 จังหวะงานหน้าร้าน">
      {RHYTHMS.map(({ r, href, label, icon: Icon }) => {
        const active = href === "/playland" ? pathname === "/playland" : pathname.startsWith(href);
        return (
          <Link
            key={r}
            href={`${href}${q}`}
            data-r={r}
            role="tab"
            aria-selected={active}
            className={active ? "is-active" : ""}
          >
            <Icon size={15} strokeWidth={active ? 2.4 : 1.9} /> {label}
          </Link>
        );
      })}
    </div>
  );
}
