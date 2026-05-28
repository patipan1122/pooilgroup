// Toggle-style filter pill for inbox / kanban filters.
// Used as both <Link> (Next.js) and <button>. Active state = inverted fill.
//
// Spec chosen by Polish Team รอบ 45 Agent C audit:
//   - h-9 (touch target ≥ 36px on mobile · admin tables denser ok)
//   - px-3 (Thai labels need a bit more room than 2.5)
//   - rounded-md (Linear-ish, sharper than rounded-lg)
//   - text-xs font-bold
//   - active = solid bg-zinc-900 text-white
//   - inactive = bg-white border border-zinc-200
//
// Optional `dotColor` shows a colored prefix dot (e.g., status color).
// Optional `count` appends "(N)" with tabular-num.

import { cn } from "@/lib/utils/cn";
import type { ReactNode, AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import Link from "next/link";

interface BaseProps {
  active?: boolean;
  /** Hex / tailwind class for the prefix dot. Pass full class like "bg-emerald-500". */
  dotClass?: string;
  count?: number;
  className?: string;
  children: ReactNode;
}

type LinkProps = BaseProps & { href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "href" | "className" | "children"
  >;

type ButtonProps = BaseProps & { onClick: () => void; href?: never } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "onClick" | "className" | "children"
  >;

export type FilterPillProps = LinkProps | ButtonProps;

function classesFor(active: boolean) {
  return cn(
    "h-9 px-3 inline-flex items-center gap-1.5 rounded-md border font-bold text-xs whitespace-nowrap transition-colors",
    active
      ? "bg-zinc-900 text-white border-zinc-900"
      : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400",
  );
}

export function FilterPill(props: FilterPillProps) {
  const { active = false, dotClass, count, className, children } = props;
  const inner = (
    <>
      {dotClass && (
        <span className={cn("size-1.5 rounded-full", dotClass)} />
      )}
      {children}
      {typeof count === "number" && (
        <span className="tabular-num opacity-80">({count})</span>
      )}
    </>
  );

  if ("href" in props && props.href !== undefined) {
    return (
      <Link href={props.href} className={cn(classesFor(active), className)}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={(props as ButtonProps).onClick}
      className={cn(classesFor(active), className)}
    >
      {inner}
    </button>
  );
}
