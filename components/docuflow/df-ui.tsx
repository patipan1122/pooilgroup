// DocuFlow canvas-aligned UI primitives
// ────────────────────────────────────────────────────────────────────
// Mirrors `df-shared.jsx` + `styles.css` from the design canvas
// (DocuFlow Redesign.html). All classes are `df-*` and live in
// `app/(admin)/docuflow/docuflow.css` — scoped to `.df-root`.
// ────────────────────────────────────────────────────────────────────

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/* ============= DfMark — brand square (e.g. PG) ============= */
export function DfMark({
  size = 32,
  text = "PG",
}: {
  size?: number;
  text?: string;
}) {
  return (
    <span
      className="df-mark"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {text}
    </span>
  );
}

/* ============= DfEyebrow ============= */
export function DfEyebrow({
  number,
  children,
  className,
}: {
  number?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("df-eyebrow", className)}>
      {number && (
        <span
          className="df-tnum"
          style={{ marginRight: 8, color: "var(--df-brand)" }}
        >
          {number} ·
        </span>
      )}
      {children}
    </p>
  );
}

/* ============= DfCard ============= */
export function DfCard({
  children,
  className,
  warm,
  padding = 18,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  warm?: boolean;
  padding?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("df-card", warm && "df-card-warm", className)}
      style={{ padding, ...style }}
    >
      {children}
    </div>
  );
}

/* ============= DfPill ============= */
export type DfTone =
  | "danger"
  | "warn"
  | "success"
  | "brand"
  | "accent"
  | "outline"
  | "ink"
  | "default";

export function DfPill({
  tone = "default",
  children,
  className,
  small,
  style,
}: {
  tone?: DfTone;
  children: React.ReactNode;
  className?: string;
  small?: boolean;
  style?: React.CSSProperties;
}) {
  const map: Record<DfTone, string> = {
    danger: "df-pill-danger",
    warn: "df-pill-warn",
    success: "df-pill-success",
    brand: "df-pill-brand",
    accent: "df-pill-accent",
    outline: "df-pill-outline",
    ink: "df-pill-ink",
    default: "",
  };
  return (
    <span
      className={cn("df-pill", small && "df-pill-sm", map[tone], className)}
      style={style}
    >
      {children}
    </span>
  );
}

/* ============= DfButton — anchor variant via `href` ============= */
type ButtonProps = {
  variant?: "primary" | "brand" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
  iconOnly?: boolean;
} & (
  | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">)
  | ({ href?: undefined } & React.ButtonHTMLAttributes<HTMLButtonElement>)
);

export function DfButton(props: ButtonProps) {
  const {
    variant = "ghost",
    size = "md",
    className,
    children,
    iconOnly,
    ...rest
  } = props;
  const cls = cn(
    "df-btn",
    variant === "primary" && "df-btn-primary",
    variant === "brand" && "df-btn-brand",
    variant === "ghost" && "df-btn-ghost",
    variant === "danger" && "df-btn-danger",
    size === "sm" && "df-btn-sm",
    size === "lg" && "df-btn-lg",
    iconOnly && "df-btn-icon",
    className,
  );
  if ("href" in rest && rest.href) {
    const { href, ...anchorRest } = rest as { href: string } & Omit<
      React.AnchorHTMLAttributes<HTMLAnchorElement>,
      "href"
    >;
    return (
      <Link href={href} className={cls} {...anchorRest}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}

/* ============= DfDocIcon ============= */
export function DfDocIcon({
  children,
  size = "md",
  tone,
  className,
}: {
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: { bg: string; fg: string };
  className?: string;
}) {
  return (
    <span
      className={cn(
        "df-docico",
        size === "sm" && "df-docico-sm",
        size === "lg" && "df-docico-lg",
        className,
      )}
      style={tone ? { background: tone.bg, color: tone.fg } : undefined}
    >
      {children}
    </span>
  );
}

/* ============= DfAvatar ============= */
export function DfAvatar({
  initials,
  color,
  size = "md",
  className,
}: {
  initials: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "df-avatar",
        size === "sm" && "df-avatar-sm",
        size === "lg" && "df-avatar-lg",
        className,
      )}
      style={
        color ? { background: color, color: "#fff", borderColor: "#fff" } : undefined
      }
    >
      {initials}
    </span>
  );
}

