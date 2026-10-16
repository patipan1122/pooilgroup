"use client";

// Small, purely presentational pieces for the Telegram Mini App. Kept
// separate from telegram-mini-app.tsx (the state machine) so the
// animation/markup details don't crowd the flow logic.

import type { ReactNode } from "react";


export function Screen({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-4 space-y-4 tg-fade-in">{children}</div>;
}

export function Header({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-1 tg-fade-up">
      {eyebrow && (
        <p className="text-xs font-bold tg-hint uppercase tracking-wide">
          {eyebrow}
        </p>
      )}
      <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm tg-hint">{subtitle}</p>}
    </div>
  );
}

/** Skeleton shimmer placeholders — replaces a blank screen/spinner while
 *  the initial to-sign list loads. */
export function ListSkeleton() {
  return (
    <div className="space-y-3" aria-label="กำลังโหลด">
      <div className="tg-skeleton h-20 w-full" />
      <div className="tg-skeleton h-20 w-full" style={{ animationDelay: "80ms" }} />
      <div className="tg-skeleton h-20 w-full" style={{ animationDelay: "160ms" }} />
    </div>
  );
}

export function EmptyCard({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="tg-card tg-fade-up rounded-2xl p-6 text-center space-y-3">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full tg-card-secondary">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        <p className="text-sm tg-hint">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function LinkButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="tg-pressable inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold"
      style={{ background: "var(--tg-button)", color: "var(--tg-button-text)" }}
    >
      {children}
    </a>
  );
}

export function DocumentCard({
  name,
  meta,
  index,
  selected,
  onToggle,
}: {
  name: string;
  meta: string;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="tg-card tg-card-enter tg-pressable w-full flex items-start gap-3 rounded-2xl p-3.5 text-left"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
        style={{
          borderColor: selected ? "var(--tg-button)" : "color-mix(in srgb, var(--tg-text) 25%, transparent)",
          background: selected ? "var(--tg-button)" : "transparent",
        }}
        aria-hidden
      >
        {selected && (
          <svg viewBox="0 0 24 24" className="size-3" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="var(--tg-button-text)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block text-xs tg-hint">{meta}</span>
      </span>
    </button>
  );
}

type ChecklistStatus = "waiting" | "running" | "success" | "error";

export function ChecklistRow({
  name,
  meta,
  status,
  error,
}: {
  name: string;
  meta: string;
  status: ChecklistStatus;
  error?: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 py-2.5 border-b tg-border last:border-0 ${
        status === "error" ? "tg-shake" : ""
      }`}
    >
      <span className="mt-0.5 shrink-0">
        {status === "success" && (
          <svg viewBox="0 0 24 24" className="size-5 tg-pop" fill="none">
            <circle cx="12" cy="12" r="11" fill="var(--color-ok, #16a34a)" />
            <path
              d="M7 12.5l3 3 7-7.5"
              stroke="#fff"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {status === "error" && (
          <svg viewBox="0 0 24 24" className="size-5 tg-pop" fill="none">
            <circle cx="12" cy="12" r="11" fill="var(--color-err, #dc2626)" />
            <path
              d="M9 9l6 6M15 9l-6 6"
              stroke="#fff"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {status === "running" && (
          <svg viewBox="0 0 24 24" className="size-5 tg-spin" fill="none">
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="color-mix(in srgb, var(--tg-text) 15%, transparent)"
              strokeWidth={2.5}
            />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="var(--tg-button)"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          </svg>
        )}
        {status === "waiting" && (
          <svg viewBox="0 0 24 24" className="size-5" fill="none">
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="color-mix(in srgb, var(--tg-text) 18%, transparent)"
              strokeWidth={2}
            />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block text-xs tg-hint">{meta}</span>
        {status === "error" && error && (
          <span className="block text-xs mt-0.5" style={{ color: "var(--color-err, #dc2626)" }}>
            {error}
          </span>
        )}
      </span>
    </div>
  );
}

/** The big, satisfying completion moment — SVG stroke-draw checkmark with
 *  a bounce/overshoot scale-in. Dependency-free (pure CSS + inline SVG). */
export function SuccessCheckmark({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <svg viewBox="0 0 64 64" className="size-20 tg-success-circle">
        <circle cx="32" cy="32" r="30" fill="var(--color-ok, #16a34a)" />
        <path
          className="tg-success-check"
          d="M19 33l9 9 17-19"
          fill="none"
          stroke="#fff"
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="text-base font-bold tg-fade-up" style={{ animationDelay: "250ms" }}>
        {label}
      </p>
    </div>
  );
}
