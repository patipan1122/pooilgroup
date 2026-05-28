"use client";

// Client-side select navigation · replaces server-rendered selects that used
// window.location.href hack (per UX review F1)
// Uses router.push + useTransition for optimistic feel · keeps query params

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface Option { value: string; label: string; }

export function NavSelect({
  param,
  value,
  options,
  style,
}: {
  param: string;
  value: string;
  options: Option[];
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  function update(v: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (v) sp.set(param, v); else sp.delete(param);
    start(() => router.push(`${pathname}?${sp.toString()}`));
  }

  return (
    <select
      className="pl-select"
      value={value}
      onChange={(e) => update(e.target.value)}
      style={{ ...(style ?? {}), opacity: pending ? 0.6 : 1 }}
      disabled={pending}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
