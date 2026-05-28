/**
 * ClawFleet v2 — Shared chrome primitives
 * Ported from `~/ตู้คีบ/src/chrome.jsx` to TypeScript.
 *
 * Server-friendly: Icon, Ic, Pill, Avatar, StatTile, Section, fmtTHB
 * Client-only (interactive state): Sidebar, TopBar
 */

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* ===== ICONS ===== */

export type IconName =
  | "home"
  | "activity"
  | "alert"
  | "chart"
  | "bell"
  | "search"
  | "filter"
  | "chevronR"
  | "chevronD"
  | "chevronL"
  | "arrowR"
  | "arrowUR"
  | "plus"
  | "check"
  | "x"
  | "camera"
  | "coins"
  | "package"
  | "trend"
  | "trendDown"
  | "building"
  | "user"
  | "users"
  | "settings"
  | "clock"
  | "pin"
  | "refresh"
  | "zap"
  | "cube"
  | "phone"
  | "controller"
  | "layers"
  | "download"
  | "more"
  | "external"
  | "flag"
  | "play"
  | "pause"
  | "stop"
  | "history"
  | "link"
  | "dot";

export const ICONS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 3 3 5-7" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  filter: (
    <>
      <path d="M3 5h18" />
      <path d="M6 12h12" />
      <path d="M10 19h4" />
    </>
  ),
  chevronR: (
    <>
      <path d="m9 6 6 6-6 6" />
    </>
  ),
  chevronD: (
    <>
      <path d="m6 9 6 6 6-6" />
    </>
  ),
  chevronL: (
    <>
      <path d="m15 6-6 6 6 6" />
    </>
  ),
  arrowR: (
    <>
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </>
  ),
  arrowUR: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  check: (
    <>
      <path d="M20 6 9 17l-5-5" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  coins: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M19 6.51A7 7 0 0 1 22 12a7 7 0 0 1-3 5.49" />
      <path d="M15.66 19A7 7 0 0 1 9 22" />
    </>
  ),
  package: (
    <>
      <path d="M16.5 9.4 7.55 4.24" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.27 6.96 8.73 5.05 8.73-5.05" />
      <path d="M12 22V12" />
    </>
  ),
  trend: (
    <>
      <path d="m22 7-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </>
  ),
  trendDown: (
    <>
      <path d="m22 17-8.5-8.5-5 5L2 7" />
      <path d="M16 17h6v-6" />
    </>
  ),
  building: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V7l8-4v18" />
      <path d="M19 21V11l-6-4" />
      <path d="M9 9h.01" />
      <path d="M9 12h.01" />
      <path d="M9 15h.01" />
      <path d="M9 18h.01" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <path d="M16 4a4 4 0 0 1 0 8" />
      <path d="M22 21a7 7 0 0 0-5-6.7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 22s8-7 8-12a8 8 0 0 0-16 0c0 5 8 12 8 12Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  zap: (
    <>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </>
  ),
  cube: (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.27 6.96 8.73 5.05 8.73-5.05" />
      <path d="M12 22V12" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M12 18h.01" />
    </>
  ),
  controller: (
    <>
      <path d="M6 7h12a4 4 0 0 1 4 4v2a4 4 0 0 1-7 2.83L13 14h-2l-2 1.83A4 4 0 0 1 2 13v-2a4 4 0 0 1 4-4Z" />
      <path d="M7 11h2" />
      <path d="M8 10v2" />
      <circle cx="16" cy="11" r="1" />
      <circle cx="14" cy="13" r="1" />
    </>
  ),
  layers: (
    <>
      <path d="m12.83 2.18 8.45 4.61a1 1 0 0 1 0 1.75l-8.45 4.61a2 2 0 0 1-1.66 0L2.72 8.54a1 1 0 0 1 0-1.75l8.45-4.61a2 2 0 0 1 1.66 0Z" />
      <path d="m22 12-9.83 5.36a2 2 0 0 1-1.66 0L2 12" />
      <path d="m22 17-9.83 5.36a2 2 0 0 1-1.66 0L2 17" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m6 9 6 6 6-6" />
      <path d="M5 21h14" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  external: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  flag: (
    <>
      <path d="M4 22V3" />
      <path d="M4 3h13l-2 4 2 4H4" />
    </>
  ),
  play: (
    <>
      <polygon points="6,4 20,12 6,20 6,4" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </>
  ),
  stop: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  dot: (
    <>
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </>
  ),
};

export type IconProps = {
  d: ReactNode;
  size?: number;
  strokeWidth?: number;
  fill?: string;
  style?: CSSProperties;
};

export function Icon({ d, size = 18, strokeWidth = 1.7, fill = "none", style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {d}
    </svg>
  );
}

export type IcProps = {
  name: IconName;
  size?: number;
  style?: CSSProperties;
};

export function Ic({ name, size, style }: IcProps) {
  return <Icon d={ICONS[name]} size={size} style={style} />;
}

/* ===== SHARED TYPES (Branch / etc.) ===== */

