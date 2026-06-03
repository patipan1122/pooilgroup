"use client";

import { useState } from "react";
import { cn } from "@/lib/fuelos/utils/cn";

// avatar ของคนใน LINE — รูปโปรไฟล์ + fallback เป็นอักษรย่อ
// กัน 2 เคส: (1) รูป LINE โหลดไม่ได้ (404/หมดอายุ/CORS) → onError ตกไปอักษรย่อ
//           (2) ชื่อว่าง/เว้นวรรค → ใช้ "?" ไม่ให้ avatar ว่างเปล่า
export function LineAvatar({ src, name, size = 28, className }: { src?: string | null; name?: string | null; size?: number; className?: string }) {
  const [err, setErr] = useState(false);
  const initial = ((name ?? "").trim() || "?").slice(0, 1);
  const dim = { width: size, height: size };
  if (src && !err) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={(name ?? "").trim() || "ผู้ใช้"} onError={() => setErr(true)} className={cn("rounded-full object-cover shrink-0", className)} style={dim} />;
  }
  return (
    <div className={cn("rounded-full bg-brand-100 text-brand-700 grid place-items-center font-bold shrink-0", className)} style={{ ...dim, fontSize: size <= 28 ? 11 : 14 }}>
      {initial}
    </div>
  );
}
