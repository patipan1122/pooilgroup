"use client";

// Client-side settings rail · uses usePathname() for reliable active state
// Replaces broken `headers().get("x-pathname")` pattern from server layout
// (Next 15 doesn't set x-pathname automatically · referer is previous page)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Package, ShoppingBasket, ScanFace, Tag, type LucideIcon } from "lucide-react";

interface Section {
  href: string;
  iconName: "building" | "package" | "shopping" | "scanface" | "tag";
  label: string;
  count: number;
  desc: string;
}

const ICONS: Record<Section["iconName"], LucideIcon> = {
  building: Building2,
  package: Package,
  shopping: ShoppingBasket,
  scanface: ScanFace,
  tag: Tag,
};

export function SettingsRail({ sections }: { sections: Section[] }) {
  const pathname = usePathname();
  return (
    <nav style={{ padding: "12px 0" }}>
      {sections.map((s) => {
        const Icon = ICONS[s.iconName];
        const active = pathname === s.href || pathname.startsWith(s.href + "/");
        return (
          <Link key={s.href} href={s.href} className={`pl-rail-link ${active ? "is-active" : ""}`}>
            <Icon size={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{s.label}</div>
              <div style={{ fontSize: 11, color: "var(--pl-text-muted)", fontWeight: 400 }}>{s.desc}</div>
            </div>
            <span className="pl-rail-count">{s.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}
