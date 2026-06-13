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
