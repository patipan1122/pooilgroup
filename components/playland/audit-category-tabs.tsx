"use client";

// Audit category toggle · uses pl-toggle-group primitive contract (<button> children)
// Replaces the 4× inline-styled <a> tags that bypassed the design system

import { useRouter, useSearchParams } from "next/navigation";

const TABS = [
  { v: null,        label: "ทั้งหมด" },
  { v: "money",     label: "เงิน" },
  { v: "device",    label: "Device" },
  { v: "general",   label: "ทั่วไป" },
] as const;

export function AuditCategoryTabs({ current }: { current: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(v: string | null) {
    const sp = new URLSearchParams(searchParams.toString());
    if (v) sp.set("category", v); else sp.delete("category");
    router.push(`/playland/audit${sp.toString() ? `?${sp.toString()}` : ""}`);
  }

  return (
    <div className="pl-toggle-group">
      {TABS.map((t) => (
        <button
          type="button"
          key={t.v ?? "all"}
          onClick={() => go(t.v)}
          className={current === t.v ? "is-active" : ""}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
