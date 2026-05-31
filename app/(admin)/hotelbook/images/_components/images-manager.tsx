"use client";

import { useState, useTransition } from "react";
import { actUploadImage, actDeleteImage, actSetHotelHero } from "../../_actions";

type Img = { id: string; url: string };

export function ImagesManager({
  hotelId,
  currentHeroUrl,
  images: initial,
}: {
  hotelId: string;
  currentHeroUrl: string | null;
  images: Img[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File) => {
    if (file.size > 5 * 1024 * 1024) { setError("ไฟล์ใหญ่เกิน 5MB"); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("รองรับเฉพาะ JPG/PNG/WEBP"); return; }
    start(async () => {
      try {
        const reader = new FileReader();
        const dataUrl: string = await new Promise((res, rej) => {
          reader.onload = () => res(reader.result as string);
          reader.onerror = () => rej(new Error("อ่านไฟล์ไม่ได้"));
          reader.readAsDataURL(file);
        });
        await actUploadImage({ hotelId, dataUrl });
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        className={`rounded-2xl border-2 border-dashed p-10 text-center transition ${dragOver ? "border-zinc-900 bg-zinc-50" : "border-zinc-300 bg-white"}`}
      >
        <div className="text-5xl mb-3">📷</div>
        <p className="text-zinc-700 font-medium mb-2">ลากรูปมาวางที่นี่</p>
        <p className="text-xs text-zinc-500 mb-4">หรือ คลิกเลือกไฟล์ · JPG / PNG / WEBP · ไม่เกิน 5MB</p>
        <label className="inline-flex items-center h-10 px-5 rounded-lg bg-zinc-900 text-white text-sm font-medium cursor-pointer hover:bg-zinc-800">
          {pending ? "กำลังอัปโหลด..." : "เลือกไฟล์"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) handleFile(file);
            }}
          />
        </label>
        {error && <div className="text-sm text-rose-600 mt-3">{error}</div>}
      </div>

      {/* Hero preview */}
      {currentHeroUrl && (
        <div className="rounded-xl ring-1 ring-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-100 text-xs font-medium text-zinc-700">รูป Hero ปัจจุบัน (โชว์บนสุดของหน้าจอง)</div>
          <img src={currentHeroUrl} alt="hero" className="w-full max-h-72 object-cover" />
        </div>
      )}

      {/* Gallery */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">รูปทั้งหมด ({initial.length})</h2>
        {initial.length === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มีรูป · อัปโหลดด้านบน</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {initial.map((img) => (
              <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden ring-1 ring-zinc-200">
                <img src={img.url} alt="" className="w-full h-full object-cover" />
                {currentHeroUrl === img.url ? (
                  <span className="absolute top-2 left-2 text-[11px] bg-emerald-600 text-white px-2 py-0.5 rounded-full">Hero</span>
                ) : (
                  <button
                    onClick={() => start(async () => { await actSetHotelHero(hotelId, img.url); })}
                    className="absolute top-2 left-2 text-[11px] bg-zinc-900/80 text-white px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100"
                  >
                    ตั้งเป็น Hero
                  </button>
                )}
                <button
                  onClick={() => start(async () => { if (confirm("ลบรูปนี้?")) await actDeleteImage(img.id); })}
                  className="absolute top-2 right-2 h-7 w-7 rounded-full bg-rose-600 text-white opacity-0 group-hover:opacity-100"
                  aria-label="ลบรูป"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-zinc-500">💡 รูปต่อห้องไปอัปโหลดในหน้า <a href="/hotelbook/rooms" className="text-blue-600 hover:underline">จัดการห้อง</a></p>
    </div>
  );
}