/* ============= DfStatCard ============= */
export function DfStatCard({
  label,
  value,
  sub,
  tone = "ink",
  icon,
  href,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "ink" | "brand" | "warn" | "danger" | "success" | "accent";
  icon?: React.ReactNode;
  href?: string;
}) {
  const colorMap: Record<typeof tone, string> = {
    ink: "var(--df-ink)",
    brand: "var(--df-brand)",
    warn: "var(--df-warn)",
    danger: "var(--df-danger)",
    success: "var(--df-success)",
    accent: "var(--df-accent)",
  };
  const bgMap: Record<typeof tone, string> = {
    ink: "var(--df-bg-warm)",
    brand: "var(--df-brand-soft)",
    warn: "var(--df-warn-soft)",
    danger: "var(--df-danger-soft)",
    success: "var(--df-success-soft)",
    accent: "var(--df-accent-soft)",
  };

  const inner = (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 14,
        }}
      >
        {icon && (
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: bgMap[tone],
              color: colorMap[tone],
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </span>
        )}
        {/* Top-right ArrowUpRight indicator — canvas-exact (always visible) */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--df-muted-2)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      </div>
      <div
        className="df-serif df-tnum"
        style={{
          fontSize: 38,
          fontWeight: 500,
          // Canvas uses --ink for ALL stat values (tone only colors icon bg)
          color:
            tone === "danger" || tone === "warn"
              ? colorMap[tone]
              : "var(--df-ink)",
          lineHeight: 1,
          marginBottom: 8,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, color: "var(--df-ink-2)", fontWeight: 500 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--df-muted)", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </>
  );

  const baseClass = "df-card";
  const baseStyle: React.CSSProperties = {
    padding: 18,
    transition: "transform 0.15s, box-shadow 0.15s",
  };

  if (href) {
    return (
      <Link href={href} className={baseClass} style={baseStyle}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={baseClass} style={baseStyle}>
      {inner}
    </div>
  );
}

/* ============= DfSegmented ============= */
export function DfSegmented({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ key: string; label: React.ReactNode; href?: string }>;
  value: string;
  onChange?: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("df-seg", className)}>
      {options.map((o) =>
        o.href ? (
          <Link key={o.key} href={o.href} className={o.key === value ? "df-on" : undefined}>
            {o.label}
          </Link>
        ) : (
          <button
            key={o.key}
            type="button"
            className={o.key === value ? "df-on" : undefined}
            onClick={() => onChange?.(o.key)}
          >
            {o.label}
          </button>
        ),
      )}
    </div>
  );
}

/* ============= DfPageHeader — hero greeting / breadcrumb ============= */
export function DfPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header
      className="df-fade-up"
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 24,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        {eyebrow && <div style={{ marginBottom: 8 }}>{eyebrow}</div>}
        <h1
          className="df-serif"
          style={{
            fontSize: "clamp(26px, 3.8vw, 36px)",
            lineHeight: 1.1,
            color: "var(--df-ink)",
            margin: 0,
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h1>
        {description && (
          <p
            style={{
              color: "var(--df-muted)",
              fontSize: 14,
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {actions}
        </div>
      )}
    </header>
  );
}

/* ============= DfSection — numbered subsection header ============= */
export function DfSection({
  number,
  label,
  title,
  description,
  action,
  children,
  className,
}: {
  number?: string;
  label: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("df-fade-up", className)} style={{ marginBottom: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <DfEyebrow number={number}>{label}</DfEyebrow>
          {title && (
            <h2
              className="df-serif"
              style={{
                fontSize: 22,
                lineHeight: 1.2,
                marginTop: 6,
                marginBottom: 0,
              }}
            >
              {title}
            </h2>
          )}
          {description && (
            <p
              style={{
                color: "var(--df-muted)",
                fontSize: 13,
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              {description}
            </p>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </section>
  );
}

/* ============= DfDocIconAuto — pick tone by category guess ============= */
export const DF_CATEGORY_COLORS: Record<string, string> = {
  fuel: "#C46A3D",
  station: "#C46A3D",
  vehicle: "#0EA5A4",
  contract: "#0E2D7A",
  tax: "#15803D",
  insurance: "#7C3AED",
  legal: "#1B47B5",
  land: "#B45309",
  default: "#6B7488",
};
