"use client";

// SuccessScreen · full-screen confirmation for maid mobile flows.
// Replaces the toast+router.push pattern that disappears in 4s — maids in the
// field need a PERSISTENT "it saved" state with the reference code visible
// (STAFF audit P0: anxiety + double-submit when the toast is missed).
// Emerald theme matches MaidShell. Primary is a Link (no asChild dependency);
// secondary is an optional reset callback ("แจ้งอีกรายการ").

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface SuccessScreenProps {
  title: string;
  subtitle?: string;
  /** Small label above the reference code, e.g. "เลขแจ้งซ่อม". */
  refLabel?: string;
  /** The reference code itself, e.g. "RP-2569-0042" — rendered mono + select-all. */
  refCode?: string;
  /** Extra meta under the code (chair chip, urgency, time). */
  meta?: ReactNode;
  /** Preview URLs of attached photos (shown as small thumbnails). */
  thumbnails?: ReadonlyArray<string>;
  primaryHref: string;
  primaryLabel: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function SuccessScreen({
  title,
  subtitle,
  refLabel,
  refCode,
  meta,
  thumbnails,
  primaryHref,
  primaryLabel,
  secondaryLabel,
  onSecondary,
}: SuccessScreenProps) {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-5 py-8 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="grid size-20 place-items-center rounded-full bg-emerald-100">
        <CheckCircle2
          className="size-11 text-emerald-600"
          strokeWidth={2}
          aria-hidden
        />
      </div>

      <div className="space-y-1">
        <h2 className="text-xl font-bold text-zinc-900">{title}</h2>
        {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
      </div>

      {refCode && (
        <div className="w-full max-w-xs space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          {refLabel && <div className="text-xs text-zinc-500">{refLabel}</div>}
          <div className="select-all font-mono text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
            {refCode}
          </div>
          {meta && <div className="pt-1 text-xs text-zinc-600">{meta}</div>}
        </div>
      )}

      {thumbnails && thumbnails.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-2">
          {thumbnails.map((src, i) => (
            <li key={src}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`รูปแนบ ${i + 1}`}
                className="size-16 rounded-lg object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex w-full max-w-xs flex-col gap-2 pt-2">
        {onSecondary && secondaryLabel && (
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full"
            onClick={onSecondary}
          >
            {secondaryLabel}
          </Button>
        )}
        <Link
          href={primaryHref}
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 px-4 text-base font-semibold text-white transition-colors hover:bg-emerald-700 active:bg-emerald-700"
        >
          {primaryLabel}
        </Link>
      </div>
    </div>
  );
}
