// RentSpace shared presentational primitives (server-safe — no hooks).
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  UNIT_STATUS,
  CONTRACT_STATUS,
  BILL_STATUS,
  DISCOUNT_STATUS,
} from "@/lib/rentspace/format";

type Tone = { label: string; color: string; soft: string };
const MAPS: Record<string, Record<string, Tone>> = {
  unit: UNIT_STATUS,
  contract: CONTRACT_STATUS,
  bill: BILL_STATUS,
  discount: DISCOUNT_STATUS,
};

export function RsBadge({ kind, status }: { kind: "unit" | "contract" | "bill" | "discount"; status: string }) {
  const t = MAPS[kind]?.[status] ?? { label: status, color: "var(--rs-text-3)", soft: "var(--rs-bg-3)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      style={{ background: t.soft, color: t.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
      {t.label}
    </span>
  );
}

export function RsBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[13px] font-medium"
      style={{ color: "var(--rs-brand)" }}
    >
      <ChevronLeft className="h-4 w-4" /> {label}
    </Link>
  );
}

export function RsPage({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-6xl mx-auto space-y-5">{children}</div>;
}

export function RsHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--rs-text)" }}>
          {title}
        </h1>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: "var(--rs-text-2)" }}>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function RsKpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "ok" | "danger" | "pending" }) {
  const color =
    tone === "danger" ? "var(--rs-danger)" : tone === "pending" ? "var(--rs-pending)" : tone === "ok" ? "var(--rs-ok)" : "var(--rs-text)";
  return (
    <div className="rs-kpi">
      <div className="text-[12.5px] font-medium" style={{ color: "var(--rs-text-2)" }}>{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      {hint && <div className="text-[11.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>{hint}</div>}
    </div>
  );
}

export function RsEmpty({ icon = "🏬", title, hint, action }: { icon?: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rs-card flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="text-5xl mb-3">{icon}</div>
      <div className="text-lg font-semibold" style={{ color: "var(--rs-text)" }}>{title}</div>
      {hint && <p className="text-sm mt-1 max-w-sm" style={{ color: "var(--rs-text-2)" }}>{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function RsCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rs-card ${className}`}>{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile list primitives (CEO 2026-06-24 · mobile version).
// On phones the wide `rs-table` (min-w-[820px]) overflows/crushes. Pattern: wrap
// the existing <table> in `hidden lg:block` (desktop) and render an
// `lg:hidden space-y-2` stack of <RsMobileCard> on mobile — same data, tappable
// cards, no horizontal scroll. Cards are ≥44px tap targets by construction.
// ─────────────────────────────────────────────────────────────────────────────

export function RsMobileCard({
  href,
  title,
  titleRight,
  children,
  className = "",
}: {
  href?: string;
  title: React.ReactNode;
  titleRight?: React.ReactNode;
  /** Key/value rows — usually a sequence of <RsField>. Rendered as a 2-col grid. */
  children?: React.ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[15px] font-semibold" style={{ color: "var(--rs-text)" }}>
          {title}
        </div>
        {titleRight ? <div className="shrink-0 text-right">{titleRight}</div> : null}
      </div>
      {children ? <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">{children}</div> : null}
    </>
  );
  const cls = `rs-card block p-3.5 transition-colors active:bg-[var(--rs-bg-2)] ${className}`;
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function RsField({
  label,
  value,
  align = "left",
  tone,
  full,
}: {
  label: string;
  value: React.ReactNode;
  align?: "left" | "right";
  tone?: "danger" | "ok" | "pending" | "muted";
  /** Span both grid columns (long values like address/note). */
  full?: boolean;
}) {
  const color =
    tone === "danger"
      ? "var(--rs-danger)"
      : tone === "ok"
        ? "var(--rs-ok)"
        : tone === "pending"
          ? "var(--rs-pending)"
          : tone === "muted"
            ? "var(--rs-text-3)"
            : "var(--rs-text)";
  return (
    <div className={`${full ? "col-span-2" : ""} ${align === "right" ? "text-right" : ""} min-w-0`}>
      <div className="text-[11px]" style={{ color: "var(--rs-text-3)" }}>
        {label}
      </div>
      <div className="truncate text-[13px] font-medium tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
