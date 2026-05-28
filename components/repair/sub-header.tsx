// Sub-page header for /repairs/* secondary pages — uses Pooil App
// design vocabulary (.page-head, .page-title, .page-eyebrow, .kpi-row).
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft } from "lucide-react";

interface Crumb { label: string; href?: string }
interface Stat {
  label: string;
  value: string | number;
  tone?: "default" | "danger" | "warn" | "success";
}

interface Props {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  subtitle?: string;
  stats?: Stat[];
  actions?: React.ReactNode;
  crumbs?: Crumb[];
  backHref?: string;
}

export function RepairSubHeader({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  stats,
  actions,
  crumbs,
  backHref = "/repairs",
}: Props) {
  return (
    <div className="page-head">
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 11.5, marginBottom: 4,
      }}>
        <Link
          href={backHref}
          style={{
            color: "var(--brand-700)", fontWeight: 600,
            textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}
        >
          <ChevronLeft size={12} />
          ภาพรวม Command Center
        </Link>
        {crumbs?.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", gap: 8, color: "var(--ink-400)" }}>
            <span>/</span>
            {c.href ? (
              <Link href={c.href} style={{ color: "var(--ink-600)", textDecoration: "none" }}>
                {c.label}
              </Link>
            ) : (
              <span style={{ color: "var(--ink-700)", fontWeight: 600 }}>{c.label}</span>
            )}
          </span>
        ))}
      </div>

      <div className="page-head-row">
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: "var(--brand-50)", color: "var(--brand-600)",
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <Icon size={20} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="page-eyebrow">{eyebrow}</div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
        {actions && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{actions}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div className="kpi-row" style={{ marginBottom: 0 }}>
          {stats.map((s, i) => (
            <div key={i} className="kpi" style={{ cursor: "default" }}>
              <div className="kpi-label">{s.label}</div>
              <div
                className="kpi-value num"
                style={{
                  fontSize: typeof s.value === "string" && s.value.length > 10 ? 14 : 18,
                  color:
                    s.tone === "danger" ? "var(--bad)" :
                    s.tone === "warn" ? "var(--warn)" :
                    s.tone === "success" ? "var(--good)" :
                    "var(--ink-900)",
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
