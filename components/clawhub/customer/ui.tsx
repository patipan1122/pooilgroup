"use client";

// ClawHub customer shared UI bits — header w/ logo, balance pill, loading/error states,
// and small format helpers. All visual; everything is rendered inside .clawhub-scope.

import Link from "next/link";

/** JOLLY PLAY header — logo + page title. */
export function CwHeader({ title }: { title?: string }) {
  return (
    <header className="flex items-center gap-3 px-4 pb-3 pt-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/clawhub/logo.jpg"
        alt="JOLLY PLAY"
        className="h-11 w-11 rounded-xl object-cover"
        style={{ border: "1px solid var(--cw-border)" }}
      />
      <div className="min-w-0">
        <div
          className="text-[15px] font-extrabold leading-tight"
          style={{ color: "var(--cw-brand-700)", letterSpacing: "-0.02em" }}
        >
          JOLLY PLAY
        </div>
        {title ? (
          <div className="truncate text-[13px]" style={{ color: "var(--cw-text-2)" }}>
            {title}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** Full-screen centered spinner. */
export function CwLoading({ label = "กำลังโหลด..." }: { label?: string }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div
        className="size-11 animate-spin rounded-full border-4"
        style={{
          borderColor: "var(--cw-brand-100)",
          borderTopColor: "var(--cw-brand)",
        }}
      />
      <p className="text-sm" style={{ color: "var(--cw-text-2)" }}>
        {label}
      </p>
    </div>
  );
}

/** Calm error block (LINE-only / init failure). */
export function CwError({ message }: { message: string }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="grid size-14 place-items-center rounded-2xl text-2xl"
        style={{ background: "var(--cw-brand-50)" }}>
        🎯
      </div>
      <p className="text-base font-semibold" style={{ color: "var(--cw-text)" }}>
        {message}
      </p>
      <p className="text-sm" style={{ color: "var(--cw-text-3)" }}>
        ถ้ายังไม่ได้ผล ลองปิดแล้วเปิดใหม่จากเมนูด้านล่างของแชต JOLLY PLAY
      </p>
    </div>
  );
}

/** Big tabular-nums points number. */
export function CwBalance({ points }: { points: number }) {
  return (
    <span className="cw-points cw-tnum">
      <span className="text-4xl">{points.toLocaleString("th-TH")}</span>
      <span className="text-base font-bold">แต้ม</span>
    </span>
  );
}

/** Pill link styled like the primary button (for navigation between screens). */
export function CwButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  return (
    <Link
      href={href}
      className={variant === "ghost" ? "cw-btn cw-btn-ghost" : "cw-btn"}
      style={{ width: "100%" }}
    >
      {children}
    </Link>
  );
}

/** Format an ISO date → "17 มิ.ย. 2569" (Buddhist year), short. */
export function formatThaiDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Days from now until an ISO date (floored, min 0). */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
