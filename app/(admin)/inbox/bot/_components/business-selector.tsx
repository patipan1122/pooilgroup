"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { INBOX_BUSINESSES } from "@/lib/inbox/business";

export function BusinessSelector({ active }: { active: string }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const tabs = INBOX_BUSINESSES.filter((b) => b.botCapable);
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1">
      {tabs.map((b) => {
        const isActive = b.tag === active;
        const next = new URLSearchParams(params?.toString() ?? "");
        next.set("biz", b.tag);
        return (
          <Link
            key={b.tag}
            href={`${pathname}?${next.toString()}`}
            className={`inline-flex h-8 items-center rounded-lg px-3 text-xs font-bold transition-colors ${
              isActive
                ? "bg-[var(--color-brand-600)] text-white"
                : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {b.label}
          </Link>
        );
      })}
    </div>
  );
}
