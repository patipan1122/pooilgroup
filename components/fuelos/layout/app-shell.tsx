"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, MessagesSquare, Users, FileText, ClipboardList,
  Tag, Truck, Wallet, BarChart3, Settings, Fuel, LogOut, Menu, X,
} from "lucide-react";
import { cn } from "@/lib/fuelos/utils/cn";
import { logoutAction } from "@/lib/auth/actions";

type Role = "OWNER" | "ADMIN" | "SALES_HEAD" | "FINANCE" | "DISPATCH" | "SALES" | "DRIVER";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
  mobile?: boolean; // โชว์ใน bottom nav มือถือ
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "หน้าหลัก", icon: LayoutDashboard, mobile: true },
  { href: "/inbox", label: "แชท", icon: MessagesSquare, mobile: true },
  { href: "/customers", label: "ลูกค้า", icon: Users, mobile: true },
  { href: "/orders", label: "ออเดอร์", icon: ClipboardList, mobile: true },
  { href: "/quotes", label: "ใบเสนอราคา", icon: FileText },
  { href: "/pricing", label: "ราคาน้ำมัน", icon: Tag },
  { href: "/dispatch", label: "จัดส่ง + GPS", icon: Truck, roles: ["OWNER", "ADMIN", "DISPATCH", "SALES_HEAD"] },
  { href: "/finance", label: "การเงิน", icon: Wallet, roles: ["OWNER", "ADMIN", "FINANCE"] },
  { href: "/reports", label: "รายงาน", icon: BarChart3, roles: ["OWNER", "ADMIN", "SALES_HEAD"] },
  { href: "/settings", label: "ตั้งค่า", icon: Settings, roles: ["OWNER", "ADMIN"] },
];

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "เจ้าของ", ADMIN: "แอดมิน", SALES_HEAD: "หัวหน้าขาย",
  FINANCE: "การเงิน", DISPATCH: "จัดส่ง", SALES: "เซลล์", DRIVER: "คนขับ",
};

function canSee(item: NavItem, role: Role) {
  return !item.roles || item.roles.includes(role);
}

export function AppShell({
  user,
  children,
}: {
  user: { name: string; role: Role };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const items = NAV.filter((i) => canSee(i, user.role));
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-dvh bg-surface-2">
      {/* desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-border bg-surface">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
          <div className="size-9 rounded-xl bg-brand-600 grid place-items-center text-white">
            <Fuel className="size-5" />
          </div>
          <div>
            <div className="font-bold leading-none">PO Oil</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">ขายส่งน้ำมัน</div>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 h-11 rounded-xl text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-zinc-600 hover:bg-surface-2 hover:text-zinc-900",
              )}
            >
              <item.icon className="size-[18px]" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="px-3 py-2">
            <div className="text-sm font-semibold truncate">{user.name}</div>
            <div className="text-[11px] text-zinc-500">{ROLE_LABEL[user.role]}</div>
          </div>
          <form action={logoutAction}>
            <button className="flex items-center gap-2 w-full px-3 h-9 rounded-lg text-sm text-zinc-500 hover:text-danger hover:bg-danger/5">
              <LogOut className="size-4" /> ออกจากระบบ
            </button>
          </form>
        </div>
      </aside>

      {/* mobile topbar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border bg-surface/90 backdrop-blur">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-brand-600 grid place-items-center text-white">
            <Fuel className="size-4" />
          </div>
          <span className="font-bold">PO Oil</span>
        </Link>
        <button onClick={() => setDrawer(true)} className="size-9 grid place-items-center rounded-lg hover:bg-surface-2">
          <Menu className="size-5" />
        </button>
      </header>

      {/* mobile drawer (full menu) */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute right-0 inset-y-0 w-72 bg-surface p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <span className="font-bold">เมนู</span>
              <button onClick={() => setDrawer(false)} className="size-9 grid place-items-center rounded-lg hover:bg-surface-2">
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-0.5">
              {items.map((item) => (
                <Link
                  key={item.href} href={item.href} onClick={() => setDrawer(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 h-11 rounded-xl text-sm font-medium",
                    isActive(item.href) ? "bg-brand-50 text-brand-700" : "text-zinc-700 hover:bg-surface-2",
                  )}
                >
                  <item.icon className="size-[18px]" /> {item.label}
                </Link>
              ))}
            </nav>
            <div className="pt-3 border-t border-border">
              <div className="px-3 py-1.5 text-sm font-semibold">{user.name}</div>
              <div className="px-3 text-[11px] text-zinc-500 mb-2">{ROLE_LABEL[user.role]}</div>
              <form action={logoutAction}>
                <button className="flex items-center gap-2 w-full px-3 h-10 rounded-lg text-sm text-danger hover:bg-danger/5">
                  <LogOut className="size-4" /> ออกจากระบบ
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* content */}
      <main className="lg:pl-60 pb-20 lg:pb-0 min-h-dvh">
        <div className="mx-auto max-w-6xl p-4 sm:p-6">{children}</div>
      </main>

      {/* mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur">
        {NAV.filter((i) => i.mobile && canSee(i, user.role)).map((item) => (
          <Link
            key={item.href} href={item.href}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 h-16 text-[11px] font-medium",
              isActive(item.href) ? "text-brand-700" : "text-zinc-500",
            )}
          >
            <item.icon className="size-5" />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