export type BranchTone =
  | "indigo"
  | "cyan"
  | "emerald"
  | "amber"
  | "violet"
  | "rose"
  | "sky"
  | "lime"
  | "fuchsia"
  | "teal";

export type BranchSummary = {
  id: string;
  name: string;
  code: string;
  area: string;
  machines: number;
  manager: string;
  avatar: string;
  tone: BranchTone;
};

/* ===== SIDEBAR ===== */

type SidebarItem = {
  id: string;
  name: string;
  icon: IconName;
  desc?: string;
  badge?: number;
  badgeColor?: "blue" | "red" | "amber";
};

const SIDEBAR_PRIMARY: SidebarItem[] = [
  { id: "hub", name: "Hub", icon: "home", desc: "ตอนนี้คุณต้องทำอะไร" },
  { id: "ops", name: "Operations", icon: "activity", desc: "รอบเก็บที่กำลังเดิน", badge: 4 },
  { id: "anom", name: "Anomaly", icon: "alert", desc: "รายการที่ต้องตรวจ", badge: 4, badgeColor: "red" },
  { id: "stock", name: "Stock", icon: "package", desc: "ของรางวัล + แลร์ต", badge: 3, badgeColor: "amber" },
  { id: "insights", name: "Insights", icon: "chart", desc: "ตาราง + CSV" },
  { id: "mobile", name: "Mobile flow", icon: "phone", desc: "พรีวิวฟอร์มพนักงาน" },
];

const SIDEBAR_SECONDARY: SidebarItem[] = [
  { id: "team", name: "ทีม & สาขา", icon: "users" },
  { id: "audit", name: "Audit log", icon: "history" },
  { id: "settings", name: "ตั้งค่า", icon: "settings" },
];

export type SidebarProps = {
  active: string;
  onNav: (id: string) => void;
  subtitle?: string;
};

export function Sidebar({ active, onNav, subtitle }: SidebarProps) {
  return (
    <aside className="cf-sidebar">
      <div className="cf-brand">
        <div className="cf-brand-mark">
          <Ic name="controller" size={20} />
        </div>
        <div className="cf-brand-text">
          <div className="cf-brand-name">ClawFleet</div>
          <div className="cf-brand-sub">{subtitle ?? "ตู้คีบ · cross-check"}</div>
        </div>
      </div>

      <div className="cf-nav-group">
        <div className="cf-nav-label">งานวันนี้</div>
        {SIDEBAR_PRIMARY.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`cf-nav-item ${active === it.id ? "is-active" : ""}`}
            onClick={() => onNav(it.id)}
          >
            <span className="cf-nav-icon">
              <Ic name={it.icon} />
            </span>
            <span className="cf-nav-text">
              <span className="cf-nav-name">{it.name}</span>
              {it.desc && <span className="cf-nav-desc">{it.desc}</span>}
            </span>
            {it.badge ? (
              <span className={`cf-nav-badge cf-nav-badge-${it.badgeColor ?? "blue"}`}>{it.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="cf-nav-group">
        <div className="cf-nav-label">จัดการ</div>
        {SIDEBAR_SECONDARY.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`cf-nav-item cf-nav-item-secondary ${active === it.id ? "is-active" : ""}`}
            onClick={() => onNav(it.id)}
          >
            <span className="cf-nav-icon">
              <Ic name={it.icon} />
            </span>
            <span className="cf-nav-name">{it.name}</span>
          </button>
        ))}
      </div>

      <div className="cf-sidebar-foot">
        <div className="cf-avatar cf-avatar-sm">P</div>
        <div className="cf-foot-text">
          <div className="cf-foot-name">patipan</div>
          <div className="cf-foot-role">Super Admin · ทุก 3 สาขา</div>
        </div>
      </div>
    </aside>
  );
}

/* ===== TOPBAR ===== */

export type TopBarProps = {
  branch: string;
  onBranchChange: (id: string) => void;
  page: string;
  branches: BranchSummary[];
};

