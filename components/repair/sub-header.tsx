// Sub-page header for /repairs/* secondary pages (parts, technicians, categories,
// settings, my-jobs, recurring). Mirrors Pooil App's "page-head" pattern —
// icon eyebrow + title + subtitle + right-side actions. Lightweight; no biz
// filter (that lives on the 4 main views).
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft } from "lucide-react";

interface Crumb {
  label: string;
  href?: string;
}

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

const TONE_BG: Record<NonNullable<Stat["tone"]>, string> = {
  default: "text-zinc-900",
  danger: "text-red-700",
  warn: "text-amber-700",
  success: "text-emerald-700",
};

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
    <div className="bg-white border-b border-zinc-200">
      <div className="px-4 sm:px-6 lg:px-8 pt-4 pb-3">
        {/* Breadcrumb / back */}
        <div className="flex items-center gap-2 mb-2 text-[11.5px]">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 font-semibold"
          >
            <ChevronLeft className="size-3" />
            ภาพรวม Command Center
          </Link>
          {crumbs?.map((c, i) => (
            <span key={i} className="text-zinc-400 inline-flex items-center gap-2">
              <span>/</span>
              {c.href ? (
                <Link href={c.href} className="text-zinc-600 hover:text-zinc-900">
                  {c.label}
                </Link>
              ) : (
                <span className="text-zinc-700 font-semibold">{c.label}</span>
              )}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="size-10 rounded-xl bg-blue-50 text-blue-700 grid place-items-center shrink-0">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-blue-600">
                {eyebrow}
              </div>
              <h1 className="text-[19px] sm:text-[22px] font-extrabold tracking-tight text-zinc-900 leading-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs text-zinc-500 mt-0.5 leading-tight">{subtitle}</p>
              )}
            </div>
          </div>

          {actions && <div className="flex flex-wrap gap-2 ml-auto">{actions}</div>}
        </div>

        {stats && stats.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-px bg-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
            {stats.map((s, i) => (
              <div key={i} className="flex-1 min-w-[140px] bg-white px-3 py-2.5">
                <div className="text-[10.5px] uppercase tracking-wide font-semibold text-zinc-500">
                  {s.label}
                </div>
                <div
                  className={`text-[18px] tabular-nums font-bold mt-0.5 ${TONE_BG[s.tone ?? "default"]}`}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
