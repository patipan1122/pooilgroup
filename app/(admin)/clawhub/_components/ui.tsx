// ClawHub admin — shared presentational primitives (Server Components, no client
// JS). They lean on the .clawhub-scope tokens (cw-card, cw-badge, cw-chip…) defined
// in components/clawhub/tokens.css so the whole back-office shares one warm palette.

import Link from "next/link";
import type { ClawhubRefundStatus, ClawhubRedemptionStatus } from "@/lib/generated/prisma/client";

/** Page header with a two-tone Thai title + optional subtitle + right-side slot. */
export function PageHeader({
  title,
  accent,
  subtitle,
  right,
}: {
  title: string;
  accent?: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="cw-title text-2xl">
          {title} {accent ? <span className="accent">{accent}</span> : null}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm" style={{ color: "var(--cw-text-2)" }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** KPI stat card. `tone` tints the value; `href` makes the whole card a link. */
export function StatCard({
  label,
  value,
  hint,
  tone = "ink",
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "ink" | "brand" | "ok" | "pending" | "danger";
  href?: string;
}) {
  const toneColor: Record<string, string> = {
    ink: "var(--cw-charcoal)",
    brand: "var(--cw-brand-700)",
    ok: "var(--cw-ok)",
    pending: "var(--cw-brand-700)",
    danger: "var(--cw-danger)",
  };
  const inner = (
    <div className="cw-card h-full p-4">
      <div className="text-xs font-semibold" style={{ color: "var(--cw-text-3)" }}>
        {label}
      </div>
      <div
        className="cw-tnum mt-1 text-2xl font-extrabold"
        style={{ color: toneColor[tone], letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs" style={{ color: "var(--cw-text-3)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-transform hover:-translate-y-0.5">
      {inner}
    </Link>
  ) : (
    inner
  );
}

const REFUND_BADGE: Record<ClawhubRefundStatus, { label: string; cls: string }> = {
  AUTO_APPROVED: { label: "อนุมัติอัตโนมัติ", cls: "cw-badge-ok" },
  APPROVED: { label: "อนุมัติแล้ว", cls: "cw-badge-ok" },
  PENDING_REVIEW: { label: "รอตรวจ", cls: "cw-badge-pending" },
  REJECTED: { label: "ปฏิเสธ", cls: "cw-badge-danger" },
};

export function RefundStatusBadge({ status }: { status: ClawhubRefundStatus }) {
  const b = REFUND_BADGE[status] ?? { label: status, cls: "cw-badge-pending" };
  return <span className={`cw-badge ${b.cls}`}>{b.label}</span>;
}

const REDEEM_BADGE: Record<ClawhubRedemptionStatus, { label: string; cls: string }> = {
  PENDING: { label: "รอจ่ายของ", cls: "cw-badge-pending" },
  FULFILLED: { label: "จ่ายแล้ว", cls: "cw-badge-ok" },
  CANCELLED: { label: "ยกเลิก", cls: "cw-badge-danger" },
};

export function RedemptionStatusBadge({ status }: { status: ClawhubRedemptionStatus }) {
  const b = REDEEM_BADGE[status] ?? { label: status, cls: "cw-badge-pending" };
  return <span className={`cw-badge ${b.cls}`}>{b.label}</span>;
}

/** Filter tab row built from query-string links (Server Component friendly). */
export function FilterTabs({
  tabs,
  current,
  basePath,
  paramName = "status",
}: {
  tabs: { value: string; label: string; count?: number }[];
  current: string;
  basePath: string;
  paramName?: string;
}) {
  return (
    <div className="cw-no-scroll mb-4 flex gap-2 overflow-x-auto pb-1">
      {tabs.map((t) => {
        const active = t.value === current;
        const qs = t.value ? `?${paramName}=${encodeURIComponent(t.value)}` : "";
        return (
          <Link key={t.value || "all"} href={`${basePath}${qs}`} className={`cw-chip ${active ? "active" : ""}`}>
            {t.label}
            {typeof t.count === "number" ? <span className="cw-tnum">· {t.count}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

/** Empty-state block. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="cw-card flex items-center justify-center p-10 text-center text-sm"
      style={{ color: "var(--cw-text-3)" }}
    >
      {children}
    </div>
  );
}