export function TopBar({ branch, onBranchChange, page, branches }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const label = useMemo(() => {
    if (branch === "all") return `ทุกสาขา (${branches.length})`;
    return branches.find((b) => b.id === branch)?.name ?? branch;
  }, [branch, branches]);

  const filtered = useMemo(() => {
    if (!search) return branches;
    const q = search.toLowerCase();
    return branches.filter(
      (b) => b.name.includes(search) || b.area.includes(search) || b.code.toLowerCase().includes(q),
    );
  }, [branches, search]);

  return (
    <header className="cf-topbar">
      <div className="cf-tb-left">
        <div className="cf-tb-crumb">
          <span className="cf-tb-crumb-pre">ClawFleet</span>
          <Ic name="chevronR" size={14} />
          <span className="cf-tb-crumb-cur">{page}</span>
        </div>
      </div>
      <div className="cf-tb-right">
        <div className="cf-tb-branch" ref={ref}>
          <button type="button" className="cf-tb-branch-btn" onClick={() => setOpen((o) => !o)}>
            <Ic name="pin" size={14} />
            <span>{label}</span>
            <Ic name="chevronD" size={14} />
          </button>
          {open && (
            <div className="cf-dropdown cf-dropdown-wide">
              <div className="cf-dropdown-search">
                <Ic name="search" size={14} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหา ปตท. จักราช, นครราชสีมา, รหัส..."
                  autoFocus
                />
              </div>
              <button
                type="button"
                className={`cf-dropdown-item ${branch === "all" ? "is-active" : ""}`}
                onClick={() => {
                  onBranchChange("all");
                  setOpen(false);
                }}
              >
                <span>
                  <Ic name="layers" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  ทุกสาขา
                </span>
                <span className="cf-dim">{branches.length}</span>
              </button>
              <div className="cf-dropdown-div" />
              <div className="cf-dropdown-scroll">
                {filtered.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`cf-dropdown-item cf-dropdown-branch ${branch === b.id ? "is-active" : ""}`}
                    onClick={() => {
                      onBranchChange(b.id);
                      setOpen(false);
                    }}
                  >
                    <span className="cf-dropdown-branch-left">
                      <span className={`cf-branch-flag cf-branch-flag-sm cf-branch-flag-${b.tone}`}>{b.avatar}</span>
                      <span>
                        <span className="cf-dropdown-branch-name">{b.name}</span>
                        <span className="cf-dim cf-dropdown-branch-meta">
                          {b.area} · {b.code}
                        </span>
                      </span>
                    </span>
                    <span className="cf-dim">{b.machines} ตู้</span>
                  </button>
                ))}
                {filtered.length === 0 && <div className="cf-dropdown-empty">ไม่เจอสาขา &ldquo;{search}&rdquo;</div>}
              </div>
            </div>
          )}
        </div>
        <button type="button" className="cf-tb-icon" aria-label="search">
          <Ic name="search" />
        </button>
        <button type="button" className="cf-tb-icon cf-tb-icon-bell" aria-label="notifications">
          <Ic name="bell" />
          <span className="cf-tb-icon-dot" />
        </button>
        <div className="cf-tb-divider" />
        <button type="button" className="cf-tb-profile" aria-label="profile">
          <div className="cf-avatar">P</div>
        </button>
      </div>
    </header>
  );
}

/* ===== PILL ===== */

export type PillColor = "slate" | "emerald" | "red" | "amber" | "blue";
export type PillSize = "sm" | "md";

export type PillProps = {
  color?: PillColor;
  children: ReactNode;
  dot?: boolean;
  size?: PillSize;
  style?: CSSProperties;
};

export function Pill({ color = "slate", children, dot, size = "md", style }: PillProps) {
  return (
    <span className={`cf-pill cf-pill-${color} cf-pill-${size} ${dot ? "cf-pill-dot" : ""}`} style={style}>
      {children}
    </span>
  );
}

/* ===== AVATAR ===== */

export type AvatarColor =
  | "indigo"
  | "cyan"
  | "emerald"
  | "amber"
  | "violet"
  | "rose"
  | "sky"
  | "lime"
  | "fuchsia"
  | "teal";
export type AvatarSize = "sm" | "md";

export type AvatarProps = {
  initials: string;
  color?: AvatarColor;
  size?: AvatarSize;
};

export function Avatar({ initials, color = "indigo", size = "md" }: AvatarProps) {
  return <div className={`cf-avatar cf-avatar-${size} cf-avatar-${color}`}>{initials}</div>;
}

/* ===== STAT TILE ===== */

export type StatTone = "neutral" | "primary" | "amber";

export type StatTileProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: StatTone;
  icon?: IconName;
  trend?: number | null;
};

export function StatTile({ label, value, sub, tone = "neutral", icon, trend }: StatTileProps) {
  return (
    <div className={`cf-stat cf-stat-${tone}`}>
      <div className="cf-stat-head">
        <span className="cf-stat-label">{label}</span>
        {icon && (
          <span className="cf-stat-icon">
            <Ic name={icon} size={16} />
          </span>
        )}
      </div>
      <div className="cf-stat-value">{value}</div>
      <div className="cf-stat-foot">
        {trend != null && (
          <span className={`cf-trend cf-trend-${trend >= 0 ? "up" : "down"}`}>
            <Ic name={trend >= 0 ? "trend" : "trendDown"} size={12} />
            {Math.abs(trend)}%
          </span>
        )}
        {sub && <span className="cf-stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

/* ===== SECTION ===== */

export type SectionProps = {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  dense?: boolean;
  anchor?: string;
};

export function Section({ title, sub, action, children, dense, anchor }: SectionProps) {
  return (
    <section className={`cf-section ${dense ? "is-dense" : ""}`} data-anchor={anchor}>
      <div className="cf-section-head">
        <div>
          <h3 className="cf-section-title">{title}</h3>
          {sub && <div className="cf-section-sub">{sub}</div>}
        </div>
        {action}
      </div>
      <div className="cf-section-body">{children}</div>
    </section>
  );
}

/* ===== FORMAT HELPERS ===== */

export function fmtTHB(n: number | null | undefined): string {
  if (n == null) return "—";
  return "฿" + n.toLocaleString("th-TH");
}
