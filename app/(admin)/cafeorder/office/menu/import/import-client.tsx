"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { previewMenuImport, commitMenuImport } from "@/lib/cafeorder/import-actions";
import type { ImportPreview } from "@/lib/cafeorder/menu-import";

const ACTION_LABEL: Record<string, string> = { create: "✅ เพิ่มใหม่", update: "✏️ อัปเดต", skip: "⏭ ข้าม" };

export function ImportClient({ brand }: { brand: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function currentFormData(): FormData | null {
    const f = fileRef.current?.files?.[0];
    if (!f) return null;
    const fd = new FormData();
    fd.append("file", f);
    return fd;
  }

  function doPreview() {
    setError(null); setDone(null); setPreview(null);
    const fd = currentFormData();
    if (!fd) { setError("เลือกไฟล์ก่อน"); return; }
    startTransition(async () => {
      const r = await previewMenuImport(brand, fd);
      if (r.ok) setPreview(r.preview);
      else setError(r.error);
    });
  }

  function doCommit() {
    setError(null);
    const fd = currentFormData();
    if (!fd) { setError("เลือกไฟล์ก่อน"); return; }
    startTransition(async () => {
      const r = await commitMenuImport(brand, fd);
      if (r.ok) {
        setDone(`นำเข้าสำเร็จ — เพิ่มใหม่ ${r.result.created} · อัปเดต ${r.result.updated} · ข้าม ${r.result.skipped}`);
        setPreview(null);
      } else setError(r.error);
    });
  }

  return (
    <div className="mx-auto max-w-3xl p-5">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/cafeorder/office/menu?brand=${brand}`} className="text-sm text-zinc-500">← กลับ</Link>
        <h1 className="text-xl font-extrabold text-zinc-900">นำเข้าเมนู ({brand === "punthai" ? "พันธุ์ไทย" : "Café Amazon"})</h1>
      </div>

      <ol className="mb-4 space-y-1 text-sm text-zinc-600">
        <li>1. โหลด template (เติมเมนูจริงไว้ให้แล้ว) → แก้ราคาให้ตรงสาขา</li>
        <li>2. อัปไฟล์กลับ → กด “พรีวิว” ดูก่อน → “ยืนยันนำเข้า”</li>
      </ol>
      <a href={`/api/cafeorder/menu/template?brand=${brand}`} className="mb-4 inline-block rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700">
        ⬇ โหลด template (.xlsx)
      </a>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? null); setPreview(null); setDone(null); setError(null); }}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        {fileName && (
          <div className="mt-3 flex gap-2">
            <button onClick={doPreview} disabled={pending} className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-40">
              {pending ? "กำลังอ่าน…" : "พรีวิว"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {done && <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">{done}</div>}

      {preview && (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
            <div className="text-sm">
              <span className="font-semibold text-emerald-700">เพิ่มใหม่ {preview.toCreate}</span>
              {" · "}
              <span className="font-semibold text-blue-700">อัปเดต {preview.toUpdate}</span>
              {preview.errors > 0 && <> {" · "}<span className="font-semibold text-rose-700">ผิด {preview.errors}</span></>}
            </div>
            <button onClick={doCommit} disabled={pending || preview.toCreate + preview.toUpdate === 0} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {pending ? "กำลังบันทึก…" : `ยืนยันนำเข้า (${preview.toCreate + preview.toUpdate})`}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-zinc-50 text-sm">
            {preview.rows.map((r) => (
              <div key={r.rowNo} className="flex items-center gap-2 px-4 py-2">
                <span className="w-16 shrink-0 text-xs text-zinc-400">แถว {r.rowNo}</span>
                <span className="w-20 shrink-0 text-xs">{ACTION_LABEL[r.action]}</span>
                <span className="min-w-0 flex-1 truncate">{r.name || <em className="text-zinc-400">(ว่าง)</em>}</span>
                {r.error && <span className="shrink-0 text-xs text-rose-600">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
