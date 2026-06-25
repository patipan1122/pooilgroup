"use client";

// ตัวเลือกพรีวิว: เลือกสาขา + ระบุวันที่ดูข้อมูลที่จะส่ง (navigate ผ่าน ?previewStore=&previewDate=)
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function AmazonPreviewControls({ stores, activeStore, activeDate }: {
  stores: { store_code: string; branch_label: string | null }[];
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
  const ctl = "h-10 rounded-lg border border-zinc-200 px-2.5 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300";
  return (
    <div className="mb-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
      {stores.length > 1 && (
        <select aria-label="เลือกสาขา" value={activeStore} onChange={(e) => nav(e.target.value, activeDate)} className={`${ctl} w-full sm:w-auto`}>
          {stores.map((s) => <option key={s.store_code} value={s.store_code}>{s.branch_label || s.store_code}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1.5 text-xs text-zinc-500">
        วันที่:
        <input type="date" aria-label="เลือกวันที่ดูข้อมูลที่จะส่ง" value={activeDate} onChange={(e) => nav(activeStore, e.target.value)} className={`${ctl} tabular-num flex-1 sm:flex-none`} />
      </label>
      {activeDate && (
        <button type="button" onClick={() => nav(activeStore, "")} className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600">↺ ดู 2 วันล่าสุด</button>
      )}
    </div>
  );
}
