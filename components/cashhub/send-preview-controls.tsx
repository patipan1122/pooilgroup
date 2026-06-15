"use client";

// ตัวเลือกพรีวิว (shared): เลือกสาขา + ระบุวันที่ → navigate ?previewStore=&previewDate=
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function SendPreviewControls({ stores, activeStore, activeDate }: {
  stores: { code: string; label: string }[];
  activeStore: string;
  activeDate: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const pathname = usePathname();
  const nav = (store: string, date: string) => {
    const p = new URLSearchParams(sp.toString());
    if (store) p.set("previewStore", store); else p.delete("previewStore");
    if (date) p.set("previewDate", date); else p.delete("previewDate");
    router.push(`${pathname}?${p.toString()}`);
  };
  const ctl = "h-9 rounded-lg border border-zinc-200 px-2.5 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {stores.length > 1 && (
        <select aria-label="เลือกสาขา" value={activeStore} onChange={(e) => nav(e.target.value, activeDate)} className={ctl}>
          {stores.map((s) => <option key={s.code} value={s.code}>{s.label || s.code}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1.5 text-xs text-zinc-500">
        วันที่:
        <input type="date" aria-label="เลือกวันที่ดูข้อมูลที่จะส่ง" value={activeDate} onChange={(e) => nav(activeStore, e.target.value)} className={`${ctl} tabular-num`} />
      </label>
      {activeDate && (
        <button type="button" onClick={() => nav(activeStore, "")} className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600">↺ ดู 2 วันล่าสุด</button>
      )}
    </div>
  );
}
