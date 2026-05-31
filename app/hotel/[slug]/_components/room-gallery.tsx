"use client";

import { useEffect, useState } from "react";

export function RoomGallery() {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [name, setName] = useState<string>("");
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-gallery-images]");
      if (!t) return;
      e.preventDefault();
      try {
        const arr = JSON.parse(t.dataset.galleryImages || "[]") as string[];
        if (!arr.length) return;
        setImages(arr);
        setName(t.dataset.galleryName ?? "");
        setIdx(0);
        setOpen(true);
      } catch {}
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % images.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, images.length]);

  if (!open || !images.length) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={() => setOpen(false)}>
      <div className="absolute top-4 right-4 text-white text-sm">
        {name} · {idx + 1}/{images.length}
        <button onClick={() => setOpen(false)} className="ml-4 h-9 w-9 rounded-full bg-white/10 hover:bg-white/20" aria-label="ปิด">✕</button>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + images.length) % images.length); }}
        className="absolute left-2 sm:left-6 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl"
        aria-label="รูปก่อนหน้า"
      >‹</button>
      <img
        src={images[idx]}
        alt={`${name} ${idx + 1}`}
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % images.length); }}
        className="absolute right-2 sm:right-6 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl"
        aria-label="รูปถัดไป"
      >›</button>
    </div>
  );
}
