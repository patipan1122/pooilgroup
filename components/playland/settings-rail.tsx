"use client";

// Client-side settings rail · uses usePathname() for reliable active state
// Replaces broken `headers().get("x-pathname")` pattern from server layout
// (Next 15 doesn't set x-pathname automatically · referer is previous page)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Package, ShoppingBasket, ScanFace, Boxes, type LucideIcon } from "lucide-react";

interface Section {
  href: string;
  iconName: "building" | "package" | "shopping" | "scanface" | "boxes";
  label: string;
  count: number;
  desc: string;
}

const ICONS: Record<Section["iconName"], LucideIcon> = {
  building: Building2,
  package: Package,
  shopping: ShoppingBasket,
  scanface: ScanFace,
  boxes: Boxes,
};

// Locked "Play a lot" tokens — white surface, blue active (matches office)
const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";

export function SettingsRail({ sections }: { sections: Section[] }) {
  const pathname = usePathname();
  return (
    <nav style={{ padding: "12px 8px" }}>
      {sections.map((s) => {
        const Icon = ICONS[s.iconName];
        const active = pathname === s.href || pathname.startsWith(s.href + "/");
        return (
          <Link
            key={s.href}
            href={s.href}
            style={{
              display: "flex", alignItems: "center", gap: 11,
              padding: "10px 12px", margin: "2px 0", borderRadius: 11,
              textDecoration: "none", fontFamily: "inherit",
              background: active ? "#eaf2fb" : "transparent",
              color: active ? BLUE : INK,
              fontWeight: active ? 600 : 500,
              border: active ? `1px solid #d4e3f5` : "1px solid transparent",
              transition: "background .12s, color .12s",
            }}
          >
            <Icon size={17} color={active ? BLUE : MUTED} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: MUTED, fontWeight: 400 }}>{s.desc}</div>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 12, color: active ? BLUE : MUTED, fontWeight: 600, borderColor: LINE }}>{s.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}
