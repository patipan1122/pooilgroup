"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

// ช่องค้นหาแชท — พิมพ์แล้วหน่วง 350ms ค่อยยิง (กันรีเฟรชรัว) · คงตัวกรอง/ป้ายที่เลือกไว้
export function ChatSearch({ initial, filter, labelId }: { initial: string; filter: string; labelId: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const first = useRef(true);

  useEffect(() => { setQ(initial); }, [initial]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (filter && filter !== "all") params.set("filter", filter);
      if (labelId) params.set("label", labelId);
      if (q.trim()) params.set("q", q.trim());
      const qs = params.toString();
      router.replace(qs ? `/fuelos/inbox?${qs}` : "/fuelos/inbox");
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="relative">
      <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ค้นหาแชท · ชื่อ · ข้อความ"
        aria-label="ค้นหาแชท"
        className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      />
      {q && (
        <button
          onClick={() => setQ("")}
          aria-label="ล้างคำค้น"
          className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md text-zinc-400 hover:bg-surface"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
