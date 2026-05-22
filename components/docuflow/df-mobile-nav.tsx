"use client";

// DocuFlow · Mobile Bottom Nav (canvas DesktopShell mobile mode)
// ────────────────────────────────────────────────────────────────────
// 5-item fixed bottom nav · matches canvas mobile-screens.jsx exactly:
//   หน้าหลัก / เอกสาร / [upload primary] / ต่ออายุ / ฉัน
// Visible only on mobile (display:none above 768px via CSS).
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Folder,
  Upload,
  Clock,
  User as UserIcon,
} from "lucide-react";

interface NavItem {
  id: string;
  href: string;
  icon: typeof Home;
  label?: string;
  primary?: boolean;
}

const ITEMS: NavItem[] = [
  { id: "home", href: "/docuflow", icon: Home, label: "หน้าหลัก" },
  { id: "docs", href: "/docuflow/browse", icon: Folder, label: "เอกสาร" },
  {
    id: "upload",
    href: "/docuflow/documents/upload",
    icon: Upload,
    primary: true,
  },
  { id: "renew", href: "/docuflow/expiry", icon: Clock, label: "ต่ออายุ" },
  { id: "me", href: "/docuflow/notifications", icon: UserIcon, label: "ฉัน" },
];

export function DfMobileBottomNav({ badgeRenew = 0 }: { badgeRenew?: number }) {
  const pathname = usePathname() ?? "";

  // Match logic — exact /docuflow → home, prefix matches for others
  const isActive = (href: string) => {
    if (href === "/docuflow") return pathname === "/docuflow";
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="df-mobile-nav"
      aria-label="DocuFlow"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        background: "rgba(255, 251, 244, 0.94)",
        backdropFilter: "saturate(140%) blur(12px)",
        WebkitBackdropFilter: "saturate(140%) blur(12px)",
        borderTop: "1px solid var(--df-line-soft)",
        padding: "8px 16px max(8px, env(safe-area-inset-bottom))",
        display: "none",
        justifyContent: "space-around",
        alignItems: "center",
      }}
    >
      {ITEMS.map((n) => {
        const active = isActive(n.href);
        const Icon = n.icon;
        const showBadge = n.id === "renew" && badgeRenew > 0;
        if (n.primary) {
          return (
            <Link
              key={n.id}
              href={n.href}
              style={{
                background: "var(--df-brand)",
                color: "#fff",
                borderRadius: 14,
                padding: "10px 14px",
                marginTop: -16,
                boxShadow: "0 6px 16px -4px rgba(27,71,181,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-label="อัปโหลดเอกสาร"
            >
              <Icon size={22} strokeWidth={2.2} />
            </Link>
          );
        }
        return (
          <Link
            key={n.id}
            href={n.href}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              textDecoration: "none",
              color: active ? "var(--df-brand)" : "var(--df-muted)",
              position: "relative",
              padding: "4px 8px",
            }}
          >
            <Icon
              size={20}
              strokeWidth={active ? 2.2 : 1.6}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 700 : 500,
              }}
            >
              {n.label}
            </span>
            {showBadge && (
              <span
                style={{
                  position: "absolute",
                  top: -2,
                  right: 6,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 99,
                  background: "var(--df-accent)",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                }}
              >
                {badgeRenew}
              </span>
            )}
          </Link>
        );
      })}
      <style>{`
        @media (max-width: 768px) {
          .df-mobile-nav { display: flex !important; }
          .df-root > div { padding-bottom: 100px !important; }
        }
      `}</style>
    </nav>
  );
}
