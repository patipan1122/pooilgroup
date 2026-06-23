"use client";

import { useRouter } from "next/navigation";
import { Calendar } from "lucide-react";

// เลือกเดือนเจาะจง → นำทางไป ?month=YYYY-MM (คงค่า view/state/q ที่ส่งมาใน keep)
export function MonthPicker({
  months,
  current,
  keep,
}: {
  months: { value: string; label: string }[];
  current: string;
  keep: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <div className="relative inline-flex items-center">
      <Calendar className="size-4 absolute left-2.5 text-zinc-400 pointer-events-none" />
      <select
        value={current}
        onChange={(e) => {
          const p = new URLSearchParams(keep);
          if (e.target.value) p.set("month", e.target.value);
          const s = p.toString();
          router.push(`/fuelos/sales${s ? `?${s}` : ""}`);
        }}
        className="h-9 rounded-lg border border-border bg-surface pl-8 pr-2 text-sm text-zinc-700 appearance-none cursor-pointer"
      >
        <option value="">เลือกเดือน…</option>
        {months.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
    </div>
  );
}
